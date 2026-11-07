/**
 * The icon set. One family, drawn here, with nothing installed.
 *
 * The audit in `docs/DESIGN_AUDIT.md` found no icons anywhere in the
 * product: every status, action and affordance was carried by text alone.
 * That is not minimalism, it is a gap, and it shows most on the screens a
 * person skims rather than reads.
 *
 * ## Why these are hand-drawn rather than a package
 *
 * Twelve paths against a dependency, for a product whose runtime
 * dependencies are currently Next and React and nothing else. An icon
 * library is a supply-chain surface, a bundle, and a licence, in exchange
 * for 1,400 glyphs of which we would use twelve.
 *
 * ## The rules, which are the point
 *
 * One family means one set of decisions, applied to all of them: a 24 box,
 * 1.5 stroke, round caps and joins, no fills, geometry on the half-pixel
 * grid so edges stay crisp at 24. They take their colour from `currentColor`
 * and their size from the font, so an icon beside text is the size of that
 * text and the colour of that text, and a contrast test that passes for the
 * words passes for the icon.
 *
 * ## Decoration or meaning, never both
 *
 * An icon beside a word the icon is describing is decoration, and decoration
 * must be invisible to a screen reader, or the reader hears the label twice.
 * An icon standing alone carries meaning and needs a name. So `label` is the
 * switch: without it the SVG is `aria-hidden`; with it the SVG is an image
 * with a title. There is no third case, and no icon in this product stands
 * alone without one.
 */

export type IconName =
  | 'source'
  | 'search'
  | 'identity'
  | 'document'
  | 'check'
  | 'alert'
  | 'clock'
  | 'lock'
  | 'eye'
  | 'download'
  | 'trash'
  | 'arrow-right';

/**
 * Path data only. Every glyph is strokes on the same 24 grid, so a new one
 * is a path rather than a decision about how icons work here.
 */
const PATHS: Record<IconName, string[]> = {
  /** A link leaving the page: where a finding came from. */
  source: ['M14 4.5h5.5V10', 'M19.5 4.5 11 13', 'M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10'],
  search: ['M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z', 'M15 15l4.5 4.5'],
  /** A person, outlined rather than filled: identity is a question here. */
  identity: ['M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', 'M5 19.5a7 7 0 0 1 14 0'],
  document: ['M6.5 3.5h7L18 8v12.5H6.5Z', 'M13.5 3.5V8H18', 'M9.5 12.5h5', 'M9.5 16h5'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  /** Attention, not alarm: a line and a dot, no filled triangle. */
  alert: ['M12 4.5v9', 'M12 18.5v.5'],
  clock: ['M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z', 'M12 8v4.5l3 2'],
  lock: ['M6.5 10.5h11v9h-11Z', 'M9 10.5V8a3 3 0 0 1 6 0v2.5'],
  eye: ['M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'],
  download: ['M12 4v10.5', 'M8 11l4 4 4-4', 'M5 19.5h14'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M6.5 7l1 12.5h9L17.5 7', 'M10.5 10.5v6', 'M13.5 10.5v6'],
  'arrow-right': ['M4.5 12h14', 'M13 6.5 18.5 12 13 17.5'],
};

export interface IconProps {
  name: IconName;
  /**
   * What it means, when it is standing in for words.
   *
   * Leave it out beside a label the icon merely repeats. Supplying it makes
   * the icon an image with a name; omitting it hides the icon from assistive
   * technology entirely. Those are the only two correct answers.
   */
  label?: string;
  /** Multiplier on the current font size. 1 is the default and usually right. */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, label, scale = 1, className, style }: IconProps) {
  const size = `${scale}em`;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{
        /**
         * Sits on the text baseline rather than the line box, so an icon in
         * a sentence does not ride high and push the line height around.
         */
        verticalAlign: '-0.125em',
        flex: 'none',
        ...style,
      }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
      {/**
       * The dot on the alert glyph. A stroked path cannot draw a dot that
       * reads at 16px, and a zero-length round-capped line is a hack that
       * renders differently across browsers.
       */}
      {name === 'alert' && <circle cx="12" cy="18.75" r="0.9" fill="currentColor" stroke="none" />}
    </svg>
  );
}
