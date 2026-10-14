import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Per-country rules for the accessibility statement required by the EU Web
// Accessibility Directive (2016/2102). Each lib/countries/<cc>.json holds the
// wording and enforcement bodies of one country; this module loads them once
// and compiles every pattern to a case-insensitive Unicode RegExp.

const countriesFolder = fileURLToPath(new URL('./countries/', import.meta.url));
const FLAGS = 'iu';

// Date fragments with named groups day/month/year. MONTH is replaced by the
// country's month alternation. The Swedish ones ('d month yyyy',
// 'month yyyy', 'yyyy-mm-dd', '[d ]month yyyy') are copied verbatim from the
// regexes that were hard-coded before country support.
const DATE_FORMATS = {
    'd month yyyy': '(?<day>[0-9]{1,2} )(?<month>(?:MONTH) )(?<year>20[0-9]{2})',
    'd. month yyyy': '(?<day>[0-9]{1,2}\\. ?)(?<month>(?:MONTH) )(?<year>20[0-9]{2})',
    'd[er] month yyyy': '(?<day>[0-9]{1,2}(?:er)? )(?<month>(?:MONTH) )(?<year>20[0-9]{2})',
    'month yyyy': '(?<day>)(?<month>(?:MONTH) )(?<year>20[0-9]{2})',
    '[d ]month yyyy': '(?<day>[0-9]{1,2} )*(?<month>(?:MONTH) )(?<year>20[0-9]{2})',
    'd de month de yyyy': '(?<day>[0-9]{1,2}) de (?<month>(?:MONTH)) de (?<year>20[0-9]{2})',
    'yyyy-mm-dd': '(?<year>20[0-9]{2}-)(?<month>[0-9]{2}-)(?<day>[0-9]{2})',
    'dd.mm.yyyy': '(?<day>[0-9]{1,2})\\.(?<month>[0-9]{1,2})\\.(?<year>20[0-9]{2})',
    'd.m.yyyy': '(?<day>[0-9]{1,2})\\.(?<month>[0-9]{1,2})\\.(?<year>20[0-9]{2})',
    'dd/mm/yyyy': '(?<day>[0-9]{1,2})/(?<month>[0-9]{1,2})/(?<year>20[0-9]{2})'
};

function compileList(patterns, code, field) {
    return (patterns || []).map(pattern => {
        try {
            return new RegExp(pattern, FLAGS);
        } catch (error) {
            throw new Error(`lib/countries/${code}.json ${field}: invalid pattern "${pattern}": ${error.message}`, { cause: error });
        }
    });
}

function alternation(patterns) {
    return (patterns || []).map(p => `(?:${p})`).join('|');
}

// Shortest prefix (at least 3 letters) that tells a month apart from the
// others: 'jan', 'mar', but 'juin'/'juil' in French.
export function monthPrefixes(months) {
    const lower = months.map(m => m.toLowerCase());
    return lower.map((month, i) => {
        let common = 0;
        lower.forEach((other, j) => {
            if (i === j) {
                return;
            }
            let k = 0;
            while (k < month.length && k < other.length && month[k] === other[k]) {
                k++;
            }
            common = Math.max(common, k);
        });
        return month.slice(0, Math.min(month.length, Math.max(3, common + 1)));
    });
}

function monthAlternation(months, prefixes) {
    // Same shape as the old Swedish regex: 'jan(?:uari)*', 'maj'.
    return months.map((month, i) => {
        const lower = month.toLowerCase();
        const rest = lower.slice(prefixes[i].length);
        return rest ? `${prefixes[i]}(?:${rest})*` : prefixes[i];
    }).join('|');
}

function compileDates(dates, code) {
    const months = dates.months || [];
    const prefixes = monthPrefixes(months);
    const monthAlt = monthAlternation(months, prefixes);
    const triggers = (dates.triggers || []).map(t => ({
        regex: new RegExp(t.pattern, FLAGS),
        weight: t.weight
    }));
    const triggerAlt = (dates.triggers || []).map(t => t.pattern).join('|');

    const regexes = [];
    if (triggerAlt) {
        for (const format of dates.formats || []) {
            let fragment = DATE_FORMATS[format];
            if (fragment === undefined) {
                throw new Error(`lib/countries/${code}.json dates.formats: unknown format "${format}"`);
            }
            if (fragment.includes('MONTH')) {
                if (!monthAlt) {
                    continue;
                }
                fragment = fragment.replace('MONTH', monthAlt);
            }
            // Trigger word before the date, then the date before the trigger.
            regexes.push(new RegExp(`(?<typ>${triggerAlt})(?<text>[^>.]*) ${fragment}`, 'g' + FLAGS));
            regexes.push(new RegExp(` ${fragment}(?<text>[^>.]*)(?<typ>${triggerAlt})`, 'g' + FLAGS));
        }
    }
    return { prefixes, triggers, regexes };
}

export function compileCountry(config) {
    const code = config.code;
    const statement = config.statement || {};
    const strict = alternation(statement.strict);
    const loose = alternation(statement.loose);

    // Link text precision, highest first. Same order and values as the old
    // Swedish getInterestingTextPrecision().
    const linkPrecision = [];
    if (strict) {
        linkPrecision.push({ regex: new RegExp(`^[ \\t\\r\\n]*(?:${strict})$`, FLAGS), precision: 0.55 });
        linkPrecision.push({ regex: new RegExp(`^[ \\t\\r\\n]*(?:${strict})`, FLAGS), precision: 0.5 });
    }
    if (loose) {
        linkPrecision.push({ regex: new RegExp(`^[ \\t\\r\\n]*(?:${loose})$`, FLAGS), precision: 0.4 });
        linkPrecision.push({ regex: new RegExp(`^[ \\t\\r\\n]*(?:${loose})`, FLAGS), precision: 0.35 });
    }
    if (strict) {
        linkPrecision.push({ regex: new RegExp(strict, FLAGS), precision: 0.3 });
    }
    if (loose) {
        linkPrecision.push({ regex: new RegExp(loose, FLAGS), precision: 0.3 });
    }
    for (const item of statement.linkText || []) {
        linkPrecision.push({ regex: new RegExp(item.pattern, FLAGS), precision: item.precision });
    }

    const compliance = config.compliance || {};
    const enforcement = config.enforcement || {};
    const evaluation = alternation(config.evaluation);

    return {
        code,
        name: config.name,
        status: config.status,
        supported: config.status === 'supported',
        languages: (config.languages || []).map(l => l.toLowerCase()),
        tlds: (config.tlds || []).map(t => t.toLowerCase()),
        config,
        strict: strict ? new RegExp(strict, FLAGS) : null,
        loose: loose ? new RegExp(loose, FLAGS) : null,
        linkPrecision,
        externalHosts: (statement.externalHosts || []).map(h => h.toLowerCase()),
        externalOnly: statement.externalOnly === true,
        // Statement URL on a central platform that can be derived from the
        // hostname ({host} = hostname without "www." and with dots as dashes),
        // or undefined.
        centralStatementUrl: statement.centralUrl
            ? hostname => statement.centralUrl.replace('{host}',
                hostname.toLowerCase().replace(/^www\./, '').replace(/\./g, '-'))
            : undefined,
        // <title> of a central platform page saying there is no statement
        // (was.digst.dk answers 200 with "404: Ingen tilgængelighedserklæring
        // kunne findes", which holds the statement word itself).
        notFoundTitle: compileList(statement.notFoundTitle, code, 'statement.notFoundTitle'),
        // Checked in this order: a partial or none phrase anywhere wins, and a
        // full phrase only counts when no negation word sits earlier in its
        // clause (see findCompliance() in harAnalyzer.js).
        compliance: [
            { level: 'partial', regexes: compileList(compliance.partial, code, 'compliance.partial') },
            { level: 'none', regexes: compileList(compliance.none, code, 'compliance.none') },
            { level: 'full', regexes: compileList(compliance.full, code, 'compliance.full') }
        ],
        complianceNegation: compliance.negation && compliance.negation.length > 0
            ? new RegExp(alternation(compliance.negation), FLAGS)
            : null,
        burden: compileList(config.burden, code, 'burden'),
        burdenReference: config.burdenReference || '',
        // One alternation so the leftmost evaluation word wins, as before.
        evaluation: evaluation ? new RegExp(evaluation, FLAGS) : null,
        dates: compileDates(config.dates || {}, code),
        enforcement: {
            label: enforcement.label || 'the enforcement body',
            accepted: compileList(enforcement.accepted, code, 'enforcement.accepted'),
            canonical: compileList(enforcement.canonical, code, 'enforcement.canonical'),
            old: compileList(enforcement.old, code, 'enforcement.old'),
            text: compileList(enforcement.text, code, 'enforcement.text'),
            oldText: compileList(enforcement.oldText, code, 'enforcement.oldText')
        },
        letters: config.letters
            ? { upper: config.letters.upper, lower: config.letters.lower, flags: '' }
            : { upper: '\\p{Lu}', lower: '\\p{Ll}', flags: 'u' }
    };
}

export function loadCountries(folder = countriesFolder) {
    const countries = {};
    for (const file of readdirSync(folder).filter(f => f.endsWith('.json')).sort()) {
        const config = JSON.parse(readFileSync(path.resolve(folder, file), 'utf8'));
        countries[config.code] = compileCountry(config);
    }
    return countries;
}

let cache;
export function getCountries() {
    if (!cache) {
        cache = loadCountries();
    }
    return cache;
}

export function getTld(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
        // IP addresses and single-label hosts have no TLD.
        if (/^[0-9.]+$/.test(hostname) || hostname.includes(':') || !hostname.includes('.')) {
            return undefined;
        }
        return hostname.split('.').pop();
    } catch {
        return undefined;
    }
}

export function getPrimaryLanguage(lang) {
    if (!lang || typeof lang !== 'string') {
        return undefined;
    }
    const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
    return primary || undefined;
}

// Picks the rules for a tested site. Order:
//  1. the --allystatement.country option,
//  2. the TLD of the tested URL,
//  3. the primary subtag of <html lang>.
// The TLD beats lang because the rules follow the country whose law applies,
// not the language of the page: a Finnish municipality publishing in Swedish
// on a .fi domain must follow Finnish rules ("tillgänglighetsutlåtande",
// Traficom), not the Swedish DOS-lagen.
// Returns { country, code, source, tld, lang }; country is undefined when no
// rules exist for the detected code.
export function selectCountry({ option, url, lang }, countries = getCountries()) {
    const tld = getTld(url);
    const primaryLang = getPrimaryLanguage(lang);
    const result = { country: undefined, code: undefined, source: undefined, tld, lang: primaryLang };

    if (option) {
        const code = String(option).trim().toLowerCase();
        result.code = code;
        result.source = 'option';
        result.country = countries[code];
        return result;
    }
    if (tld) {
        const byTld = Object.values(countries).find(c => c.tlds.includes(tld));
        if (byTld) {
            return { ...result, country: byTld, code: byTld.code, source: 'tld' };
        }
    }
    if (primaryLang) {
        const byLang = Object.values(countries).find(c => c.languages.includes(primaryLang));
        if (byLang) {
            return { ...result, country: byLang, code: byLang.code, source: 'lang' };
        }
    }
    return result;
}

export function isExternalHost(hostname, country) {
    if (!country || !hostname) {
        return false;
    }
    const host = hostname.toLowerCase();
    return country.externalHosts.some(h => host === h || host.endsWith('.' + h));
}
