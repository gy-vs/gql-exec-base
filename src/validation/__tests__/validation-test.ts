import { expect } from 'chai';
import { describe, it } from 'mocha';

import { dedent } from '../../__testUtils__/dedent';
import { expectJSON } from '../../__testUtils__/expectJSON';

import { GraphQLError } from '../../error/GraphQLError';

import type { DirectiveNode } from '../../language/ast';
import { Kind } from '../../language/kinds';
import { parse } from '../../language/parser';
import { visit } from '../../language/visitor';

import { buildSchema } from '../../utilities/buildASTSchema';
import { TypeInfo } from '../../utilities/TypeInfo';

import { validate } from '../validate';
import type { ValidationContext } from '../ValidationContext';

import { testSchema } from './harness';

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

describe('Validate: Executable descriptions', () => {
  function withoutDescriptions(source: string) {
    return visit(parse(source), {
      [Kind.OPERATION_DEFINITION]: removeDescription,
      [Kind.FRAGMENT_DEFINITION]: removeDescription,
      [Kind.VARIABLE_DEFINITION]: removeDescription,
    });
  }

  function removeDescription(node: any) {
    if (node.description == null) {
      return undefined;
    }
    const stripped: any = {};
    for (const key of Object.keys(node)) {
      if (key !== 'description') {
        stripped[key] = node[key];
      }
    }
    return stripped;
  }

  function expectEquivalentValidation(source: string) {
    const withDescriptions = parse(source);
    const stripped = withoutDescriptions(source);

    expectJSON(
      validate(testSchema, withDescriptions).map((error) => ({
        message: error.message,
        locations: error.locations,
      })),
    ).toDeepEqual(
      validate(testSchema, stripped).map((error) => ({
        message: error.message,
        locations: error.locations,
      })),
    );
  }

  it('descriptions are ignored when validating valid documents', () => {
    expectEquivalentValidation(dedent`
      """Fetch a human"""
      query GetHuman(
        "an id"
        $id: String
      ) {
        human(id: $id) {
          name
          ...HumanFields
        }
      }

      """common human fields"""
      fragment HumanFields on Human {
        name
        pets {
          name
        }
      }
    `);
  });

  it('descriptions do not mask validation errors', () => {
    expectEquivalentValidation(`
      "operation"
      query Q {
        nonExistentField
      }
    `);

    expectEquivalentValidation(`
      query Q(
        "variable description"
        $x: NonExistentType
      ) {
        human { name }
      }
    `);

    expectEquivalentValidation(`
      query Q {
        human { ...NonExistentFragment }
      }

      "fragment"
      fragment NonExistentFragment on NonExistentType {
        name
      }
    `);
  });

  it('variable description strings are not checked as values', () => {
    // The description is a String while the variable type is Int; without
    // special handling ValuesOfCorrectType would report a spurious error.
    const doc = parse(`
      query Q(
        "id of the human"
        $id: ID
      ) {
        human(id: $id) { name }
      }
    `);

    expectJSON(validate(testSchema, doc)).toDeepEqual([]);

    // String default values at the same position are still validated.
    const invalidDoc = parse(`
      query Q($id: Int = "not an int") {
        human(id: $id) { name }
      }
    `);
    expect(
      validate(testSchema, invalidDoc).map((error) => error.message),
    ).to.include('Int cannot represent non-integer value: "not an int"');
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
