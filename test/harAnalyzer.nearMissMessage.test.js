import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../lib/harAnalyzer.js';
import { LOCALE_SE, LOCALE_DK, LOCALE_NO, LOCALE_FI } from '../lib/locales.js';

function issuesFor(bodyText, locale) {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  return analyzer.tryGetCompatibleText('https://example.test/a11y', bodyText, knowledgeData, locale);
}

test('Swedish: a negated near-miss ("inte helt förenlig") still scores as no-compatible-word, but with a specific message', () => {
  const issues = issuesFor('Webbplatsen är inte helt förenlig med lagen om tillgänglighet.', LOCALE_SE);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
  assert.equal(issues[0].severity, 'error');
  assert.match(issues[0].text, /not one of the .* required|near.miss|non-standard/i);
});

test('Swedish: true absence of any compliance wording keeps the generic message', () => {
  const issues = issuesFor('Vi jobbar med tillganglighet men namner ingen laglig status har.', LOCALE_SE);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
  assert.equal(issues[0].text, 'Lacks any specific statement on the legal compliancy');
});

test('Danish: a negated near-miss gets the specific message too', () => {
  // Contains the literal "opfylder standarden fuldt ud" substring, but "ikke"
  // earlier in the same clause negates it - same shape of bug as the Swedish
  // "inte är helt förenlig" case.
  const issues = issuesFor('Det er ikke korrekt at sige at webstedet opfylder standarden fuldt ud.', LOCALE_DK);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
  assert.match(issues[0].text, /not one of the .* required|near.miss|non-standard/i);
});

test('Norwegian: a negated near-miss gets the specific message too', () => {
  const issues = issuesFor('Nettstedet er dessverre ikke fullt ut i samsvar med kravene.', LOCALE_NO);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
  assert.match(issues[0].text, /not one of the .* required|near.miss|non-standard/i);
});
