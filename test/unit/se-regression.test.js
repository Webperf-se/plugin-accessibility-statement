// Swedish behaviour must not change when rules move to lib/countries/se.json.
// The snapshot was recorded with the hard-coded Swedish analyzer (before
// country support) and re-recorded on purpose when merging #133: only DIGG's
// three compliance phrases count ("ej helt förenlig" is now a near miss,
// still an error), and the date with the highest trigger weight is rated.
// Re-record with UPDATE_SNAPSHOT=1 only on purpose.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { readFixture, crawl, testDataDir, fixturesDir } from './helpers.js';

const snapshotPath = path.resolve(fixturesDir, 'se-baseline.json');
const NOW = new Date('2026-10-10T12:00:00Z');

function scenarios() {
    const base = 'https://www.example.se';
    const notStatement = readFixture('se', 'not-statement.html');
    return {
        'crawl-finds-statement': {
            start: `${base}/`,
            pages: {
                [`${base}/`]: readFixture('se', 'start.html'),
                [`${base}/tillganglighetsredogorelse`]: readFixture('se', 'full.html'),
                [`${base}/om-webbplatsen`]: notStatement
            }
        },
        'crawl-no-statement': {
            start: `${base}/`,
            pages: { [`${base}/`]: readFixture('se', 'start.html') },
            fallback: notStatement
        },
        'single-full': { start: `${base}/full`, pages: { [`${base}/full`]: readFixture('se', 'full.html') } },
        'single-old-link': { start: `${base}/old`, pages: { [`${base}/old`]: readFixture('se', 'old-link.html') } },
        'single-partial-short-link': { start: `${base}/partial`, pages: { [`${base}/partial`]: readFixture('se', 'partial-short-link.html') } },
        'single-weak': { start: `${base}/weak`, pages: { [`${base}/weak`]: readFixture('se', 'weak.html') } },
        'single-test-data': {
            start: `${base}/a11y-statement.html`,
            pages: { [`${base}/a11y-statement.html`]: readFileSync(path.resolve(testDataDir, 'a11y-statement.html'), 'utf8') }
        }
    };
}

async function run() {
    const result = {};
    for (const [name, s] of Object.entries(scenarios())) {
        const analyzer = new HarAnalyzer();
        const r = await crawl(analyzer, name, s.start, s.pages, s.fallback);
        result[name] = JSON.parse(JSON.stringify(r));
    }
    return result;
}

// Keys added to knowledgeData after the snapshot are allowed; every key the
// old analyzer produced must still be there with the same value.
function assertSubset(expected, actual, where) {
    if (expected === null || typeof expected !== 'object') {
        assert.deepEqual(actual, expected, where);
        return;
    }
    if (Array.isArray(expected)) {
        assert.ok(Array.isArray(actual), `${where} should be an array`);
        assert.equal(actual.length, expected.length, `${where} length`);
        expected.forEach((v, i) => assertSubset(v, actual[i], `${where}[${i}]`));
        return;
    }
    assert.ok(actual && typeof actual === 'object', `${where} should be an object`);
    for (const key of Object.keys(expected)) {
        assertSubset(expected[key], actual[key], `${where}.${key}`);
    }
}

test('Swedish results are identical to the pre-refactoring snapshot', async () => {
    mock.timers.enable({ apis: ['Date'], now: NOW });
    try {
        const result = await run();
        if (process.env.UPDATE_SNAPSHOT || !existsSync(snapshotPath)) {
            writeFileSync(snapshotPath, JSON.stringify(result, null, 2) + '\n');
            return;
        }
        const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        for (const name of Object.keys(expected)) {
            // The set of issues must match exactly, not only as a subset.
            for (let i = 0; i < expected[name].knowledgeData.length; i++) {
                const issues = result[name].knowledgeData[i].issues;
                assert.deepEqual(
                    Object.keys(issues).sort(),
                    Object.keys(expected[name].knowledgeData[i].issues).sort(),
                    `${name} knowledgeData[${i}] issue rules`);
            }
            assertSubset(expected[name], result[name], name);
        }
    } finally {
        mock.timers.reset();
    }
});
