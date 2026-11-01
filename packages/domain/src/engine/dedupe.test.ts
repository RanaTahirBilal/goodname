import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, clusterStories, SAME_STORY_THRESHOLD, NEAR_IDENTICAL_THRESHOLD } from './dedupe.ts';

const item = (id: string, title: string, snippet: string, domain: string, publishedAt?: string) => ({
  id,
  title,
  snippet,
  domain,
  publishedAt,
});

test('similarity ignores stopwords and punctuation', () => {
  const a = 'The attorney was suspended from practice.';
  const b = 'Attorney suspended from practice';
  assert.ok(similarity(a, b) > 0.7, `got ${similarity(a, b)}`);
});

test('unrelated stories do not cluster', () => {
  const s = similarity(
    'Jensen Adoni named partner at Adoni Law',
    'Illinois commission suspends attorney from practice'
  );
  assert.ok(s < SAME_STORY_THRESHOLD, `got ${s}`);
});

test('identical reprints are detected as near-identical', () => {
  const text = 'The Illinois commission suspended Jensen Adoni from practice for two years.';
  assert.ok(similarity(text, text) >= NEAR_IDENTICAL_THRESHOLD);
});

test('a wire story across three outlets is one cluster with one independent source', () => {
  const text = 'The Illinois commission suspended Jensen Adoni from practice for two years following a hearing.';
  const clusters = clusterStories([
    item('a', 'Attorney suspended from practice', text, 'wire.example', '2026-03-01T00:00:00.000Z'),
    item('b', 'Attorney suspended from practice', text, 'regional.example', '2026-03-01T00:00:00.000Z'),
    item('c', 'Attorney suspended from practice', text, 'local.example', '2026-03-01T00:00:00.000Z'),
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].memberIds.length, 3);
  assert.equal(clusters[0].syndicatedIds.length, 2);
  assert.equal(
    clusters[0].independentSources,
    1,
    'three reprints of one story are one source, not three'
  );
});

test('independently written accounts of one event corroborate', () => {
  const clusters = clusterStories([
    item(
      'a',
      'Illinois commission suspends attorney Jensen Adoni from practice',
      'The Illinois disciplinary commission suspended Jensen Adoni from practice for two years following a hearing in Chicago.',
      'ledger.example',
      '2026-03-01T00:00:00.000Z'
    ),
    item(
      'b',
      'Chicago lawyer suspended from practice after commission hearing',
      'Jensen Adoni was suspended from practice for two years, the Illinois commission said after its hearing.',
      'trade.example',
      '2026-03-03T00:00:00.000Z'
    ),
  ]);

  assert.equal(clusters.length, 1, 'same event, so one cluster');
  assert.equal(clusters[0].syndicatedIds.length, 0, 'different wording, so not reprints');
  assert.equal(clusters[0].independentSources, 2);
});

test('the earliest member is the primary — a reprint cannot predate its source', () => {
  const text = 'Identical wire copy about the commission hearing and the suspension.';
  const clusters = clusterStories([
    item('late', 'Suspension', text, 'late.example', '2026-03-05T00:00:00.000Z'),
    item('early', 'Suspension', text, 'early.example', '2026-03-01T00:00:00.000Z'),
  ]);

  assert.equal(clusters[0].primaryId, 'early');
  assert.deepEqual(clusters[0].syndicatedIds, ['late']);
});

test('undated items still cluster, using the first seen as primary', () => {
  const text = 'A story about the commission hearing and the suspension of an attorney.';
  const clusters = clusterStories([
    item('a', 'Suspension', text, 'a.example'),
    item('b', 'Suspension', text, 'b.example'),
  ]);

  assert.equal(clusters[0].primaryId, 'a');
});

test('a single item is its own cluster with one source', () => {
  const clusters = clusterStories([item('a', 'A title', 'A snippet about something.', 'a.example')]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].independentSources, 1);
  assert.equal(clusters[0].syndicatedIds.length, 0);
});

test('empty text does not match everything', () => {
  assert.equal(similarity('', 'anything at all'), 0);
  assert.equal(similarity('the a of', 'and or but'), 0);
});
