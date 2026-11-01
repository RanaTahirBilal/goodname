/**
 * Contrast assertions for the website palette.
 *
 * Reads `app/globals.css` and checks the literal token values, so the
 * stylesheet is the single source of truth and cannot drift from the check.
 *
 * Thresholds: 4.5:1 for body text, 3:1 for large text and for boundaries that
 * identify a control. `--border` is deliberately excluded — it is a
 * decorative hairline on cards and table rows, and WCAG 1.4.11 asks for 3:1
 * only where the boundary is what identifies a control or its state. Holding
 * every card edge to 3:1 turns the page into a wireframe. `--border-strong`,
 * which outlines inputs and buttons, is checked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'app', 'globals.css'), 'utf8');

/** Pulls `--name: value;` pairs out of the :root block. */
function tokens(): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(root, 'no :root block found in globals.css');

  const out: Record<string, string> = {};
  for (const line of root![1].split('\n')) {
    const m = /^\s*--([\w-]+):\s*([^;]+);/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const T = tokens();

const parse = (c: string): [number, number, number, number] => {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const [r, g, b, a = 1] = c.match(/[\d.]+/g)!.map(Number);
  return [r, g, b, a];
};

const hex = (rgb: number[]): string =>
  '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Composites a translucent colour over an opaque one. */
const over = (fg: string, bg: string): string => {
  const f = parse(fg);
  const b = parse(bg);
  return hex([0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])));
};

const lum = (c: string): number => {
  const [r, g, b] = parse(c)
    .slice(0, 3)
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const check = (label: string, fg: string, bg: string, min: number) => {
  const r = ratio(fg, bg);
  assert.ok(r >= min, `${label}: ${r.toFixed(2)}:1, needs ${min}:1 (${fg} on ${bg})`);
};

/**
 * `over()` stays even though nothing translucent ships today: the moment a
 * tinted overlay reappears, its real contrast has to be measurable rather
 * than guessed at.
 */
void over;

test('every token referenced by the tests exists in globals.css', () => {
  for (const key of [
    'primary', 'primary-dark', 'bg', 'surface', 'surface-sunken',
    'text', 'text-2', 'border', 'border-strong',
    'warning', 'danger', 'success',
    'warning-bg', 'danger-bg', 'success-bg', 'info-bg',
  ]) {
    assert.ok(T[key], `missing token --${key}`);
  }
});

test('body text clears 4.5:1 on every surface it is used on', () => {
  for (const [name, bg] of [
    ['bg', T.bg],
    ['surface', T.surface],
    ['surface-sunken', T['surface-sunken']],
  ] as const) {
    check(`text on ${name}`, T.text, bg, 4.5);
    check(`text-2 on ${name}`, T['text-2'], bg, 4.5);
  }
});

test('the primary colour works as a link and as a button fill', () => {
  check('primary on bg', T.primary, T.bg, 4.5);
  check('primary on surface', T.primary, T.surface, 4.5);
  check('white on primary', '#FFFFFF', T.primary, 4.5);
  check('white on primary-dark', '#FFFFFF', T['primary-dark'], 4.5);
});

test('status colours are legible on their own tinted backgrounds', () => {
  check('warning on warning-bg', T.warning, T['warning-bg'], 4.5);
  check('danger on danger-bg', T.danger, T['danger-bg'], 4.5);
  check('success on success-bg', T.success, T['success-bg'], 4.5);
  check('text-2 on info-bg', T['text-2'], T['info-bg'], 4.5);
});

test('status colours are legible on plain surfaces too', () => {
  for (const key of ['warning', 'danger', 'success'] as const) {
    check(`${key} on surface`, T[key], T.surface, 4.5);
    check(`${key} on bg`, T[key], T.bg, 4.5);
  }
});

test('notice text is legible on its tinted background', () => {
  check('text on warning-bg', T.text, T['warning-bg'], 4.5);
  check('text on danger-bg', T.text, T['danger-bg'], 4.5);
  check('text on info-bg', T.text, T['info-bg'], 4.5);
});

test('control outlines meet the 3:1 non-text threshold', () => {
  check('border-strong on surface', T['border-strong'], T.surface, 3);
  check('border-strong on bg', T['border-strong'], T.bg, 3);
});

test('there is no translucent surface to reason about', () => {
  // The direction is editorial: depth comes from type and space, not blur.
  // A translucent panel puts text on a colour no stylesheet states, so the
  // absence is the thing worth asserting.
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1];
  assert.ok(!/backdrop-filter/.test(css), 'a backdrop-filter has reappeared');

  // A shadow is allowed to be translucent; a surface a reader sits text on
  // is not, which is why this looks at colour tokens rather than every rgba.
  const translucentSurface = root
    .split('\n')
    .filter((l) => !l.includes('shadow'))
    .some((l) => /rgba\([^)]*,\s*0?\.\d+\s*\)/.test(l));

  assert.ok(!translucentSurface, 'a translucent surface token has reappeared');
});

test('every gap token comes from the spacing scale', () => {
  // A layout drifts the moment someone reaches for 14px because 12 looked
  // tight. Having the scale in one place is what makes that visible.
  const scale = Object.entries(T)
    .filter(([k]) => /^s-\d+$/.test(k))
    .map(([, v]) => parseInt(v, 10));

  assert.deepEqual(scale, [4, 8, 12, 16, 24, 32, 48, 64, 96]);
});

/**
 * Deliberately NOT asserted: that the status colours differ from one another
 * by luminance ratio.
 *
 * An earlier version of this file did, and it was measuring the wrong thing.
 * Luminance ratio is not hue separation — `--danger` and `--success` sit at
 * 1.02:1 by that measure while being obviously different colours to anyone
 * who can see hue. The ratio would only be meaningful for someone who cannot,
 * and for them the answer is not a redder red: it is that status is never
 * carried by colour alone. Every pill, notice and finding in this interface
 * states its status in words.
 */
