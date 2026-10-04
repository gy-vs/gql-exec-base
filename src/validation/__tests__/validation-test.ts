import { expect } from 'chai';
import { describe, it } from 'mocha';

import { expectJSON } from '../../__testUtils__/expectJSON';

import { GraphQLError } from '../../error/GraphQLError';

import type { DirectiveNode } from '../../language/ast';
import { parse } from '../../language/parser';
import { visit } from '../../language/visitor';

import { buildSchema } from '../../utilities/buildASTSchema';
import { TypeInfo } from '../../utilities/TypeInfo';

import { validate } from '../validate';
import type { ValidationContext } from '../ValidationContext';

import { testSchema } from './harness';

// Strips descriptions from executable definition nodes.
const removeDescriptions = {
  OperationDefinition(node: any) {
    const { description, ...rest } = node;
    return description ? rest : undefined;
  },
  FragmentDefinition(node: any) {
    const { description, ...rest } = node;
    return description ? rest : undefined;
  },
  VariableDefinition(node: any) {
    const { description, ...rest } = node;
    return description ? rest : undefined;
  },
};

describe('Validate: Supports full validation', () => {
  it('rejects invalid documents', () => {
    // @ts-expect-error (expects a DocumentNode as a second parameter)
    expect(() => validate(testSchema, null)).to.throw('Must provide document.');
  });

  it('validates queries', () => {
    const doc = parse(`
      query {
        human {
          pets {
            ... on Cat {
              meowsVolume
            }
            ... on Dog {
              barkVolume
            }
          }
        }
      }
    `);

    const errors = validate(testSchema, doc);
    expectJSON(errors).toDeepEqual([]);
  });

  it('detects unknown fields', () => {
    const doc = parse(`
      {
        unknown
      }
    `);

    const errors = validate(testSchema, doc);
    expectJSON(errors).toDeepEqual([
      {
        locations: [{ line: 3, column: 9 }],
        message: 'Cannot query field "unknown" on type "QueryRoot".',
      },
    ]);
  });

  it('Deprecated: validates using a custom TypeInfo', () => {
    // This TypeInfo will never return a valid field.
    const typeInfo = new TypeInfo(testSchema, null, () => null);

    const doc = parse(`
      query {
        human {
          pets {
            ... on Cat {
              meowsVolume
            }
            ... on Dog {
              barkVolume
            }
          }
        }
      }
    `);

    const errors = validate(testSchema, doc, undefined, undefined, typeInfo);
    const errorMessages = errors.map((error) => error.message);

    expect(errorMessages).to.deep.equal([
      'Cannot query field "human" on type "QueryRoot". Did you mean "human"?',
      'Cannot query field "meowsVolume" on type "Cat". Did you mean "meowsVolume"?',
      'Cannot query field "barkVolume" on type "Dog". Did you mean "barkVolume"?',
    ]);
  });

  it('treats descriptions on executable definitions as pure annotations', () => {
    const withDescriptions = parse(`
      """Fetch a human"""
      query GetHuman(
        "The human ID"
        $id: ID!
      ) {
        human(id: $id) {
          name
          pets {
            ...PetFields
          }
        }
      }

      """Pet fields"""
      fragment PetFields on Pet {
        name
      }
    `);
    const withoutDescriptions = parse(`
      query GetHuman(
        $id: ID!
      ) {
        human(id: $id) {
          name
          pets {
            ...PetFields
          }
        }
      }

      fragment PetFields on Pet {
        name
      }
    `);

    expectJSON(validate(testSchema, withDescriptions)).toDeepEqual(
      validate(testSchema, withoutDescriptions),
    );
    expectJSON(validate(testSchema, withDescriptions)).toDeepEqual([]);
  });

  it('reports identical validation errors whether or not descriptions are present', () => {
    // Descriptions must not add, remove, or alter any validation diagnostics.
    const source = `
      "Query description"
      query GetHuman($unused: String) {
        unknownField
        ...MissingFragment
      }

      "Fragment description"
      fragment PetFields on Pet {
        name
        undefinedField
      }
    `;
    const invalidWithDescriptions = parse(source);
    const invalidWithoutDescriptions = visit(
      parse(source, { noLocation: true }),
      removeDescriptions,
    );

    expect(invalidWithoutDescriptions).to.deep.equal(
      parse(
        `
        query GetHuman($unused: String) {
          unknownField
          ...MissingFragment
        }

        fragment PetFields on Pet {
          name
          undefinedField
        }
      `,
        { noLocation: true },
      ),
    );

    const withErrors = validate(testSchema, invalidWithDescriptions);
    const withoutErrors = validate(
      testSchema,
      visit(invalidWithDescriptions, removeDescriptions),
    );
    // Descriptions may not change which errors are reported; order is not
    // significant, so compare the sorted lists of messages.
    const withMessages = withErrors
      .map((error) => error.message)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const withoutMessages = withoutErrors
      .map((error) => error.message)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(withMessages).to.deep.equal(withoutMessages);
    expect(withMessages).to.deep.equal(
      [
        'Cannot query field "unknownField" on type "QueryRoot".',
        'Unknown fragment "MissingFragment".',
        'Cannot query field "undefinedField" on type "Pet".',
        'Fragment "PetFields" is never used.',
        'Variable "$unused" is never used in operation "GetHuman".',
      ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it('validates using a custom rule', () => {
    const schema = buildSchema(`
      directive @custom(arg: String) on FIELD

      type Query {
        foo: String
      }
    `);

    const doc = parse(`
      query {
        name @custom
      }
    `);

    function customRule(context: ValidationContext) {
      return {
        Directive(node: DirectiveNode) {
          const directiveDef = context.getDirective();
          const error = new GraphQLError(
            'Reporting directive: ' + String(directiveDef),
            { nodes: node },
          );
          context.reportError(error);
        },
      };
    }

    const errors = validate(schema, doc, [customRule]);
    expectJSON(errors).toDeepEqual([
      {
        message: 'Reporting directive: @custom',
        locations: [{ line: 3, column: 14 }],
      },
    ]);
  });
});

describe('Validate: Limit maximum number of validation errors', () => {
  const query = `
    {
      firstUnknownField
      secondUnknownField
      thirdUnknownField
    }
  `;
  const doc = parse(query, { noLocation: true });

  function validateDocument(options: { maxErrors?: number }) {
    return validate(testSchema, doc, undefined, options);
  }

  function invalidFieldError(fieldName: string) {
    return {
      message: `Cannot query field "${fieldName}" on type "QueryRoot".`,
    };
  }

  it('when maxErrors is equal to number of errors', () => {
    const errors = validateDocument({ maxErrors: 3 });
    expectJSON(errors).toDeepEqual([
      invalidFieldError('firstUnknownField'),
      invalidFieldError('secondUnknownField'),
      invalidFieldError('thirdUnknownField'),
    ]);
  });

  it('when maxErrors is less than number of errors', () => {
    const errors = validateDocument({ maxErrors: 2 });
    expectJSON(errors).toDeepEqual([
      invalidFieldError('firstUnknownField'),
      invalidFieldError('secondUnknownField'),
      {
        message:
          'Too many validation errors, error limit reached. Validation aborted.',
      },
    ]);
  });

  it('passthrough exceptions from rules', () => {
    function customRule() {
      return {
        Field() {
          throw new Error('Error from custom rule!');
        },
      };
    }
    expect(() =>
      validate(testSchema, doc, [customRule], { maxErrors: 1 }),
    ).to.throw(/^Error from custom rule!$/);
  });
});
