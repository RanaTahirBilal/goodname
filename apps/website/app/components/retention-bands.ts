/**
 * The retention bands the landing page draws.
 *
 * Data in a `.ts` of its own rather than beside the component, for a dull
 * and decisive reason: Node runs TypeScript by stripping types, which does
 * not extend to JSX, so nothing in a `.tsx` can be imported by a test. The
 * numbers on this page are a promise to somebody about their own personal
 * data, and a promise worth making is worth asserting against the policy
 * that implements it. See `retention-diagram.test.ts`.
 */

export interface Band {
  label: string;
  days: number | 'forever';
  note: string;
  /** The one that is personal data, drawn so it reads as the point. */
  emphasis?: boolean;
}

/** Checked against DEFAULT_RETENTION by a test. Do not edit one without the other. */
export const BANDS: Band[] = [
  {
    label: 'The quotations',
    days: 180,
    note: 'Titles and excerpts: the only thing here that is really about you. Deleted after six months, a whole scan at a time.',
    emphasis: true,
  },
  {
    label: 'A reviewer’s decision, and the log of who read what',
    days: 730,
    note: 'Kept longer than the material it concerns, on purpose. Accountability for a judgement about a person should outlive the thing it was made on.',
  },
  {
    label: 'Your session',
    days: 30,
    note: 'A row we can revoke, not a signed token we cannot.',
  },
  {
    label: 'The score, its coverage and its methodology version',
    days: 'forever',
    note: 'A number, a fraction and a version string. Kept, so you can see what changed and when.',
  },
];

