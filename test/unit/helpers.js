import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.resolve(here, '..', 'fixtures');
export const testDataDir = path.resolve(here, '..', 'data');

export function readFixture(...parts) {
    return readFileSync(path.resolve(fixturesDir, ...parts), 'utf8');
}

// Minimal HAR with a single HTML response, enough for HarAnalyzer.
export function makeHar(url, html) {
    return {
        log: {
            pages: [{ id: 'page_1' }],
            entries: [{
                pageref: 'page_1',
                request: { url },
                response: {
                    status: 200,
                    content: {
                        text: html,
                        mimeType: 'text/html; charset=utf-8',
                        size: Buffer.byteLength(html)
                    }
                }
            }]
        }
    };
}

// Simulates what lib/index.js does: analyse the start page, then follow the
// interesting URLs the analyzer hands out (pages maps URL -> HTML; unknown
// URLs get an empty-ish page), then run the summarize step.
export async function crawl(analyzer, group, startUrl, pages, fallbackHtml = '<html><body><p>404</p></body></html>') {
    const visited = [];
    analyzer.trySetStartUrl(startUrl, 'uuid', group);
    let url = startUrl;
    while (url) {
        visited.push(url);
        const html = pages[url] !== undefined ? pages[url] : fallbackHtml;
        await analyzer.analyzeData(url, makeHar(url, html), group);
        url = analyzer.getNextInterestingUrl(group);
    }
    analyzer.checkNoAccessibilityStatement(group);
    return {
        visited,
        knowledgeData: analyzer.groups[group].knowledgeData,
        hasStatement: !!analyzer.groups[group]['has-a11y-statement']
    };
}

export function issueSummary(knowledgeData) {
    const out = {};
    for (const [rule, issue] of Object.entries(knowledgeData.issues || {})) {
        out[rule] = {
            severity: issue.severity,
            subIssues: issue.subIssues.map(s => ({ rule: s.rule, severity: s.severity, text: s.text, url: s.url }))
        };
    }
    return out;
}
