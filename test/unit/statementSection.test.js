import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';

async function analyse(html, url = 'https://www.example.se/om/') {
  const analyzer = new HarAnalyzer();
  const group = 'g';
  analyzer.groups[group] = { 'start-url': url };
  const analyzed = { url, htmls: [{ url, content: html, index: 1 }] };
  const knowledge = await analyzer.createKnowledgeFromData(analyzed, url, group);
  return { knowledge, analyzer, group };
}

const sectionText = '<p>Webbplatsen är delvis förenlig med lagen om tillgänglighet till digital offentlig service.</p>' +
  '<p>Webbplatsen uppdaterades den 6 mars 2026.</p>';

test('a statement under an <h2> of a general page is accepted with a warning', async () => {
  const html = '<html lang="sv"><head><title>Om webbplatsen</title></head><body><h1>Om webbplatsen</h1>' +
    '<p>Så är webbplatsen uppbyggd.</p><h2>Tillgänglighetsredogörelse för Exempel</h2>' + sectionText +
    '<h2>Lämna en synpunkt</h2><p>Skriv till oss.</p></body></html>';
  const { knowledge, analyzer, group } = await analyse(html);
  assert.equal(knowledge['is-a11y-statement'], true);
  assert.equal(knowledge['statement-section-heading'], 'Tillgänglighetsredogörelse för Exempel');
  assert.equal(knowledge.issues['statement-is-page-section'].severity, 'warning');
  assert.match(knowledge.issues['statement-is-page-section'].subIssues[0].text, /Om webbplatsen/);
  assert.equal(knowledge.issues['compatible-word-partly'].severity, 'error');
  assert.equal(analyzer.groups[group]['has-a11y-statement'], true);
});

test('a page without any <h1> is handled, and is named by its title', async () => {
  const html = '<html lang="sv"><head><title>Om sajten</title></head><body><div><h2>Om sajten</h2></div>' +
    '<div><h3>Tillgänglighetsredogörelse</h3>' + sectionText + '</div></body></html>';
  const { knowledge } = await analyse(html);
  assert.equal(knowledge['is-a11y-statement'], true);
  assert.match(knowledge.issues['statement-is-page-section'].subIssues[0].text, /Om sajten/);
});

test('a page without <h1> and title is named by its URL path', async () => {
  const html = '<html lang="sv"><body><h2>Tillgänglighetsredogörelse</h2>' + sectionText + '</body></html>';
  const { knowledge } = await analyse(html);
  assert.match(knowledge.issues['statement-is-page-section'].subIssues[0].text, /\/om\//);
});

test('the date is read from the section only, not from the rest of the page', async () => {
  const html = '<html lang="sv"><head><title>Om</title></head><body><h1>Om</h1>' +
    '<p>Sidan uppdaterades den 1 januari 2015.</p>' +
    '<h2>Tillgänglighetsredogörelse</h2><p>Webbplatsen är helt förenlig med lagen.</p>' +
    '<p>Webbplatsen uppdaterades den 6 mars 2026.</p><h2>Annat</h2></body></html>';
  const { knowledge } = await analyse(html);
  const years = knowledge['dates'].map(d => d.date[0]);
  assert.deepEqual(years, [2026]);
});

test('a heading with the statement name but no legal language is not accepted', async () => {
  const html = '<html lang="sv"><head><title>Hjälp</title></head><body><h1>Hjälp</h1>' +
    '<h2>Tillgänglighetsredogörelse</h2><p>Här finns inget om lagen.</p></body></html>';
  const { knowledge } = await analyse(html);
  assert.equal(knowledge['is-a11y-statement'], undefined);
  assert.equal('statement-is-page-section' in knowledge.issues, false);
});

test('a dedicated statement page gets no section warning', async () => {
  const html = '<html lang="sv"><head><title>Tillgänglighetsredogörelse</title></head><body>' +
    '<h1>Tillgänglighetsredogörelse</h1>' + sectionText + '</body></html>';
  const { knowledge } = await analyse(html);
  assert.equal(knowledge['is-a11y-statement'], true);
  assert.equal(knowledge.issues['statement-is-page-section'].severity, 'resolved');
});
