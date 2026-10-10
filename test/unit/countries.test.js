import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getCountries, selectCountry, monthPrefixes, getTld } from '../../lib/countries.js';
import { HarAnalyzer } from '../../lib/harAnalyzer.js';
import { crawl, makeHar } from './helpers.js';

const countries = getCountries();
const supported = ['se', 'dk', 'no', 'fi', 'de', 'fr', 'es', 'it'];

describe('country configs', () => {
    test('every config loads and compiles', () => {
        assert.deepEqual(Object.keys(countries).sort(), [...supported, 'is'].sort());
        for (const code of supported) {
            const c = countries[code];
            assert.equal(c.status, 'supported', code);
            assert.ok(c.strict instanceof RegExp, `${code} strict`);
            assert.ok(c.loose instanceof RegExp, `${code} loose`);
            assert.ok(c.tlds.length > 0 && c.languages.length > 0, `${code} tlds/languages`);
            for (const level of c.compliance) {
                assert.ok(level.regexes.length > 0, `${code} compliance.${level.level}`);
            }
            assert.ok(c.burden.length > 0, `${code} burden`);
            assert.ok(c.evaluation instanceof RegExp, `${code} evaluation`);
            assert.ok(c.dates.regexes.length > 0, `${code} dates`);
            assert.ok(c.enforcement.canonical.length > 0, `${code} enforcement.canonical`);
            assert.ok(Array.isArray(c.enforcement.old), `${code} enforcement.old`);
            assert.equal(typeof c.config.statement.externalOnly, 'boolean', `${code} externalOnly`);
            assert.ok(Array.isArray(c.config.statement.externalHosts), `${code} externalHosts`);
            assert.ok(Array.isArray(c.config.statement.linkText), `${code} linkText`);
        }
    });

    test('only Italy is externalOnly; Denmark and Norway use a central platform', () => {
        for (const code of supported) {
            assert.equal(countries[code].externalOnly, code === 'it', code);
        }
        assert.deepEqual(countries.dk.externalHosts, ['was.digst.dk']);
        assert.deepEqual(countries.no.externalHosts, ['uustatus.no']);
        assert.deepEqual(countries.it.externalHosts, ['form.agid.gov.it']);
    });

    test('Iceland is pending', () => {
        assert.equal(countries.is.status, 'pending');
        assert.equal(countries.is.supported, false);
    });

    test('Germany and Spain have no outdated enforcement link', () => {
        assert.equal(countries.de.enforcement.old.length, 0);
        assert.equal(countries.de.enforcement.oldText.length, 0);
        assert.equal(countries.es.enforcement.old.length, 0);
        assert.equal(countries.es.enforcement.oldText.length, 0);
    });

    test('month prefixes are unique', () => {
        assert.deepEqual(monthPrefixes(countries.fr.config.dates.months).slice(5, 7), ['juin', 'juil']);
        for (const code of supported) {
            const prefixes = countries[code].dates.prefixes;
            assert.equal(new Set(prefixes).size, prefixes.length, code);
        }
    });
});

describe('compliance phrases', () => {
    const analyzer = new HarAnalyzer();
    const cases = [
        ['dk', 'Webstedet overholder loven delvist (overholder de fleste krav).', 'partial'],
        ['dk', 'Webstedet overholder loven fuldt ud.', 'full'],
        ['dk', 'Webstedet overholder ikke loven.', 'none'],
        ['no', 'Nettstedet er delvis i samsvar med kravene til universell utforming av ikt.', 'partial'],
        ['no', 'Nettstedet er i samsvar med kravene til universell utforming av ikt.', 'full'],
        ['no', 'Nettstaden er i samsvar med krava til universell utforming av ikt.', 'full'],
        ['no', 'Nettstedet er ikke i samsvar med kravene.', 'none'],
        ['fi', 'Digipalvelu täyttää saavutettavuusvaatimukset osittain.', 'partial'],
        ['fi', 'Den digitala tjänsten uppfyller delvis tillgänglighetskraven.', 'partial'],
        ['fi', 'Digipalvelu ei täytä saavutettavuusvaatimuksia.', 'none'],
        ['de', 'Diese Website ist mit § 12a BGG teilweise vereinbar.', 'partial'],
        ['de', 'Diese Website ist vollständig vereinbar.', 'full'],
        ['de', 'Diese Website ist nicht vollständig vereinbar.', 'partial'],
        ['de', 'Diese Website ist nicht vereinbar.', 'none'],
        ['fr', 'Le site est partiellement conforme avec le RGAA.', 'partial'],
        ['fr', 'Accessibilité : totalement conforme', 'full'],
        ['fr', 'Accessibilité : non conforme', 'none'],
        ['es', 'Este sitio web es parcialmente conforme con el RD 1112/2018.', 'partial'],
        ['es', 'Este sitio web es plenamente conforme con el RD 1112/2018.', 'full'],
        ['es', 'Este sitio web aún no es conforme con el RD 1112/2018.', 'none'],
        ['it', 'Questo sito web è parzialmente conforme ai requisiti.', 'partial'],
        ['it', 'Questo sito web è pienamente conforme ai requisiti.', 'full'],
        ['it', 'Questo sito web non è conforme ai requisiti.', 'none'],
        ['se', 'Webbplatsen är delvis förenlig med lagen.', 'partial'],
        ['se', 'Webbplatsen är inte helt förenlig med lagen.', 'partial'],
        ['se', 'Webbplatsen är helt förenlig med lagen.', 'full'],
        ['se', 'Webbplatsen är inte förenlig med lagen.', 'none']
    ];
    for (const [code, text, level] of cases) {
        test(`${code}: "${text}" is ${level}`, () => {
            const result = analyzer.findCompliance(text, countries[code]);
            assert.ok(result, 'no compliance phrase found');
            assert.equal(result.level, level);
        });
    }
});

describe('dates', () => {
    const analyzer = new HarAnalyzer();
    // Same choice as tryGetUpdatedDate(): the date whose trigger has the
    // lowest weight. When a "month yyyy" reading of the same text has the
    // same weight it wins and the day becomes 1 (legacy Swedish behaviour,
    // kept on purpose), so only year and month are compared for the pick and
    // the full date must be among the candidates.
    function checkDate(text, code, expected) {
        const dates = analyzer.findDates(text, countries[code]);
        assert.ok(dates.length > 0, `no date found in "${text}"`);
        assert.ok(dates.some(d => d.date.join('-') === expected.join('-')),
            `${expected.join('-')} not among ${dates.map(d => d.date.join('-')).join(', ')}`);
        dates.sort((a, b) => b.weight - a.weight);
        assert.deepEqual(dates.pop().date.slice(0, 2), expected.slice(0, 2));
    }
    const cases = [
        ['dk', 'Erklæringen blev senest revideret den 25. juni 2026.', [2026, 6, 25]],
        ['dk', 'Denne erklæring blev første gang offentliggjort den 21. september 2020. Erklæringen blev senest revideret den 25. juni 2026.', [2026, 6, 25]],
        ['no', 'Tilgjengelighetserklæringen er sist oppdatert 27. august 2026.', [2026, 8, 27]],
        ['no', 'Erklæringen er sist oppdatert 08. juli 2026.', [2026, 7, 8]],
        ['fi', 'Selostetta on päivitetty viimeksi 15.12.2025.', [2025, 12, 15]],
        ['fi', 'Tämä seloste on laadittu 1.11.2023. Selostetta on päivitetty viimeksi 15.12.2025.', [2025, 12, 15]],
        ['de', 'Die Erklärung wurde am 24.08.2021 erstellt und zuletzt am 24.06.2026 überprüft.', [2026, 6, 24]],
        ['de', 'Diese Erklärung wurde am 25. Oktober 2024 erstellt und zuletzt am 25. März 2025 überprüft.', [2025, 3, 25]],
        ['fr', 'Cette déclaration a été établie le 27/05/2024. Elle a été mise à jour le 3 juin 2024.', [2024, 6, 3]],
        ['fr', 'Elle a été mise à jour le 1er juillet 2024.', [2024, 7, 1]],
        ['es', 'Última revisión de la declaración: 19 de mayo de 2026.', [2026, 5, 19]],
        ['it', 'La dichiarazione è stata riesaminata da ultimo il 24/11/2023.', [2023, 11, 24]],
        ['se', 'Redogörelsen uppdaterades 3 mars 2019.', [2019, 3, 3]]
    ];
    for (const [code, text, expected] of cases) {
        test(`${code}: "${text}"`, () => {
            checkDate(text, code, expected);
        });
    }
});

describe('country selection', () => {
    test('option beats TLD and lang', () => {
        const s = selectCountry({ option: 'FI', url: 'https://www.example.se/', lang: 'sv' });
        assert.equal(s.code, 'fi');
        assert.equal(s.source, 'option');
    });

    test('TLD beats lang: Swedish page on .fi follows Finnish rules', () => {
        const s = selectCountry({ url: 'https://www.vasa.fi/', lang: 'sv-FI' });
        assert.equal(s.code, 'fi');
        assert.equal(s.source, 'tld');
    });

    test('lang is used when the TLD is not a country of ours', () => {
        assert.equal(selectCountry({ url: 'https://www.example.com/', lang: 'de-DE' }).code, 'de');
        assert.equal(selectCountry({ url: 'https://www.example.org/', lang: 'nb' }).code, 'no');
        assert.equal(selectCountry({ url: 'https://www.example.eu/', lang: 'ca' }).code, 'es');
    });

    test('each supported TLD selects its country', () => {
        for (const code of supported) {
            const tld = code === 'se' ? 'se' : countries[code].tlds[0];
            assert.equal(selectCountry({ url: `https://www.example.${tld}/` }).code, code);
        }
    });

    test('unknown country gives no rules', () => {
        const s = selectCountry({ url: 'https://www.example.pl/', lang: 'pl' });
        assert.equal(s.country, undefined);
        assert.equal(s.tld, 'pl');
        assert.equal(s.lang, 'pl');
    });

    test('IP addresses have no TLD', () => {
        assert.equal(getTld('http://127.0.0.1:3000/'), undefined);
        assert.equal(getTld('http://localhost:3000/'), undefined);
    });
});

describe('analyzer per country', () => {
    test('a .pl site with lang pl gets no-country-rules (info) and no no-a11y-statement', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.example.pl/';
        const html = '<html lang="pl"><head><title>Strona</title></head><body><a href="/deklaracja-dostepnosci">Deklaracja dostępności</a></body></html>';
        const r = await crawl(analyzer, 'pl', url, { [url]: html });
        assert.deepEqual(r.visited, [url], 'nothing else is crawled');
        const issues = r.knowledgeData[0].issues;
        assert.equal(issues['no-country-rules'].severity, 'info');
        assert.match(issues['no-country-rules'].subIssues[0].text, /'\.pl'/);
        assert.match(issues['no-country-rules'].subIssues[0].text, /lang 'pl'/);
        assert.equal(issues['no-a11y-statement'].severity, 'resolved');
        for (const [rule, issue] of Object.entries(issues)) {
            if (rule !== 'no-country-rules') {
                assert.equal(issue.severity, 'resolved', rule);
            }
        }
        assert.equal(analyzer.checkNoAccessibilityStatement('pl'), false);
    });

    test('Iceland (pending) gets no-country-rules naming the pending status', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.example.is/';
        const r = await crawl(analyzer, 'is', url, { [url]: '<html lang="is"><body><p>Halló</p></body></html>' });
        const issues = r.knowledgeData[0].issues;
        assert.equal(issues['no-country-rules'].severity, 'info');
        assert.match(issues['no-country-rules'].subIssues[0].text, /Iceland are pending/);
        assert.equal(issues['no-a11y-statement'].severity, 'resolved');
    });

    test('Swedish site without statement still gets no-a11y-statement', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.example.se/';
        const r = await crawl(analyzer, 'se', url, { [url]: '<html lang="sv"><body><p>Hej</p></body></html>' });
        assert.equal(r.knowledgeData[0].issues['no-a11y-statement'].severity, 'critical');
        assert.equal(r.knowledgeData[0].issues['no-country-rules'].severity, 'resolved');
    });

    test('no-network start page on an unknown TLD gives no-country-rules at summarize', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.example.pl/';
        analyzer.trySetStartUrl(url, 'uuid', 'g');
        await analyzer.analyzeData(url, { log: { entries: [] } }, 'g');
        assert.equal(analyzer.checkNoAccessibilityStatement('g'), true);
        const issues = analyzer.groups.g.knowledgeData[0].issues;
        assert.equal(issues['no-network'].severity, 'warning');
        assert.equal(issues['no-country-rules'].severity, 'info');
        assert.equal(issues['no-a11y-statement'].severity, 'resolved');
    });

    test('option forces the country', async () => {
        const analyzer = new HarAnalyzer({ country: 'se' });
        const url = 'http://127.0.0.1:3000/';
        const html = '<html lang="en"><head><title>Tillgänglighetsredogörelse</title></head><body><h1>Tillgänglighetsredogörelse</h1><p>Webbplatsen är delvis förenlig med lagen.</p></body></html>';
        const r = await crawl(analyzer, 'opt', url, { [url]: html });
        assert.equal(r.hasStatement, true);
        assert.equal(r.knowledgeData[0].country, 'se');
        assert.equal(r.knowledgeData[0].issues['compatible-word-partly'].severity, 'error');
    });

    test('Denmark: link to was.digst.dk is followed and rated', async () => {
        const analyzer = new HarAnalyzer();
        const start = 'https://www.kk.dk/';
        const was = 'https://www.was.digst.dk/kk-dk';
        const startHtml = `<html lang="da"><body>
            <a href="/om-hjemmesiden">Om hjemmesiden</a>
            <a href="${was}">Tilgængelighedserklæring</a></body></html>`;
        const wasHtml = `<html lang="da"><head><title>Tilgængelighedserklæring for www.kk.dk</title></head><body>
            <h1>Tilgængelighedserklæring for www.kk.dk</h1>
            <p>Webstedet overholder loven delvist (overholder de fleste krav).</p>
            <p>Erklæringen blev senest revideret den 25. juni 2026.</p>
            <p>Vurderet af en tredjepart.</p>
            <p>Du kan klage til Digitaliseringsstyrelsen på webtilsyn@digst.dk.</p></body></html>`;
        const r = await crawl(analyzer, 'dk', start, { [start]: startHtml, [was]: wasHtml });
        assert.deepEqual(r.visited, [start, was], 'the platform link is visited first');
        assert.equal(r.hasStatement, true);
        const issues = r.knowledgeData[1].issues;
        assert.equal(issues['compatible-word-partly'].severity, 'error');
        assert.equal(issues['has-canonical-notification-function-link'].severity, 'info');
        assert.equal(issues['no-notification-function-link'].severity, 'resolved');
        assert.equal(issues['no-updated-date'].severity, 'resolved');
        assert.equal(issues['no-evaluation-method'].severity, 'resolved');
    });

    test('platform page reached through a redirect between host variants is kept', () => {
        const analyzer = new HarAnalyzer();
        analyzer.trySetStartUrl('https://www.kk.dk/', 'uuid', 'dk');
        analyzer.resolveCountry('dk', 'https://www.kk.dk/', 'da');
        const har = makeHar('https://www.was.digst.dk/kk-dk', '<html><body></body></html>');
        assert.equal(analyzer.getFirstPageEntries('https://was.digst.dk/kk-dk', har, 'dk').length, 1);
        const other = makeHar('https://www.example.org/', '<html><body></body></html>');
        assert.equal(analyzer.getFirstPageEntries('https://was.digst.dk/kk-dk', other, 'dk').length, 0);
    });

    test('Norway: own-site signpost page leads on to uustatus.no', async () => {
        const analyzer = new HarAnalyzer();
        const start = 'https://www.fhi.no/';
        const signpost = 'https://www.fhi.no/om/tilgjengelighetserklaring';
        const uu = 'https://uustatus.no/nb/erklaringer/publisert/23417634-74dc-495b-a2c8-c0e79a2276dc';
        const r = await crawl(analyzer, 'no', start, {
            [start]: `<html lang="nb"><body><a href="/om/tilgjengelighetserklaring">Tilgjengelighetserklæring</a></body></html>`,
            [signpost]: `<html lang="nb"><head><title>Tilgjengelighetserklæring</title></head><body><h1>Tilgjengelighetserklæring</h1><a href="${uu}">Les erklæringen på uustatus.no</a></body></html>`,
            [uu]: `<html lang="nb"><head><title>Tilgjengelighetserklæring</title></head><body><h1>Tilgjengelighetserklæring for fhi.no</h1>
                <p>Nettstedet er delvis i samsvar med kravene til universell utforming av ikt.</p>
                <p>Tilgjengelighetserklæringen er sist oppdatert 27. august 2026.</p>
                <p><a href="https://diskrimineringsnemnda.no/for-klager">Diskrimineringsnemnda</a> behandler klager.</p></body></html>`
        });
        assert.deepEqual(r.visited, [start, signpost, uu]);
        assert.equal(r.hasStatement, true);
        assert.equal(r.knowledgeData[1]['is-a11y-statement'], undefined);
        assert.equal(r.knowledgeData[2]['is-a11y-statement'], true);
        assert.equal(r.knowledgeData[2].issues['has-canonical-notification-function-link'].severity, 'info');
    });

    test('Italy: a start-page link to form.agid.gov.it is the statement', async () => {
        const analyzer = new HarAnalyzer();
        const start = 'https://www.comune.milano.it/';
        const r = await crawl(analyzer, 'it', start, {
            [start]: `<html lang="it"><body><footer><a href="https://form.agid.gov.it/view/f9968430-93da-11f0-a5fe-97efea99bc7d">Dichiarazione di accessibilità</a></footer></body></html>`
        });
        assert.deepEqual(r.visited, [start], 'the AgID page is not fetched');
        assert.equal(r.hasStatement, true);
        const kd = r.knowledgeData[0];
        assert.equal(kd['external-a11y-statement-url'], 'https://form.agid.gov.it/view/f9968430-93da-11f0-a5fe-97efea99bc7d');
        for (const [rule, issue] of Object.entries(kd.issues)) {
            assert.equal(issue.severity, 'resolved', rule);
        }
    });

    test('Germany: Land enforcement body is canonical, old link never fires', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.uni-hannover.de/barrierefreiheit';
        const r = await crawl(analyzer, 'de', url, {
            [url]: `<html lang="de"><head><title>Erklärung zur Barrierefreiheit</title></head><body>
                <h1>Erklärung zur Barrierefreiheit</h1>
                <p>Diese Website ist mit den Anforderungen teilweise vereinbar.</p>
                <p>Die Erklärung wurde am 24.08.2021 erstellt und zuletzt am 24.06.2026 überprüft.</p>
                <p>Die Erklärung beruht auf einer Selbstbewertung.</p>
                <p>Schlichtungsverfahren: <a href="mailto:schlichtungsstelle@ms.niedersachsen.de">Schlichtungsstelle</a></p></body></html>`
        });
        const issues = r.knowledgeData[0].issues;
        assert.equal(issues['compatible-word-partly'].severity, 'error');
        assert.equal(issues['has-canonical-notification-function-link'].severity, 'info');
        assert.equal(issues['has-old-notification-function-link'].severity, 'resolved');
        assert.equal(r.knowledgeData[0]['evaluation-method-word'], 'beruht auf');
    });

    test('Spain: any sede electrónica counts as the complaint procedure', async () => {
        const analyzer = new HarAnalyzer();
        const url = 'https://www.uned.es/accesibilidad';
        const r = await crawl(analyzer, 'es', url, {
            [url]: `<html lang="es"><head><title>Declaración de accesibilidad</title></head><body>
                <h1>Declaración de accesibilidad</h1>
                <p>Este sitio web es parcialmente conforme con el RD 1112/2018.</p>
                <p>Carga desproporcionada: No aplica.</p>
                <p>Última revisión de la declaración: 19 de mayo de 2026.</p>
                <p><a href="https://uned.sede.gob.es/procedimiento/portada?idProc=100552">Reclamación</a></p></body></html>`
        });
        const issues = r.knowledgeData[0].issues;
        assert.equal(issues['has-canonical-notification-function-link'].severity, 'info');
        assert.equal(issues['has-unreasonably-burdensome-accommodation'].severity, 'resolved');
        assert.equal(issues['has-old-notification-function-link'].severity, 'resolved');
    });
});

describe('swedish sites outside .se', () => {
    test('.nu and .stockholm select Swedish rules even without lang', () => {
        assert.equal(selectCountry({ url: 'https://www.studera.nu/' }).code, 'se');
        assert.equal(selectCountry({ url: 'https://start.stockholm/', lang: 'en' }).code, 'se');
    });

    test('the country option wins over an English page on .com', () => {
        const s = selectCountry({ option: 'se', url: 'https://www.visitstockholm.com/', lang: 'en' });
        assert.equal(s.code, 'se');
        assert.equal(s.source, 'option');
    });
});
