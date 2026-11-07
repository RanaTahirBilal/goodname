/**
 * The icon set, held to being one set.
 *
 * An icon system decays by addition: somebody needs a glyph, reaches for a
 * different stroke weight or a filled shape because it looks better at that
 * one size, and six months later the product has two icon families and
 * nobody decided to have two.
 *
 * So the invariants are asserted rather than documented. Source assertions,
 * like `print.test.ts` and `review-screen.test.ts`, because there is no
 * renderer in this workspace and these properties are visible in the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icon = readFileSync(join(here, '..', 'app', 'components', 'Icon.tsx'), 'utf8');

test('one grid, one stroke, no fills', () => {
  assert.match(icon, /viewBox="0 0 24 24"/, 'the glyphs are not all on the same grid');
  assert.match(icon, /strokeWidth=\{1\.5\}/, 'the stroke weight has changed or varies');
  assert.match(icon, /fill="none"/, 'a filled icon would not match the set');

  // Exactly one `fill` other than none: the dot on the alert glyph, which a
  // stroke cannot draw legibly at 16px. Any more is a second family.
  const fills = [...icon.matchAll(/fill="(?!none)[^"]+"/g)];
  assert.equal(fills.length, 1, `${fills.length} filled shapes; the set is stroked`);
});

test('icons take their colour and size from the text beside them', () => {
  /**
   * The property that makes them accessible for free: an icon that inherits
   * `currentColor` and sizes in `em` passes whatever contrast check the
   * words next to it pass, in both themes, without a separate palette.
   */
  assert.match(icon, /stroke="currentColor"/, 'the icons carry their own colour');
  assert.match(icon, /const size = `\$\{scale\}em`/, 'the icons are sized in pixels');
});

test('an icon is hidden from a screen reader unless it is carrying meaning', () => {
  // Decoration beside a word the icon repeats must be silent, or the label
  // is read twice. A standalone icon must have a name. There is no third
  // case, and the component has to make the wrong one hard.
  assert.match(icon, /aria-hidden=\{label \? undefined : true\}/);
  assert.match(icon, /role=\{label \? 'img' : undefined\}/);
});

test('every declared name has paths, and every path has a name', () => {
  // The last member of the union ends with a semicolon; the rest do not.
  const declared = [...icon.matchAll(/^\s*\| '([a-z-]+)';?$/gm)].map((m) => m[1]);
  const drawn = [...icon.matchAll(/^\s+'?([a-z-]+)'?: \[/gm)].map((m) => m[1]);

  assert.ok(declared.length >= 10, `only ${declared.length} icons declared`);
  assert.deepEqual(
    declared.slice().sort(),
    drawn.slice().sort(),
    'the union type and the path table disagree, so a name compiles and draws nothing'
  );
});

test('motion is defined once and switched off in one place', () => {
  const css = readFileSync(join(here, '..', 'app', 'globals.css'), 'utf8');

  // Two durations and one curve. A third of either is how one gesture ends
  // up with six speeds.
  for (const token of ['--motion-fast', '--motion', '--ease']) {
    assert.ok(css.includes(token), `missing ${token}`);
  }

  const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(reduce, 'nothing honours prefers-reduced-motion');
  assert.match(reduce![1], /--motion-fast: 0ms/, 'the duration tokens are not zeroed');
  assert.match(reduce![1], /transition-duration: 0\.001ms !important/);

  /**
   * Every duration in the stylesheet reads a token. A hard-coded `200ms`
   * survives the reduced-motion block, because zeroing the tokens cannot
   * reach a number that never asked for one.
   */
  const hardCoded = [...css.matchAll(/transition:[^;]*?(\d+m?s)/g)]
    .map((m) => m[0])
    .filter((d) => !d.includes('var(--motion'));

  assert.deepEqual(hardCoded, [], 'a duration that reduced motion cannot switch off');
});
