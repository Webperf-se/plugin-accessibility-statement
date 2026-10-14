import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { getCountries } from '../../lib/countries.js';

const { no: LOCALE_NO, se: LOCALE_SE } = getCountries();

// Real-world case (bufdir.no): a statement mentions both when it was first
// created and when it was last updated, both under the same marker word
// ("erklæring", weight 0.9). Sorting by weight alone leaves a tie, and code
// previously broke that tie by picking whichever happened to be *last* in
// the array after a descending sort (`.pop()` after `sort((a,b) => b-a)`
// removes the lowest-ranked element, not the highest) - here that picked the
// older "first created" date instead of the newer "last updated" one.
test('among same-weight date candidates, the more recent date wins, not an arbitrary array-order tiebreak', () => {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  const bodyText = 'Tilgjengelighetserklæringen er sist oppdatert 05. januar 2026. '
    + 'Tilgjengelighetserklæring for dette nettstedet ble opprettet første gang 17. januar 2023.';
  const issues = analyzer.tryGetUpdatedDate('https://example.no/a11y', bodyText, knowledgeData, LOCALE_NO);
  assert.equal(issues.length, 0, `expected no date issue (2026 date is recent), got: ${JSON.stringify(issues)}`);
});

test('Swedish: a higher-weight marker ("redogörelse") still wins over a more recent but lower-weight one ("uppdater")', () => {
  // Weight always outranks recency - recency is only the tiebreaker between
  // equal weights. This is the real skinnskatteberg.se case: the statement's
  // own "redogörelse ... 2020" date (weight 0.9) correctly outranks a generic
  // page-footer "Senast uppdaterad: 2024" timestamp (weight 0.5), even though
  // 2024 is more recent.
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  const bodyText = 'Tillgänglighetsredogörelsen uppdaterades senast den 23 september 2020. '
    + 'Senast uppdaterad: 20 augusti 2024.';
  const issues = analyzer.tryGetUpdatedDate('https://example.se/a11y', bodyText, knowledgeData, LOCALE_SE);
  assert.ok(issues.some(i => i.rule.startsWith('updated-date-older-than')), `expected the 2020 date to be picked (and flagged as old), got: ${JSON.stringify(issues)}`);
});

test('Swedish: among two same-weight ("redogörelse") dates, the more recent one wins', () => {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  const bodyText = 'Redogörelsen skapades första gången 23 september 2020. '
    + 'Redogörelsen uppdaterades senast 20 augusti 2026.';
  const issues = analyzer.tryGetUpdatedDate('https://example.se/a11y', bodyText, knowledgeData, LOCALE_SE);
  assert.equal(issues.length, 0, `expected no date issue (2026 date is recent), got: ${JSON.stringify(issues)}`);
});
