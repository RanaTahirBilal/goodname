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

/** Pulls `--name: value;` pairs out of one declaration block. */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*--([\w-]+):\s*([^;]+);/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
assert.ok(rootBlock, 'no :root block found in globals.css');

/**
 * The dark theme is checked as its own palette, not as an afterthought.
 *
 * `[data-theme='dark']` is the explicit opt-in block and carries the same
 * declarations as the `prefers-color-scheme` one, so reading it is reading
 * the dark palette. A dark theme nobody measures is how an accent ends up at
 * 2.4:1 on its own background and ships, because it "looked fine".
 */
const darkBlock = /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/.exec(css);
assert.ok(darkBlock, "no :root[data-theme='dark'] block found in globals.css");

const light = declarations(rootBlock![1]);
const dark = { ...light, ...declarations(darkBlock![1]) };

/**
 * Every test below runs over both themes.
 *
 * `themes` is what makes that cheap: a failure names which theme broke, so
 * the message says `dark: text-2 on surface` rather than leaving someone to
 * work out which palette the number came from.
 */
const themes: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['light', light],
  ['dark', dark],
];

/**
 * The light palette, for the handful of assertions that are genuinely about
 * one theme. Most are not, and use `themes` instead.
 */
const T = light;

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

test('every token referenced by the tests exists in both themes', () => {
  for (const [theme, P] of themes) {
    for (const key of [
      'primary', 'primary-dark', 'on-primary', 'bg', 'surface', 'surface-sunken',
      'text', 'text-2', 'border', 'border-strong',
      'warning', 'danger', 'success',
      'warning-bg', 'danger-bg', 'success-bg', 'info-bg',
    ]) {
      assert.ok(P[key], `${theme}: missing token --${key}`);
    }
  }
});

/**
 * The dark palette has to be its own set of values, not the light one again.
 *
 * Inheriting a token into dark is how a near-black body colour ends up on a
 * near-black ground. The contrast checks below would catch the worst of it,
 * but this says the intent directly: these are the tokens that must differ.
 */
test('dark redefines every colour it needs to, rather than inheriting', () => {
  for (const key of [
    'bg', 'surface', 'surface-sunken', 'text', 'text-2',
    'primary', 'primary-dark', 'on-primary', 'border', 'border-strong',
    'warning', 'danger', 'success',
    'warning-bg', 'danger-bg', 'success-bg', 'info-bg',
  ]) {
    assert.notEqual(
      dark[key],
      light[key],
      `--${key} is the same in both themes; dark is not an inversion, it is a palette`
    );
  }
});

test('body text clears 4.5:1 on every surface it is used on', () => {
  for (const [theme, P] of themes) {
    for (const name of ['bg', 'surface', 'surface-sunken'] as const) {
      check(`${theme}: text on ${name}`, P.text, P[name], 4.5);
      check(`${theme}: text-2 on ${name}`, P['text-2'], P[name], 4.5);
    }
  }
});

test('the primary colour works as a link and as a button fill', () => {
  for (const [theme, P] of themes) {
    check(`${theme}: primary on bg`, P.primary, P.bg, 4.5);
    check(`${theme}: primary on surface`, P.primary, P.surface, 4.5);

    /**
     * Not white — `--on-primary`.
     *
     * In dark the accent lightens to stay legible on a dark ground, which
     * means the text on top of a primary button has to darken. An earlier
     * version of this check hard-coded white, which would have passed in
     * light and said nothing about the theme where it mattered.
     */
    check(`${theme}: on-primary on primary`, P['on-primary'], P.primary, 4.5);
    check(`${theme}: on-primary on primary-dark`, P['on-primary'], P['primary-dark'], 4.5);
  }
});

test('status colours are legible on their own tinted backgrounds', () => {
  for (const [theme, P] of themes) {
    check(`${theme}: warning on warning-bg`, P.warning, P['warning-bg'], 4.5);
    check(`${theme}: danger on danger-bg`, P.danger, P['danger-bg'], 4.5);
    check(`${theme}: success on success-bg`, P.success, P['success-bg'], 4.5);
    check(`${theme}: text-2 on info-bg`, P['text-2'], P['info-bg'], 4.5);
  }
});

test('status colours are legible on plain surfaces too', () => {
  for (const [theme, P] of themes) {
    for (const key of ['warning', 'danger', 'success'] as const) {
      check(`${theme}: ${key} on surface`, P[key], P.surface, 4.5);
      check(`${theme}: ${key} on bg`, P[key], P.bg, 4.5);
    }
  }
});

test('notice text is legible on its tinted background', () => {
  for (const [theme, P] of themes) {
    check(`${theme}: text on warning-bg`, P.text, P['warning-bg'], 4.5);
    check(`${theme}: text on danger-bg`, P.text, P['danger-bg'], 4.5);
    check(`${theme}: text on info-bg`, P.text, P['info-bg'], 4.5);
  }
});

test('control outlines meet the 3:1 non-text threshold', () => {
  for (const [theme, P] of themes) {
    check(`${theme}: border-strong on surface`, P['border-strong'], P.surface, 3);
    check(`${theme}: border-strong on bg`, P['border-strong'], P.bg, 3);
  }
});

/**
 * The two dark blocks must agree.
 *
 * Dark is declared twice: once under `prefers-color-scheme` for readers who
 * have asked their system for it, and once under `[data-theme='dark']` for an
 * explicit choice. Only the second is read above, so if they ever drift, the
 * palette the tests measure stops being the palette most readers see.
 */
test('both dark declarations carry the same values', () => {
  const media = /@media \(prefers-color-scheme: dark\)[\s\S]*?\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n  \}/.exec(css);
  assert.ok(media, 'no prefers-color-scheme dark block found in globals.css');

  assert.deepEqual(
    declarations(media![1]),
    declarations(darkBlock![1]),
    'the media-query dark palette and the explicit dark palette have drifted apart'
  );
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
