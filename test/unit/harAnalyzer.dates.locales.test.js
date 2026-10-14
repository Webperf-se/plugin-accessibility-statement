import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { getCountries } from '../../lib/countries.js';

const { dk: LOCALE_DK, no: LOCALE_NO, fi: LOCALE_FI } = getCountries();

function dateIssuesFor(bodyText, locale) {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  return analyzer.tryGetUpdatedDate('https://example.test/a11y', bodyText, knowledgeData, locale);
}

test('Danish: "revideret den 23. april 2026" (period after day) is recognized as an update date', () => {
  const issues = dateIssuesFor('Erklæringen blev senest revideret den 23. april 2026.', LOCALE_DK);
  assert.equal(issues.find(i => i.rule === 'no-updated-date'), undefined);
});

test('Norwegian: "sist oppdatert 05. januar 2026" (period after day) is recognized as an update date', () => {
  const issues = dateIssuesFor('Tilgjengelighetserklæringen er sist oppdatert 05. januar 2026.', LOCALE_NO);
  assert.equal(issues.find(i => i.rule === 'no-updated-date'), undefined);
});

test('Finnish: dot-separated numeric date "päivitetty viimeksi 23.1.2026" is recognized as an update date', () => {
  const issues = dateIssuesFor('Selostetta on päivitetty viimeksi 23.1.2026.', LOCALE_FI);
  assert.equal(issues.find(i => i.rule === 'no-updated-date'), undefined);
});
