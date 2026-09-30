import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../lib/harAnalyzer.js';

test('Danish site with no visible statement link still gets the centralized was.digst.dk URL queued, top priority', async () => {
  const analyzer = new HarAnalyzer();
  const group = 'test-dk';
  analyzer.groups[group] = { 'start-url': 'https://www.example-kommune.dk/' };

  const html = '<html><head><title>Forsiden</title></head><body><h1>Velkommen</h1><p>Ingen tilgængelighedslink her.</p></body></html>';
  const analyzedData = { url: 'https://www.example-kommune.dk/', htmls: [{ url: 'https://www.example-kommune.dk/', content: html, index: 1 }] };

  const knowledgeData = await analyzer.createKnowledgeFromData(analyzedData, 'https://www.example-kommune.dk/', group);

  assert.equal(knowledgeData['interesting-urls']['https://was.digst.dk/www-example-kommune-dk'], 1.0);
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
