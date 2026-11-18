/**
 * The thing Source Authority cannot see, said on the report.
 *
 * The dimension is meant to measure other people deciding to write about
 * somebody. What it can actually observe is a result on a domain the
 * customer does not control, classified as coverage. Those are not the same
 * question, and the gap is not academic: a guest column, a podcast
 * appearance and a profile somebody filled in all look like the first while
 * being the second.
 *
 * The engine stopped claiming otherwise (see `score.ts` and
 * `authorship.test.ts`, which assert the word "independent" is gone from a
 * count built on undeclared records). This file asserts the other half,
 * because a limitation the engine knows and the report does not mention is
 * not a limitation anybody is told about.
 *
 * It is tested as text rather than rendered because `Report.tsx` is JSX and
 * Node's type stripping cannot load it. That is a weaker test than mounting
 * the component, so it is written to fail on deletion rather than on
 * rewording: what it pins down is that the Limitations section still says
 * the three things that make the point, not the sentence that says them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPORT = join(here, '..', 'app', 'components', 'Report.tsx');

/**
 * The body of the `Limitations` component, comments removed.
 *
 * Scoped to the component rather than the file so the test cannot be
 * satisfied by the words appearing somewhere else entirely, and stripped of
 * comments so it cannot be satisfied by a comment about the limitation.
 */
function limitationsSection(): string {
  const source = readFileSync(REPORT, 'utf8');

  const start = source.indexOf('function Limitations(');
  assert.notEqual(start, -1, 'the report no longer has a Limitations section');

  // To the next top-level declaration, which is how every other section in
  // this file ends.
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(?:function|export|\/\* -)/);

  const body = end === -1 ? rest : rest.slice(0, end);

  return body
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('the report says Source Authority cannot tell your own words from coverage', () => {
  const section = limitationsSection();

  /**
   * Three claims, each one load-bearing on its own.
   *
   * Naming the shapes of evidence matters more than the abstraction: "we
   * cannot verify authorship" is the kind of sentence a reader skips,
   * whereas a podcast appearance is a thing they can recognise as theirs.
   */
  assert.match(
    section,
    /wrote or placed yourself/i,
    'the limitation no longer says whose material is confused with coverage'
  );

  assert.match(
    section,
    /guest column|podcast/i,
    'the limitation is abstract, so a reader cannot tell whether it applies to them'
  );

  assert.match(
    section,
    /Source Authority/,
    'the limitation does not name the dimension it limits'
  );

  /**
   * And the direction of the error.
   *
   * A limitation that does not say which way the number is wrong is an
   * apology rather than information. This one inflates, and the reader is
   * entitled to know the figure flatters them rather than that it is
   * merely uncertain.
   */
  assert.match(
    section,
    /higher than it should/i,
    'the limitation does not say which way the dimension is wrong'
  );
});

/**
 * Where it has to sit.
 *
 * The permitted-use statement is deliberately first and outside the list,
 * because it is about what the document may be used for rather than what
 * the number means. This limitation is the second kind, so it belongs in
 * the list with the others. Asserted because a future edit that promotes it
 * to its own paragraph would quietly demote the statement that matters more.
 */
test('the authorship limitation is a list item, not a second headline', () => {
  const section = limitationsSection();

  const permitted = section.indexOf('{PERMITTED_USE}');
  const authorship = section.search(/wrote or placed yourself/i);

  assert.notEqual(permitted, -1, 'the permitted-use statement left the Limitations section');
  assert.ok(
    permitted < authorship,
    'the authorship limitation now precedes the permitted-use statement'
  );

  const list = section.indexOf('<ul');
  assert.ok(
    list !== -1 && list < authorship,
    'the authorship limitation sits outside the list of what the number means'
  );
});
