/**
 * What the print stylesheet must and must not do.
 *
 * Most of a print stylesheet is taste, and taste does not need a test. One
 * part of it is not: a printed report leaves this browser, this session and
 * every bit of context that explains what it is. Somebody can be handed a
 * sheet of paper with a name, a score and four findings on it, and no way to
 * ask whether any of it is real.
 *
 * Rule 13 says fixture results are never presented as live ones. On screen
 * the banner is there because it renders; on paper it is there only because
 * this file stops someone tidying it away, the way `display: none` on
 * `header, footer, nav` nearly did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'app', 'globals.css'), 'utf8');

/** The body of the `@media print` block. */
function printBlock(): string {
  const start = css.indexOf('@media print');
  assert.notEqual(start, -1, 'there is no @media print block in globals.css');

  // Walk the braces, because the block contains nested rules and @page.
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('the @media print block is unterminated');
}

const print = printBlock();

test('the fixture warning is forced visible when printing', () => {
  const rule = /\.notice-warning\s*\{[^}]*\}/.exec(print);
  assert.ok(rule, 'the print stylesheet says nothing about the fixture warning');

  assert.match(
    rule[0],
    /display:\s*flex\s*!important/,
    'the fixture warning must be forced visible, not merely left alone — ' +
      'a later `display: none` on a parent or a shared class would silently drop it'
  );
});

/**
 * The near miss this came from.
 *
 * `header, footer, nav, .no-print { display: none }` is the obvious first
 * line of any print stylesheet, and one careless selector in that list —
 * `.notice`, say, or `[role=status]` — removes the warning without anybody
 * noticing, because nobody prints the page again to check.
 */
test('nothing in the print stylesheet hides the warning by class or role', () => {
  const hidden = [...print.matchAll(/([^{}]+)\{[^}]*display:\s*none[^}]*\}/g)]
    .map((m) => m[1].trim());

  for (const selector of hidden) {
    for (const dangerous of ['.notice', '[role=status]', '[role="status"]', '.card']) {
      assert.ok(
        !selector.includes(dangerous),
        `"${selector}" hides the fixture warning, or the block that carries it`
      );
    }
  }
});

test('printing forces the light palette, including for an explicit dark choice', () => {
  assert.match(
    print,
    /:root\[data-theme='dark'\]/,
    'dark is set by a media query AND a data attribute; a print override that ' +
      'beats only one of them prints dark for anyone who chose it explicitly'
  );
  assert.match(print, /--bg:\s*#FFFFFF/i);
  assert.match(print, /--text:\s*#000000/i);
});

/**
 * The bug this is here to stop coming back.
 *
 * The dark palette is applied by `:root:not([data-theme='light'])`, which is
 * specificity (0,2,0). The first version of the print block overrode plain
 * `:root` at (0,1,0) and simply lost: rendering the print rules on a machine
 * set to dark gave #E9ECE7 text on a #FFFFFF page. Nothing in the stylesheet
 * looked wrong, and nobody would find it without printing.
 *
 * `!important` on a custom property beats both theme blocks regardless of
 * selector order, and without relying on a browser resetting
 * `prefers-color-scheme` for print — which they do not do consistently.
 */
test('the print palette outranks the dark palette rather than tying with it', () => {
  const palette = /:root,\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(print);
  assert.ok(palette, 'could not find the print palette block');

  const declarations = palette[1]
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.startsWith('--') || d.startsWith('color-scheme'));

  assert.ok(declarations.length > 10, 'expected the full palette to be restated');

  for (const declaration of declarations) {
    assert.match(
      declaration,
      /!important\s*$/,
      `"${declaration}" is not !important, so :root:not([data-theme='light']) ` +
        'outranks it and this prints in the dark palette'
    );
  }
});

test('links print their destination', () => {
  assert.match(
    print,
    /a\[href\^='http'\]::after[\s\S]*?attr\(href\)/,
    'the product claims every finding points at a checkable source; on paper ' +
      'that is only true if the URL is on the page'
  );
});

/**
 * The evidence table must not print in its phone form.
 *
 * Below 760px each row becomes a stacked block with its own labels, which is
 * right on a phone and runs to several pages on A4 — losing the column
 * alignment that makes one piece of evidence comparable with the next.
 */
test('the evidence table prints as a table, not as stacked records', () => {
  assert.match(print, /\.table thead\s*\{[^}]*display:\s*table-header-group/);
  assert.match(print, /\.table td::before\s*\{[^}]*content:\s*none/);
});

test('the print control does not print itself', () => {
  const report = readFileSync(join(here, '..', 'app', 'components', 'Report.tsx'), 'utf8');

  assert.match(report, /className="btn btn-secondary no-print"/);
  assert.match(print, /\.no-print/);
});

/**
 * A closed disclosure prints nothing at all.
 *
 * The audit details — provider, queries, window, the date the results were
 * seen — are folded away on screen because they answer an auditor's
 * question rather than a customer's. On paper nobody can click, so without
 * this rule a saved report silently loses the only record of how it was
 * produced, which is the half of rule 8 that survives being printed.
 */
test('the audit details print even though they are collapsed on screen', () => {
  const report = readFileSync(join(here, '..', 'app', 'components', 'Report.tsx'), 'utf8');

  assert.match(
    report,
    /<details className="card disclosure">/,
    'the audit details are no longer a disclosure; this test guards the wrong thing'
  );

  assert.match(
    print,
    /details\.disclosure\s*>\s*\*:not\(summary\)\s*\{[^}]*display:\s*block\s*!important/,
    'a collapsed <details> prints as its summary alone, so the provenance ' +
      'would be missing from every saved PDF'
  );
});
