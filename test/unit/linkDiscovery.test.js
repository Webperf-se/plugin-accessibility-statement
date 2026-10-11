import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { getCountries } from '../../lib/countries.js';

const se = getCountries().se;

const start = 'https://www.example.se';
const analyzer = new HarAnalyzer();

function body(html) {
  return new JSDOM(html).window.document.querySelector('body');
}

test('links to the same site without www are accepted and moved to the start host', () => {
  const urls = analyzer.getInterestingUrls(start, body(
    '<a href="https://example.se/om/tillganglighetsredogorelse">Tillgänglighetsredogörelse</a>'), se, start + '/');
  assert.deepEqual(Object.keys(urls), ['https://www.example.se/om/tillganglighetsredogorelse']);
  assert.equal(urls['https://www.example.se/om/tillganglighetsredogorelse'], 0.55);
});

test('relative links without a leading slash and protocol relative links are resolved', () => {
  const urls = analyzer.getInterestingUrls(start, body(
    '<a href="tillganglighet">Tillgänglighet</a><a href="//www.example.se/om-webbplatsen">Om webbplatsen</a>'),
    se, 'https://www.example.se/om/');
  assert.ok('https://www.example.se/om/tillganglighet' in urls);
  assert.ok('https://www.example.se/om-webbplatsen' in urls);
});

test('links to other sites, mail, phone and fragments are ignored', () => {
  const urls = analyzer.getInterestingUrls(start, body(
    '<a href="https://other.se/tillganglighet">Tillgänglighet</a>' +
    '<a href="mailto:a@example.se">Tillgänglighet</a><a href="#tillganglighet">Tillgänglighet</a>' +
    '<a href="https://evil.example/www.example.se">Tillgänglighet</a>'), se, start + '/');
  assert.deepEqual(urls, {});
});

test('a statement link that only exists as page data is found (skatteverket.se footer)', () => {
  const html = '<html><body><div id="footer"></div><script>window.__footer=' +
    '[{"name":"Om webbplatsen","url":"https://example.se/om/omwebbplatsen.4.1.html"},' +
    '{"name":"Tillgänglighetsredogörelse","url":"https://example.se/om/omwebbplatsen/tillganglighetsredogorelse.4.2.html"}]' +
    '</script></body></html>';
  const urls = analyzer.getInterestingUrlsFromPageData(start, html, start + '/');
  assert.equal(urls['https://www.example.se/om/omwebbplatsen/tillganglighetsredogorelse.4.2.html'], 0.5);
  assert.equal(Object.keys(urls).length, 1);
});

test('json escaped slashes, relative data paths and files are handled', () => {
  const html = '<script>{"u":"https:\\/\\/www.example.se\\/tillganglighet\\/","p":"/om/tillgänglighetsredogörelse",' +
    '"f":"/files/tillganglighetsredogorelse.pdf","o":"https://other.se/tillganglighetsredogorelse"}</script>';
  const urls = analyzer.getInterestingUrlsFromPageData(start, html, start + '/');
  assert.equal(urls['https://www.example.se/tillganglighet/'], 0.3);
  assert.equal(urls['https://www.example.se/om/tillg%C3%A4nglighetsredog%C3%B6relse'], 0.5);
  assert.equal(Object.keys(urls).length, 2);
});

test('an <a> link keeps its higher precision when the same URL is also in page data', () => {
  const merged = analyzer.mergeInterestingUrls(
    { 'https://www.example.se/a': 0.55 }, { 'https://www.example.se/a': 0.5, 'https://www.example.se/b': 0.3 });
  assert.deepEqual(merged, { 'https://www.example.se/a': 0.55, 'https://www.example.se/b': 0.3 });
});

test('paths of ordinary <a> links are not matched as page data', () => {
  const html = '<a href="/om/tillganglighetsredogorelse-journalen/">Så tillgänglig är Journalen</a>' +
    '<a href="/om/tillganglighetsutlatande/">Så tillgänglig är webbplatsen</a>';
  assert.deepEqual(analyzer.getInterestingUrlsFromPageData(start, html, start + '/'), {});
});

test('page data is only used when no link in the page is about accessibility', () => {
  const data = '<script>{"url":"https://www.example.se/x/tillganglighetsredogorelse-app/"}</script>';
  const withLink = analyzer.getInterestingUrlsWithFallback(start,
    body('<a href="/tillganglighet/">Tillgänglighet</a>' + data), data, start + '/', se);
  assert.deepEqual(Object.keys(withLink), ['https://www.example.se/tillganglighet/']);
  const withoutLink = analyzer.getInterestingUrlsWithFallback(start,
    body('<a href="/omoss/">Om oss</a>' + data), data, start + '/', se);
  assert.equal(withoutLink['https://www.example.se/x/tillganglighetsredogorelse-app/'], 0.5);
  assert.equal(withoutLink['https://www.example.se/omoss/'], 0.25);
});

test('the page data fallback only applies to Swedish rules', () => {
  const data = '<script>{"url":"https://www.example.de/x/tillganglighetsredogorelse/"}</script>';
  const urls = analyzer.getInterestingUrlsWithFallback('https://www.example.de',
    body('<a href="/impressum">Impressum</a>' + data), data, 'https://www.example.de/', getCountries().de);
  assert.deepEqual(urls, {});
});
