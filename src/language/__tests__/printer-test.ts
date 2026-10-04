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

  it('prints operation descriptions', () => {
    const queryWithDescription = parse(
      '"Fetch user"\nquery Q($foo: TestType) @testDirective { id }',
    );
    expect(print(queryWithDescription)).to.equal(dedent`
      "Fetch user"
      query Q($foo: TestType) @testDirective {
        id
      }
    `);

    const mutationWithBlockDescription = parse(
      '"""\nPerform mutation\n"""\nmutation M { id }',
    );
    expect(print(mutationWithBlockDescription)).to.equal(dedent`
      """Perform mutation"""
      mutation M {
        id
      }
    `);
  });

  it('prints fragment descriptions', () => {
    const fragmentWithDescription = parse(
      '"Fragment description"\nfragment Foo on TestType { id }',
    );
    expect(print(fragmentWithDescription)).to.equal(dedent`
      "Fragment description"
      fragment Foo on TestType {
        id
      }
    `);

    const fragmentWithBlockDescription = parse(
      '"""\nFragment\ndescription\n"""\nfragment Foo on TestType { id }',
    );
    expect(print(fragmentWithBlockDescription)).to.equal(
      dedentString(String.raw`
      """
      Fragment
      description
      """
      fragment Foo on TestType {
        id
      }
    `),
    );
  });

  it('prints variable definition descriptions', () => {
    const queryWithVariableDescription = parse(
      'query Q("Variable description" $foo: TestType) { id }',
    );
    expect(print(queryWithVariableDescription)).to.equal(dedent`
      query Q("Variable description" $foo: TestType) {
        id
      }
    `);

    const queryWithBlockDescription = parse(
      'query Q("""\nBlock variable\ndescription\n"""\n$foo: TestType = "default") { id }',
    );
    expect(print(queryWithBlockDescription)).to.equal(
      dedentString(String.raw`
      query Q("""
      Block variable
      description
      """ $foo: TestType = "default") {
        id
      }
    `),
    );
  });

  it('prints descriptions on all supported positions and round-trips', () => {
    const query = dedent`
      """Fetch user"""
      query Q("""The user ID""" $foo: TestType) @testDirective {
        id
      }

      "User fields"
      fragment Foo on TestType {
        id
      }
    `;

    const ast = parse(query, { noLocation: true });
    const printed = print(ast);
    expect(printed).to.equal(query);

    const reprintedAST = parse(printed, { noLocation: true });
    expect(reprintedAST).to.deep.equal(ast);
  });

  it('prints multi-line block string descriptions as block strings', () => {
    const ast = parse('"""line1\nline2"""\nquery Q { id }', {
      noLocation: true,
    });
    expect(print(ast)).to.equal(
      dedentString(String.raw`
      """
      line1
      line2
      """
      query Q {
        id
      }
    `),
    );
  });

  it('keeps the query keyword when an unnamed operation has a description', () => {
    const ast = parse('"Anonymous but described"\nquery { id }', {
      noLocation: true,
    });
    const printed = print(ast);
    expect(printed).to.equal(dedent`
      "Anonymous but described"
      query {
        id
      }
    `);

    // The shorthand form "{ id }" cannot carry a description, so the printed
    // document must keep the "query" keyword and stay syntactically valid.
    expect(parse(printed, { noLocation: true })).to.deep.equal(ast);
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
