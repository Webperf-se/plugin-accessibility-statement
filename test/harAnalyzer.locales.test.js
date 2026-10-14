import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../lib/harAnalyzer.js';
import { LOCALE_SE, LOCALE_DK, LOCALE_NO, LOCALE_FI } from '../lib/locales.js';

function issuesFor(bodyText, locale) {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  const issues = analyzer.tryGetCompatibleText('https://example.test/a11y', bodyText, knowledgeData, locale);
  return { issues, knowledgeData };
}

test('Swedish locale still resolves after the locale-parametrization refactor', () => {
  const full = issuesFor('Webbplatsen är helt förenlig med lagen om tillgänglighet.', LOCALE_SE);
  assert.deepEqual(full.issues, []);

  const negated = issuesFor('Vi bedömer att webbplatsen inte är helt förenlig med lagen om tillgänglighet.', LOCALE_SE);
  assert.equal(negated.issues[0].rule, 'no-compatible-word');
});

test('Danish: official "opfylder standarden fuldt ud" is fully compliant', () => {
  const { issues } = issuesFor('Webstedet opfylder standarden fuldt ud.', LOCALE_DK);
  assert.deepEqual(issues, []);
});

test('Danish: real-world "overholder loven delvist" (kl.dk) is partly compliant', () => {
  const { issues } = issuesFor('Webstedet overholder loven delvist (overholder de fleste krav).', LOCALE_DK);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-partly');
});

test('Danish: "opfylder ikke standarden" is not compliant', () => {
  const { issues } = issuesFor('Hjemmesiden opfylder ikke standarden endnu.', LOCALE_DK);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-not');
});

test('Danish: a negated "fuldt ud" fragment is not read as fully compliant', () => {
  const { issues } = issuesFor('Vi vurderer at webstedet desværre ikke lever fuldt ud op til standarden.', LOCALE_DK);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
});

test('Norwegian: "er i samsvar med kravene" is fully compliant', () => {
  const { issues } = issuesFor('Nettstedet er i samsvar med kravene til universell utforming.', LOCALE_NO);
  assert.deepEqual(issues, []);
});

test('Norwegian: real-world "delvis i samsvar" (bufdir.no) is partly compliant', () => {
  const { issues } = issuesFor('Nettstedet er delvis i samsvar med kravene til universell utforming av ikt.', LOCALE_NO);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-partly');
});

test('Norwegian: "ikke i samsvar" is not compliant', () => {
  const { issues } = issuesFor('Nettstedet er ikke i samsvar med kravene.', LOCALE_NO);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-not');
});

test('Norwegian: a differently-worded negation is not read as fully compliant', () => {
  const { issues } = issuesFor('Nettstedet er dessverre ikke fullt ut i samsvar med kravene.', LOCALE_NO);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
});

test('Finnish: "täyttää kokonaan" is fully compliant', () => {
  const { issues } = issuesFor('Tämä verkkopalvelu täyttää kokonaan lain vaatimat saavutettavuuskriteerit.', LOCALE_FI);
  assert.deepEqual(issues, []);
});

test('Finnish: real-world "täyttää osittain" (ilmatieteenlaitos.fi) is partly compliant', () => {
  const { issues } = issuesFor('Tämä verkkopalvelu täyttää osittain lain vaatimat A- ja AA-tason saavutettavuuskriteerit.', LOCALE_FI);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-partly');
});

test('Finnish: "ei täytä" is not compliant', () => {
  const { issues } = issuesFor('Tämä verkkopalvelu ei täytä saavutettavuusvaatimuksia.', LOCALE_FI);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-not');
});

test('a statement with no recognized phrase in any locale raises no-compatible-word', () => {
  for (const locale of [LOCALE_DK, LOCALE_NO, LOCALE_FI]) {
    const { issues } = issuesFor('Vi jobbar med tillganglighet men namner ingen laglig status har.', locale);
    assert.equal(issues.length, 1, `locale ${locale.code}`);
    assert.equal(issues[0].rule, 'no-compatible-word', `locale ${locale.code}`);
  }
});
