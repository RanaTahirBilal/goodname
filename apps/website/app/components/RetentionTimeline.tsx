import { Icon } from './Icon';

/**
 * What we keep, and for how long, drawn to scale.
 *
 * The question a professional actually has before typing their name into
 * anything is "what will you be holding about me afterwards". It was
 * answerable only by reading the privacy section, and the answer is more
 * reassuring than the prose made it sound, because the shape is the
 * argument: the bar that holds the quotations about a person is the short
 * one.
 *
 * ## The distinction the whole retention policy rests on
 *
 * The excerpt is the personal data. The score is not. A snapshot holds a
 * number, a coverage fraction and a methodology version, which is not a
 * dossier once the quotations are gone. That sentence is in the engine's
 * own source and it is what these bar lengths say without saying it.
 *
 * ## Why the numbers are repeated here
 *
 * `DEFAULT_RETENTION` lives in `@rep/persistence`, which imports
 * `node:sqlite`. Pulling a database driver into a marketing page to render
 * four integers is the wrong trade. So they are written out, and
 * `retention-diagram.test.ts` asserts each one against the real policy: if
 * somebody changes a period, the test fails rather than the page quietly
 * misleading a reader about how long we hold their quotations.
 */

import { BANDS } from './retention-bands.ts';

const SCALE = 730;

export function RetentionTimeline() {
  return (
    <section className="wrap" style={{ paddingTop: 'var(--s-16)' }}>
      <h2 className="mark" style={{ fontSize: '1.5rem', marginBottom: 'var(--s-3)' }}>
        What we keep afterwards
      </h2>
      <p
        className="small"
        style={{ fontSize: '0.9375rem', maxWidth: '58ch', marginBottom: 'var(--s-8)' }}
      >
        Drawn to scale. The short bar is the one that matters: the quotations are the part
        that is actually about you, and they are the part that goes first.
      </p>

      <dl className="retention">
        {BANDS.map((b) => {
          const forever = b.days === 'forever';
          const width = forever ? 100 : ((b.days as number) / SCALE) * 100;

          return (
            <div key={b.label} className="retention-row">
              <dt>
                <span className="small" style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {b.label}
                </span>
                <span className="retention-length small">
                  {forever ? 'Kept' : `${b.days} days`}
                </span>
              </dt>
              <dd>
                <div
                  className={`retention-bar${b.emphasis ? ' retention-bar-strong' : ''}${
                    forever ? ' retention-bar-open' : ''
                  }`}
                >
                  <span style={{ width: `${width}%` }} />
                </div>
                <p className="small">{b.note}</p>
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="small row" style={{ marginTop: 'var(--s-6)', gap: 'var(--s-3)', alignItems: 'baseline', maxWidth: '62ch' }}>
        <span style={{ color: 'var(--primary)' }}>
          <Icon name="download" />
        </span>
        <span>
          You can download everything we hold at any time, and ask for all of it to be
          destroyed. Deletion waits 30 days so a decision made in a bad moment is
          recoverable, and then it is a real deletion rather than a flag.
        </span>
      </p>
    </section>
  );
}
