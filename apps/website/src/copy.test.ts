/**
 * No em dashes or en dashes in anything a person reads on screen.
 *
 * A house style rule, enforced rather than remembered. It is the kind of
 * thing that holds for a week after somebody asks for it and then decays,
 * because every individual dash looks harmless and nobody is counting.
 *
 * ## The one carve-out, and why it is not a loophole
 *
 * A search result's title and excerpt are **quoted third-party content**.
 * They are reproduced verbatim and never paraphrased into a claim, which is
 * the whole basis on which this product asks anybody to trust a finding.
 * Real pages are full of em dashes: "Okonkwo, Amara — Board certified" is
 * how a medical board actually writes it.
 *
 * Editing a quotation to satisfy a typography preference is falsifying
 * evidence. It is a small falsification, which is exactly why it is worth
 * refusing: the rule that excerpts are untouched has to be absolute or it is
 * not a rule. So quoted content keeps its punctuation, and the exemption is
 * held to the two fields that carry quotations — asserted below, so it
 * cannot quietly widen into "the fixture file is exempt".
 *
 * ## What this does not cover
 *
 * Source comments, documentation under `docs/`, commit messages and test
 * names. None of those is interface text. The rule is about what a customer,
 * a reviewer or a member of staff reads in the product.
 *
 * Lives in the website workspace because that is where interface text mostly
 * is, and reaches into the engine packages because some of it is defined
 * there: `PERMITTED_USE`, the risk notes, the withheld-record placeholder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const ROOTS = [
  join(root, 'apps', 'website', 'app'),
  join(root, 'apps', 'website', 'src'),
  join(root, 'packages', 'domain', 'src'),
  join(root, 'packages', 'persistence', 'src'),
];

/** Quoted third-party content. See the note above. */
const VERBATIM = join('providers', 'fixture.ts');

const DASH = /[–—]/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      sources(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (name.includes('.test.')) continue;
    out.push(path);
  }
  return out;
}

/**
 * Blanks comments while keeping line numbers, so a failure points at the
 * line somebody has to edit.
 */
const withoutComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

interface Hit {
  file: string;
  line: number;
  text: string;
}

function findDashes(): Hit[] {
  const hits: Hit[] = [];

  for (const dir of ROOTS) {
    for (const file of sources(dir)) {
      const rel = relative(root, file);
      const original = readFileSync(file, 'utf8').split('\n');
      const code = withoutComments(readFileSync(file, 'utf8')).split('\n');

      code.forEach((line, i) => {
        if (!DASH.test(line)) return;
        if (file.endsWith(VERBATIM)) return;
        hits.push({ file: rel, line: i + 1, text: original[i]!.trim() });
      });
    }
  }

  return hits;
}

test('no em dashes or en dashes in interface text', () => {
  const hits = findDashes();

  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}  ${h.text.slice(0, 90)}`),
    [],
    'use a comma, a colon, a full stop, parentheses, or rewrite the sentence'
  );
});

test('the verbatim carve-out covers quotations and nothing else', () => {
  /**
   * The exemption exists so a search result can be reproduced exactly. If a
   * dash turns up anywhere else in that file — a label, a scenario name, a
   * message — it is our own writing wearing the exemption, and the rule
   * applies to it.
   */
  const file = join(root, 'packages', 'domain', 'src', VERBATIM);
  const lines = withoutComments(readFileSync(file, 'utf8')).split('\n');

  const stray = lines
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => DASH.test(line))
    .filter(({ line }) => !/^(title|snippet):/.test(line))
    .map(({ line, n }) => `fixture.ts:${n}  ${line.slice(0, 90)}`);

  assert.deepEqual(stray, [], 'a dash outside a quoted title or snippet is our own copy');
});

test('the rule reaches the engine packages, not just the website', () => {
  // PERMITTED_USE, the risk notes and the withheld placeholder are all
  // interface text defined in `packages/domain`. A linter that only walked
  // `app/` would pass while the most consequential sentence in the product
  // kept its dashes.
  assert.ok(
    ROOTS.some((r) => r.includes(join('packages', 'domain'))),
    'the engine packages are not being scanned'
  );
});

test('the scan actually finds something when there is something to find', () => {
  /**
   * A lint that silently matches nothing passes for ever. This proves the
   * detector works against a known string rather than trusting that an empty
   * result means a clean codebase.
   */
  const planted = withoutComments("const x = 'before — after';\n");
  assert.ok(DASH.test(planted), 'the dash pattern no longer matches an em dash');

  const commentOnly = withoutComments("// a comment — with a dash\n");
  assert.ok(!DASH.test(commentOnly), 'comments are being scanned as interface text');
});
