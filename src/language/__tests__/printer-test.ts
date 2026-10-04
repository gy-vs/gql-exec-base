import { expect } from 'chai';
import { describe, it } from 'mocha';

import { dedent, dedentString } from '../../__testUtils__/dedent';
import { kitchenSinkQuery } from '../../__testUtils__/kitchenSinkQuery';

import { Kind } from '../kinds';
import { parse } from '../parser';
import { print } from '../printer';

describe('Printer: Query document', () => {
  it('prints minimal ast', () => {
    const ast = {
      kind: Kind.FIELD,
      name: { kind: Kind.NAME, value: 'foo' },
    } as const;
    expect(print(ast)).to.equal('foo');
  });

  it('produces helpful error messages', () => {
    const badAST = { random: 'Data' };

    // @ts-expect-error
    expect(() => print(badAST)).to.throw(
      'Invalid AST Node: { random: "Data" }.',
    );
  });

  it('correctly prints non-query operations without name', () => {
    const queryASTShorthanded = parse('query { id, name }');
    expect(print(queryASTShorthanded)).to.equal(dedent`
      {
        id
        name
      }
    `);

    const mutationAST = parse('mutation { id, name }');
    expect(print(mutationAST)).to.equal(dedent`
      mutation {
        id
        name
      }
    `);

    const queryASTWithArtifacts = parse(
      'query ($foo: TestType) @testDirective { id, name }',
    );
    expect(print(queryASTWithArtifacts)).to.equal(dedent`
      query ($foo: TestType) @testDirective {
        id
        name
      }
    `);

    const mutationASTWithArtifacts = parse(
      'mutation ($foo: TestType) @testDirective { id, name }',
    );
    expect(print(mutationASTWithArtifacts)).to.equal(dedent`
      mutation ($foo: TestType) @testDirective {
        id
        name
      }
    `);
  });

  it('prints query with variable directives', () => {
    const queryASTWithVariableDirective = parse(
      'query ($foo: TestType = {a: 123} @testDirective(if: true) @test) { id }',
    );
    expect(print(queryASTWithVariableDirective)).to.equal(dedent`
      query ($foo: TestType = {a: 123} @testDirective(if: true) @test) {
        id
      }
    `);
  });

  it('prints operation descriptions', () => {
    const queryAST = parse('"Fetch a user" query GetUser { id }');
    expect(print(queryAST)).to.equal(dedent`
      "Fetch a user"
      query GetUser {
        id
      }
    `);

    const blockQueryAST = parse('"""Fetch a user"""\nquery GetUser { id }');
    expect(print(blockQueryAST)).to.equal(dedent`
      """Fetch a user"""
      query GetUser {
        id
      }
    `);
  });

  it('prints fragment descriptions', () => {
    const fragmentAST = parse('"User fields" fragment Foo on Test { id }');
    expect(print(fragmentAST)).to.equal(dedent`
      "User fields"
      fragment Foo on Test {
        id
      }
    `);

    const blockFragmentAST = parse(
      '"""User fields"""\nfragment Foo on Test { id }',
    );
    expect(print(blockFragmentAST)).to.equal(dedent`
      """User fields"""
      fragment Foo on Test {
        id
      }
    `);
  });

  it('prints variable definition descriptions', () => {
    const queryAST = parse('query GetUser("id of the user" $id: ID) { id }');
    expect(print(queryAST)).to.equal(dedent`
      query GetUser("id of the user" $id: ID) {
        id
      }
    `);
  });

  it('prints descriptions as part of a full document', () => {
    const queryAST = parse(dedent`
      """Fetch a user"""
      query GetUser(
        "id of the user"
        $id: ID
      ) @onQuery {
        user(id: $id) {
          ...UserFields
        }
      }

      """Common user fields"""
      fragment UserFields on User @onFragment {
        id
      }
    `);

    expect(print(queryAST)).to.equal(dedent`
      """Fetch a user"""
      query GetUser("id of the user" $id: ID) @onQuery {
        user(id: $id) {
          ...UserFields
        }
      }

      """Common user fields"""
      fragment UserFields on User @onFragment {
        id
      }
    `);
  });

  it('prints executable descriptions without altering ast and round-trips', () => {
    const source = dedent`
      """Fetch a user"""
      query GetUser(
        "id of the user"
        $id: ID
      ) {
        user(id: $id) {
          ...UserFields
        }
      }

      """Common user fields"""
      fragment UserFields on User {
        id
      }
    `;
    const ast = parse(source, { noLocation: true });

    const astBeforePrintCall = JSON.stringify(ast);
    const printed = print(ast);
    const printedAST = parse(printed, { noLocation: true });

    expect(printedAST).to.deep.equal(ast);
    expect(JSON.stringify(ast)).to.equal(astBeforePrintCall);

    // A block string description is printed and re-parsed as a block string.
    const operation = printedAST.definitions[0] as any;
    const fragment = printedAST.definitions[1] as any;
    expect(
      operation.description.block === true &&
        fragment.description.block === true,
    ).to.equal(true);
    // A simple string description keeps its simple form too.
    expect(operation.variableDefinitions[0].description.block).to.equal(false);
  });

  it('keeps arguments on one line if line is short (<= 80 chars)', () => {
    const printed = print(
      parse('{trip(wheelchair:false arriveBy:false){dateTime}}'),
    );

    expect(printed).to.equal(dedent`
      {
        trip(wheelchair: false, arriveBy: false) {
          dateTime
        }
      }
    `);
  });

  it('puts arguments on multiple lines if line is long (> 80 chars)', () => {
    const printed = print(
      parse(
        '{trip(wheelchair:false arriveBy:false includePlannedCancellations:true transitDistanceReluctance:2000){dateTime}}',
      ),
    );

    expect(printed).to.equal(dedent`
      {
        trip(
          wheelchair: false
          arriveBy: false
          includePlannedCancellations: true
          transitDistanceReluctance: 2000
        ) {
          dateTime
        }
      }
    `);
  });

  it('Legacy: prints fragment with variable directives', () => {
    const queryASTWithVariableDirective = parse(
      'fragment Foo($foo: TestType @test) on TestType @testDirective { id }',
      { allowLegacyFragmentVariables: true },
    );
    expect(print(queryASTWithVariableDirective)).to.equal(dedent`
      fragment Foo($foo: TestType @test) on TestType @testDirective {
        id
      }
    `);
  });

  it('Legacy: correctly prints fragment defined variables', () => {
    const fragmentWithVariable = parse(
      `
        fragment Foo($a: ComplexType, $b: Boolean = false) on TestType {
          id
        }
      `,
      { allowLegacyFragmentVariables: true },
    );
    expect(print(fragmentWithVariable)).to.equal(dedent`
      fragment Foo($a: ComplexType, $b: Boolean = false) on TestType {
        id
      }
    `);
  });

  it('prints kitchen sink without altering ast', () => {
    const ast = parse(kitchenSinkQuery, { noLocation: true });

    const astBeforePrintCall = JSON.stringify(ast);
    const printed = print(ast);
    const printedAST = parse(printed, { noLocation: true });

    expect(printedAST).to.deep.equal(ast);
    expect(JSON.stringify(ast)).to.equal(astBeforePrintCall);

    expect(printed).to.equal(
      dedentString(String.raw`
      query queryName($foo: ComplexType, $site: Site = MOBILE) @onQuery {
        whoever123is: node(id: [123, 456]) {
          id
          ... on User @onInlineFragment {
            field2 {
              id
              alias: field1(first: 10, after: $foo) @include(if: $foo) {
                id
                ...frag @onFragmentSpread
              }
            }
          }
          ... @skip(unless: $foo) {
            id
          }
          ... {
            id
          }
        }
      }

      mutation likeStory @onMutation {
        like(story: 123) @onField {
          story {
            id @onField
          }
        }
      }

      subscription StoryLikeSubscription($input: StoryLikeSubscribeInput @onVariableDefinition) @onSubscription {
        storyLikeSubscribe(input: $input) {
          story {
            likers {
              count
            }
            likeSentence {
              text
            }
          }
        }
      }

      fragment frag on Friend @onFragmentDefinition {
        foo(
          size: $size
          bar: $b
          obj: {key: "value", block: """
          block string uses \"""
          """}
        )
      }

      {
        unnamed(truthy: true, falsy: false, nullish: null)
        query
      }

      {
        __typename
      }
    `),
    );
  });
});
