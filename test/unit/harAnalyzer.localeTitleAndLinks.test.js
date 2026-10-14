import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { getCountries } from '../../lib/countries.js';

const { se: LOCALE_SE, dk: LOCALE_DK, no: LOCALE_NO, fi: LOCALE_FI } = getCountries();

function domFromHtml(html) {
  const dom = new JSDOM(html);
  return { doc: dom.window.document, body: dom.window.document.querySelector('body') };
}

test('looks_like_a11y_statement recognizes each locale\'s own title word, not another locale\'s', () => {
  const analyzer = new HarAnalyzer();
  const cases = [
    { locale: LOCALE_SE, html: '<html><head><title>x</title></head><body><h1>Tillgänglighetsredogörelse</h1></body></html>' },
    { locale: LOCALE_DK, html: '<html><head><title>x</title></head><body><h1>Tilgængelighedserklæring</h1></body></html>' },
    { locale: LOCALE_NO, html: '<html><head><title>x</title></head><body><h1>Tilgjengelegheitserklæring</h1></body></html>' },
    { locale: LOCALE_FI, html: '<html><head><title>x</title></head><body><h1>Saavutettavuusseloste</h1></body></html>' },
  ];
  for (const { locale, html } of cases) {
    const { doc, body } = domFromHtml(html);
    const knowledgeData = {};
    assert.equal(
      analyzer.looks_like_a11y_statement(knowledgeData, body, doc, locale),
      true,
      `locale ${locale.code} should recognize its own title`
    );
  }
});

test('looks_like_a11y_statement does not cross-match a different locale\'s title word', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<html><head><title>x</title></head><body><h1>Tillgänglighetsredogörelse</h1></body></html>');
  const knowledgeData = {};
  assert.equal(analyzer.looks_like_a11y_statement(knowledgeData, body, doc, LOCALE_DK), false);
});

test('tryGetNotificationUrl (Danish): a digst.dk link satisfies the report-link check', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<body><a href="mailto:webtilsyn@digst.dk">Klag til Digitaliseringsstyrelsen</a></body>');
  const knowledgeData = {};
  const issues = analyzer.tryGetNotificationUrl('https://example.dk/a11y', body, doc, knowledgeData, LOCALE_DK);
  // The right link is reported as info (has-canonical-notification-function-link),
  // which does not affect the score; nothing may be an error or warning.
  assert.deepEqual(issues.filter(i => i.severity !== 'info'), []);
});

test('tryGetNotificationUrl (Danish): missing report link raises no-notification-function-link', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<body><p>No relevant links here.</p></body>');
  const knowledgeData = {};
  const issues = analyzer.tryGetNotificationUrl('https://example.dk/a11y', body, doc, knowledgeData, LOCALE_DK);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'no-notification-function-link');
});

test('tryGetNotificationUrl (Norwegian): a diskrimineringsnemnda.no link satisfies the report-link check', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<body><a href="https://www.diskrimineringsnemnda.no/">Klag</a></body>');
  const knowledgeData = {};
  const issues = analyzer.tryGetNotificationUrl('https://example.no/a11y', body, doc, knowledgeData, LOCALE_NO);
  // The right link is reported as info (has-canonical-notification-function-link),
  // which does not affect the score; nothing may be an error or warning.
  assert.deepEqual(issues.filter(i => i.severity !== 'info'), []);
});

test('tryGetNotificationUrl (Finnish): the exact Traficom complaint URL satisfies the report-link check', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<body><a href="https://www.saavutettavuusvaatimukset.fi/fi/tee-saavutettavuuskantelu-tai-pyyda-selvitysta">Tee kantelu</a></body>');
  const knowledgeData = {};
  const issues = analyzer.tryGetNotificationUrl('https://example.fi/a11y', body, doc, knowledgeData, LOCALE_FI);
  // The right link is reported as info (has-canonical-notification-function-link),
  // which does not affect the score; nothing may be an error or warning.
  assert.deepEqual(issues.filter(i => i.severity !== 'info'), []);
});

test('getInterestingUrls (Norwegian): follows an off-domain link to uustatus.no', () => {
  const analyzer = new HarAnalyzer();
  const { body } = domFromHtml('<body><a href="https://uustatus.no/nb/erklaringer/publisert/abc123">Tilgjengelighetserklæring</a></body>');
  const urls = analyzer.getInterestingUrls('https://example.no', body, LOCALE_NO);
  assert.ok('https://uustatus.no/nb/erklaringer/publisert/abc123' in urls);
});

test('getInterestingUrls (Danish): follows a link to the central platform was.digst.dk', () => {
  const analyzer = new HarAnalyzer();
  const { body } = domFromHtml('<body><a href="https://was.digst.dk/example-dk">Tilgængelighedserklæring</a></body>');
  const urls = analyzer.getInterestingUrls('https://example.dk', body, LOCALE_DK);
  assert.ok('https://was.digst.dk/example-dk' in urls);
});

test('getInterestingUrls (Danish): does not follow links to other off-domain hosts', () => {
  const analyzer = new HarAnalyzer();
  const { body } = domFromHtml('<body><a href="https://other.dk/tilgaengelighedserklaering">Tilgængelighedserklæring</a></body>');
  const urls = analyzer.getInterestingUrls('https://example.dk', body, LOCALE_DK);
  assert.equal('https://other.dk/tilgaengelighedserklaering' in urls, false);
});
