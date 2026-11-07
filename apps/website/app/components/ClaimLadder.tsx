import { Icon, type IconName } from './Icon';

/**
 * How something negative becomes a finding, and how often it does not.
 *
 * This is the distinction the whole product turns on, and until now the
 * landing page made it in a sentence: "allegations are labelled as
 * allegations, never as findings." A sceptical professional reading that
 * has no way to tell whether it means anything, because every product in
 * this category says something like it. What makes it true here is the
 * specific set of conditions, and conditions are a shape.
 *
 * Three tiers, and the gates between them are the content. Most negative
 * material stops at the second tier for ever, which is the fact worth
 * leaving somebody with.
 *
 * ## Why this is HTML and not an SVG
 *
 * A diagram whose content is words should be made of words. SVG text does
 * not reflow, does not wrap, cannot be selected or searched, and at 320px
 * either overflows or shrinks past legibility. Everything drawn here is a
 * box, a rule and a label, so CSS does it better and a screen reader gets
 * the real thing rather than a `<desc>` somebody has to remember to update.
 */

interface Tier {
  label: string;
  icon: IconName;
  what: string;
  /** What it takes to leave this tier, or null for the top. */
  gate: string | null;
  tone: 'neutral' | 'warning' | 'danger';
}

const TIERS: Tier[] = [
  {
    label: 'Mentioned',
    icon: 'search',
    what: 'A result says something negative about the name we searched.',
    gate: 'Is it about you at all? Unsure means we ask you rather than guess.',
    tone: 'neutral',
  },
  {
    label: 'Allegation',
    icon: 'alert',
    what:
      'Reported, not established. It appears in your report, labelled, and it is never counted as a proven fact.',
    gate:
      'An official record that a person has read and upheld in writing, or two genuinely independent sources. Syndicated reprints of one story are one source.',
    tone: 'warning',
  },
  {
    label: 'Established finding',
    icon: 'document',
    what:
      'The strongest thing we will say. Most negative material never reaches this tier, and we would rather tell you that than round it up.',
    gate: null,
    tone: 'danger',
  },
];

export function ClaimLadder() {
  return (
    <section className="wrap" style={{ paddingTop: 'var(--s-16)' }}>
      <h2 className="mark" style={{ fontSize: '1.5rem', marginBottom: 'var(--s-3)' }}>
        What it takes to call something a finding
      </h2>
      <p
        className="small"
        style={{ fontSize: '0.9375rem', maxWidth: '58ch', marginBottom: 'var(--s-8)' }}
      >
        Every product in this category promises not to confuse an accusation with a fact.
        The promise is only worth anything as a list of conditions, so here are ours.
      </p>

      <ol className="ladder">
        {TIERS.map((tier, i) => (
          <li key={tier.label}>
            <div className={`ladder-tier ladder-${tier.tone}`}>
              <p className="row" style={{ gap: 'var(--s-3)', alignItems: 'baseline' }}>
                <Icon name={tier.icon} />
                <strong>{tier.label}</strong>
              </p>
              <p className="small" style={{ marginTop: 'var(--s-2)' }}>
                {tier.what}
              </p>
            </div>

            {tier.gate && (
              /**
               * The gate is between the tiers rather than inside either,
               * because it belongs to neither: it is the cost of moving.
               * Rendered as a step rather than an arrow, since what it
               * describes is a requirement and not a direction.
               */
              <p className="ladder-gate small">
                <span className="ladder-gate-mark" aria-hidden>
                  <Icon name="arrow-right" />
                </span>
                <span>
                  <strong>To go further:</strong> {tier.gate}
                </span>
              </p>
            )}
          </li>
        ))}
      </ol>

      <p className="small" style={{ marginTop: 'var(--s-6)', maxWidth: '58ch' }}>
        <span style={{ color: 'var(--text-2)' }}>
          <Icon name="clock" />
        </span>{' '}
        A correction or a retraction takes a claim off this ladder entirely. It is still
        shown, because removing it quietly would hide the correction as well as the claim.
      </p>
    </section>
  );
}
