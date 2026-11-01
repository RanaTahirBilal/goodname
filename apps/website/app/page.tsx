/**
 * The landing page.
 *
 * No glass, no gradient wash, no blurred orbs. The hero earns attention from
 * one large headline and a single accent-coloured action; the preview beside
 * it is a flat card, because the thing worth showing is the report's clarity
 * rather than a surface treatment around it.
 */
export default function Home() {
  return (
    <>
      <section style={{ borderBottom: '1px solid var(--border)' }}>

        <div className="wrap" style={{ padding: 'var(--s-16) var(--s-6) var(--s-12)' }}>
          <div className="cols cols-score" style={{ alignItems: 'center', gap: 'var(--s-12)' }}>
            <div className="stack">
              <p className="eyebrow">For attorneys, physicians, founders and executives</p>
              <h1 style={{ maxWidth: 560 }}>
                Understand what people find when they search for you.
              </h1>
              <p className="lede" style={{ maxWidth: 520 }}>
                We search for your name, show you what actually ranks, and explain what each
                result is based on — with the source, the date and how confident we are that
                it is even about you.
              </p>

              <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                <a href="/audit" className="btn btn-primary">
                  Check My Reputation
                </a>
                <span className="small">Free. No card. Self-audit only.</span>
              </div>

              <ul
                className="small stack"
                style={{ listStyle: 'none', marginTop: 20, ['--gap' as string]: '8px' }}
              >
                {[
                  'Every finding links to its source and the date we saw it.',
                  'Allegations are labelled as allegations, never as findings.',
                  'We tell you when the evidence is too thin to score.',
                ].map((line) => (
                  <li key={line} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <span aria-hidden style={{ color: 'var(--primary)', fontWeight: 700 }}>
                      ✓
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <HeroPreview />
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingTop: 24 }}>
        <div className="cols cols-2" style={{ gap: 20 }}>
          <article className="card stack" style={{ ['--gap' as string]: '10px' }}>
            <h2 style={{ fontSize: '1.25rem' }}>What we will tell you</h2>
            <p className="small">
              How established your presence is, what negative material exists and how settled
              it is, how sure we are that any of it is you, and what is worth doing next.
              Each point carries the evidence behind it.
            </p>
          </article>

          <article className="card stack" style={{ ['--gap' as string]: '10px' }}>
            <h2 style={{ fontSize: '1.25rem' }}>What we will not</h2>
            <p className="small">
              We do not promise rankings, removals or a higher score. We do not treat
              criticism as damage. We do not look up other people — this is a self-audit, and
              it is limited to that on purpose.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}

/**
 * A static impression of the report, not a live one. Labelled as an example so
 * nobody mistakes a marketing illustration for their own data.
 */
function HeroPreview() {
  return (
    <div className="card" aria-label="Example of an audit report">
      <p className="eyebrow" style={{ marginBottom: 14 }}>Example report</p>

      <div className="row" style={{ alignItems: 'flex-end', gap: 14, marginBottom: 6 }}>
        <span className="hero-figure" style={{ fontSize: '3.25rem' }}>
          71
        </span>
        <span className="small" style={{ paddingBottom: 8 }}>
          online presence · 88% coverage
        </span>
      </div>

      <div className="stack" style={{ ['--gap' as string]: '10px', marginTop: 18 }}>
        {[
          ['Discoverability & ownership', 0.74],
          ['Profile completeness', 0.63],
          ['Source authority', 0.43],
        ].map(([label, v]) => (
          <div key={label as string}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="small" style={{ color: 'var(--text)' }}>{label}</span>
              <span className="small">{Math.round((v as number) * 100)}</span>
            </div>
            <div className="meter">
              <span style={{ width: `${(v as number) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="eyebrow">Reputation risk</span>
          <span className="pill pill-warning">Elevated</span>
        </div>
        <p className="small">
          One unsettled allegation, reported but not established. Shown separately so it
          cannot disappear into an average.
        </p>
      </div>
    </div>
  );
}
