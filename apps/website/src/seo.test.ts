/**
 * What the crawler directives must agree about.
 *
 * Two files decide whether this site is readable — `robots.ts` and the
 * `robots` key on each page's metadata — and they are edited months apart
 * by people solving different problems. The failure they produce is not a
 * crash: it is a sitemap that invites a crawler to a page whose header
 * tells it to leave, which nobody notices until an indexing report is
 * mysteriously empty.
 *
 * These assertions are about the shape of the configuration rather than its
 * values, so they hold whichever way the launch flag is set when the suite
 * runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ASSISTANT_CRAWLERS, PRIVATE_PATHS, PUBLIC_PATHS } from './seo.ts';

const here = dirname(fileURLToPath(import.meta.url));
const app = (...p: string[]) => join(here, '..', 'app', ...p);
const read = (...p: string[]) => readFileSync(app(...p), 'utf8');

test('indexing is closed unless a deployment says otherwise', () => {
  const seo = readFileSync(join(here, 'seo.ts'), 'utf8');

  assert.match(
    seo,
    /INDEXABLE\s*=\s*process\.env\.REP_INDEXABLE\s*===\s*'true'/,
    'the launch flag is not an exact string comparison, so a stray value opens the site'
  );
});

test('every private path is disallowed and absent from the sitemap', () => {
  for (const path of PRIVATE_PATHS) {
    assert.ok(
      !PUBLIC_PATHS.includes(path),
      `${path} is listed as both private and public`
    );
  }

  // The sitemap is built from PUBLIC_PATHS, so this is the whole check.
  for (const path of PUBLIC_PATHS) {
    assert.ok(
      !PRIVATE_PATHS.some((p) => path.startsWith(p)),
      `the sitemap would list ${path}, which robots.ts disallows`
    );
  }
});

/**
 * The contradiction this file exists for.
 *
 * `/audit` is in the sitemap. It must therefore take its indexing from the
 * launch flag rather than refusing unconditionally — otherwise the site
 * ships a sitemap pointing at a page that says `noindex`, which is a
 * request to crawl something and then an instruction to forget it.
 */
test('a page in the sitemap does not hard-code noindex', () => {
  const page = read('audit', 'page.tsx');

  assert.match(page, /INDEXABLE/, '/audit is in the sitemap but ignores the launch flag');
  assert.doesNotMatch(
    page.replace(/\/\*\*[\s\S]*?\*\//g, ''),
    /robots:\s*\{\s*index:\s*false/,
    '/audit hard-codes noindex while the sitemap advertises it'
  );
});

test('the pages that must never be indexed still say so unconditionally', () => {
  for (const name of ['signin', 'account', 'review']) {
    const page = read(name, 'page.tsx');

    assert.match(
      page.replace(/\/\*\*[\s\S]*?\*\//g, ''),
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/,
      `/${name} no longer refuses indexing outright`
    );
    assert.doesNotMatch(
      page,
      /INDEXABLE/,
      `/${name} was wired to the launch flag; it must stay closed whatever that says`
    );
  }
});

test('the assistant crawlers are named, not left to the wildcard', () => {
  const robots = read('robots.ts');

  // Several of these honour only their own user-agent, so a `*` rule does
  // not reach them. Naming them is the decision; this holds the list to it.
  for (const agent of ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'PerplexityBot']) {
    assert.ok(
      ASSISTANT_CRAWLERS.includes(agent),
      `${agent} is not in the crawler list`
    );
  }

  assert.match(robots, /ASSISTANT_CRAWLERS/, 'robots.ts does not use the crawler list');
  assert.match(
    robots,
    /sitemap:/,
    'robots.txt does not declare the sitemap, so it has to be found by guesswork'
  );
});

test('robots.txt closes everything while the site is unlaunched', () => {
  const robots = read('robots.ts');

  assert.match(
    robots,
    /if\s*\(!INDEXABLE\)[\s\S]{0,200}disallow:\s*'\/'/,
    'an unlaunched deployment does not disallow crawling'
  );
});

/**
 * The parity rule, enforced by not taking the risk.
 *
 * FAQ and HowTo markup whose questions are not also readable on the page
 * breaks Google's structured data rules, and the breach is invisible in the
 * rendered page. The site declares neither, so there is nothing to keep in
 * sync — and this test fails if somebody adds one without also adding the
 * check that the text exists.
 */
test('no structured data makes claims the page does not show', () => {
  const layout = read('layout.tsx');

  for (const type of ['FAQPage', 'HowTo', 'aggregateRating', 'Review']) {
    assert.doesNotMatch(
      layout,
      new RegExp(`'@type':\\s*'${type}'|${type}:`),
      `${type} markup was added without a visible-text parity check`
    );
  }

  assert.match(layout, /'@type':\s*'Organization'/);
  assert.match(layout, /'@type':\s*'WebSite'/);
});
