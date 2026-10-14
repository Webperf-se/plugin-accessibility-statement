import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { getCountries } from '../../lib/countries.js';

const { se: LOCALE_SE } = getCountries();

function issuesFor(bodyText) {
  const analyzer = new HarAnalyzer();
  const knowledgeData = {};
  const issues = analyzer.tryGetCompatibleText('https://example.se/a11y', bodyText, knowledgeData, LOCALE_SE);
  return { issues, knowledgeData };
}

test('fully compliant statement ("helt förenlig") raises no issue', () => {
  const { issues } = issuesFor('Webbplatsen är helt förenlig med lagen om tillgänglighet.');
  assert.deepEqual(issues, []);
});

test('partly compliant statement ("delvis förenlig") raises compatible-word-partly', () => {
  const { issues } = issuesFor('Webbplatsen är delvis förenlig med lagen om tillgänglighet.');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-partly');
});

test('non-compliant statement ("inte förenlig") raises compatible-word-not', () => {
  const { issues } = issuesFor('Webbplatsen är inte förenlig med lagen om tillgänglighet.');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'compatible-word-not');
});

test('statement with no recognized compliance phrase raises no-compatible-word', () => {
  const { issues } = issuesFor('Vi jobbar med tillgänglighet men nämner ingen laglig status här.');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
});

test('a negated "helt förenlig" fragment ("inte är helt förenlig") is not read as fully compliant', () => {
  // Real-world case (skinnskatteberg.se): the sentence literally contains
  // "helt förenlig" as a substring, but the statement actually says the
  // website is NOT fully compliant. This must not silently pass.
  const { issues } = issuesFor('Vi bedömer att webbplatsen inte är helt förenlig med lagen om tillgänglighet.');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
});

test('contiguous "inte helt förenlig" is not one of the 3 accepted phrases', () => {
  // Previously treated as a synonym for "delvis förenlig". Digg only accepts
  // "helt förenlig" / "delvis förenlig" / "inte förenlig" literally, so this
  // should now be treated as missing the required statement, not reinterpreted.
  const { issues } = issuesFor('Webbplatsen är inte helt förenlig med lagen om tillgänglighet.');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-compatible-word');
});
