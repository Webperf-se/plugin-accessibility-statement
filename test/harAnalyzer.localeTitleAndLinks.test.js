import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { HarAnalyzer } from '../lib/harAnalyzer.js';
import { LOCALE_SE, LOCALE_DK, LOCALE_NO, LOCALE_FI } from '../lib/locales.js';

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
  assert.deepEqual(issues, []);
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
  assert.deepEqual(issues, []);
});

test('tryGetNotificationUrl (Finnish): the exact Traficom complaint URL satisfies the report-link check', () => {
  const analyzer = new HarAnalyzer();
  const { doc, body } = domFromHtml('<body><a href="https://www.saavutettavuusvaatimukset.fi/fi/tee-saavutettavuuskantelu-tai-pyyda-selvitysta">Tee kantelu</a></body>');
  const knowledgeData = {};
  const issues = analyzer.tryGetNotificationUrl('https://example.fi/a11y', body, doc, knowledgeData, LOCALE_FI);
  assert.deepEqual(issues, []);
});

test('getInterestingUrls (Norwegian): follows an off-domain link to uustatus.no', () => {
  const analyzer = new HarAnalyzer();
  const { body } = domFromHtml('<body><a href="https://uustatus.no/nb/erklaringer/publisert/abc123">Tilgjengelighetserklæring</a></body>');
  const urls = analyzer.getInterestingUrls('https://example.no', body, LOCALE_NO);
  assert.ok('https://uustatus.no/nb/erklaringer/publisert/abc123' in urls);
});

test('getInterestingUrls (Danish): does not follow off-domain links by default (no trusted host configured)', () => {
  const analyzer = new HarAnalyzer();
  const { body } = domFromHtml('<body><a href="https://was.digst.dk/example-dk">Tilgængelighedserklæring</a></body>');
  const urls = analyzer.getInterestingUrls('https://example.dk', body, LOCALE_DK);
  assert.equal('https://was.digst.dk/example-dk' in urls, false);
});
