import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { crawl } from './helpers.js';

test('Danish site with no visible statement link still gets the centralized was.digst.dk URL queued, top priority', async () => {
  const analyzer = new HarAnalyzer();
  const group = 'test-dk';
  analyzer.groups[group] = { 'start-url': 'https://www.example-kommune.dk/' };

  const html = '<html><head><title>Forsiden</title></head><body><h1>Velkommen</h1><p>Ingen tilgængelighedslink her.</p></body></html>';
  const analyzedData = { url: 'https://www.example-kommune.dk/', htmls: [{ url: 'https://www.example-kommune.dk/', content: html, index: 1 }] };

  const knowledgeData = await analyzer.createKnowledgeFromData(analyzedData, 'https://www.example-kommune.dk/', group);

  // The slug leaves out "www." (was.digst.dk/kk-dk for www.kk.dk);
  // was.digst.dk/www-kk-dk is a "404" page.
  assert.equal(knowledgeData['interesting-urls']['https://was.digst.dk/example-kommune-dk'], 1.0);
  assert.equal('https://was.digst.dk/www-example-kommune-dk' in knowledgeData['interesting-urls'], false);
});

test('the centralized URL is not added when the site already links to was.digst.dk', async () => {
  const analyzer = new HarAnalyzer();
  const group = 'test-dk-link';
  analyzer.groups[group] = { 'start-url': 'https://www.kk.dk/' };

  const html = '<html><body><a href="https://www.was.digst.dk/kk-dk">Tilgængelighedserklæring</a></body></html>';
  const analyzedData = { url: 'https://www.kk.dk/', htmls: [{ url: 'https://www.kk.dk/', content: html, index: 1 }] };

  const knowledgeData = await analyzer.createKnowledgeFromData(analyzedData, 'https://www.kk.dk/', group);

  assert.deepEqual(Object.keys(knowledgeData['interesting-urls']), ['https://www.was.digst.dk/kk-dk']);
});

test('does not re-inject the central URL once already on was.digst.dk (avoids an infinite loop)', async () => {
  const analyzer = new HarAnalyzer();
  const group = 'test-dk-was';
  analyzer.groups[group] = { 'start-url': 'https://was.digst.dk/example-kommune-dk' };

  const html = '<html><head><title>Tilgængelighedserklæring</title></head><body><h1>Tilgængelighedserklæring</h1><p>Webstedet opfylder standarden fuldt ud.</p></body></html>';
  const analyzedData = { url: 'https://was.digst.dk/example-kommune-dk', htmls: [{ url: 'https://was.digst.dk/example-kommune-dk', content: html, index: 1 }] };

  const knowledgeData = await analyzer.createKnowledgeFromData(analyzedData, 'https://was.digst.dk/example-kommune-dk', group);

  assert.equal('https://was.digst.dk/was-digst-dk' in knowledgeData['interesting-urls'], false);
});

test('the was.digst.dk "404" page is not taken for a statement', async () => {
  // was.digst.dk answers 200 for an unknown slug, and the page title holds
  // the statement word itself. Title and heading as served live.
  const analyzer = new HarAnalyzer();
  const start = 'https://www.example-kommune.dk/';
  const was = 'https://was.digst.dk/example-kommune-dk';
  const startHtml = '<html lang="da"><head><title>Forsiden</title></head><body><h1>Velkommen</h1></body></html>';
  const notFoundHtml = '<html lang="da"><head><title>404: Ingen tilgængelighedserklæring kunne findes</title></head>'
    + '<body><h1 class="mt-4 mt-sm-7">Ingen tilgængelighedserklæring kunne findes</h1></body></html>';

  const r = await crawl(analyzer, 'dk-404', start, { [start]: startHtml, [was]: notFoundHtml });

  assert.deepEqual(r.visited, [start, was]);
  assert.equal(r.hasStatement, false);
});
