import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCountries, selectCountry, isExternalHost } from './countries.js';

// Links to a central statement platform (was.digst.dk, uustatus.no) are the
// most reliable lead there is, so they are visited before any own-site page.
const EXTERNAL_STATEMENT_PRECISION = 0.6;

export class HarAnalyzer {
    // options.country: country code forced with --allystatement.country.
    constructor(options = {}) {
        this.groups = {};
        this.countryOption = options.country;
        this.countries = getCountries();

        this.rules = {
            "no-network": "warning",
            "no-updated-date": "error",
            "updated-date-older-than-1years": "warning",
            "updated-date-older-than-2years": "error",
            "updated-date-older-than-3years": "error",
            "updated-date-older-than-4years": "error",
            "updated-date-older-than-5years": "error",
            "no-evaluation-method": "error",
            "has-canonical-notification-function-link": "info",
            "has-old-notification-function-link": "warning",
            "no-notification-function-link": "error",
            "compatible-word-not": "error",
            "compatible-word-partly": "error",
            "no-compatible-word": "error",
            "has-unreasonably-burdensome-accommodation": "error",
            "no-a11y-statement": "critical",
            "no-country-rules": "info"
        };

        const libFolder = fileURLToPath(new URL('..', import.meta.url));
        this.pluginFolder = path.resolve(libFolder, '..');
        const packagePath = path.resolve(libFolder, 'package.json');
        this.package = JSON.parse(readFileSync(packagePath, 'utf8'));
        this.dependencies = this.package.dependencies;
        this.version = this.package.version;
    }

    trySetStartUrl(url, uuid, group) {
        if (this.groups[group] !== undefined) {
            // Only test it once for every group
            return undefined;
        }
        this.groups[group] = {
            'start-url': url
        }
    }

    // Decides the country once per group, from the option, the TLD of the
    // start URL and the lang attribute of the first page (see selectCountry()
    // in countries.js for why the TLD wins over lang).
    resolveCountry(group, url, lang) {
        const groupData = this.groups[group];
        if (groupData['country-selection'] === undefined) {
            const startUrl = groupData['start-url'] || url;
            const selection = selectCountry({
                option: this.countryOption,
                url: startUrl,
                lang
            }, this.countries);
            // Keep the group data plain (it is sent as the summary message).
            groupData['country-selection'] = {
                code: selection.code,
                source: selection.source,
                tld: selection.tld,
                lang: selection.lang,
                status: selection.country ? selection.country.status : 'unknown'
            };
        }
        return groupData['country-selection'];
    }

    getCountry(group) {
        const groupData = this.groups[group];
        if (!groupData || !groupData['country-selection']) {
            return undefined;
        }
        const country = this.countries[groupData['country-selection'].code];
        return country && country.supported ? country : undefined;
    }

    getNoCountryRulesText(selection) {
        const parts = [];
        if (selection.source === 'option') {
            parts.push(`country '${selection.code}' (set with --allystatement.country)`);
        }
        else if (selection.code) {
            parts.push(`country '${selection.code}' (from ${selection.source === 'tld' ? 'TLD' : 'lang'})`);
        }
        parts.push(selection.tld ? `TLD '.${selection.tld}'` : 'no country TLD');
        parts.push(selection.lang ? `lang '${selection.lang}'` : 'no lang attribute');
        const detected = parts.join(', ');
        const supported = Object.values(this.countries)
            .filter(c => c.supported)
            .map(c => c.code)
            .join(', ');

        const country = this.countries[selection.code];
        if (country && !country.supported) {
            return `Accessibility statement rules for ${country.name} are ${country.status}; the statement was not rated (${detected})`;
        }
        return `No accessibility statement rules for this website: ${detected}. Supported countries: ${supported}`;
    }

    makeNoCountryRulesIssues(url, selection, existingIssues = {}) {
        const issues = {
            'no-country-rules': {
                'test': 'a11y-statement',
                rule: 'no-country-rules',
                category: 'a11y',
                severity: 'info',
                subIssues: [{
                    url: url,
                    rule: 'no-country-rules',
                    category: 'a11y',
                    text: this.getNoCountryRulesText(selection),
                    severity: 'info',
                    line: 0,
                    column: 0
                }]
            }
        };
        return this.padResolvedRules(issues, existingIssues);
    }

    padResolvedRules(issuesByRule, existingIssues = {}) {
        const allRules = Object.keys(this.rules || {}).filter(rule => this.rules[rule] !== 'off');
        for (const rule of allRules) {
            // Do not overwrite rules that are already set (for example
            // 'no-network' as a warning).
            if (issuesByRule[rule] || existingIssues[rule]) {
                continue;
            }
            issuesByRule[rule] = {
                'test': 'a11y-statement',
                rule: rule,
                category: 'a11y',
                severity: 'resolved',
                subIssues: []
            };
        }
        return issuesByRule;
    }

    getFirstPageEntries(url, harData, group) {
        if ('log' in harData) {
            harData = harData['log'];
        }

        const entries = harData.entries;
        if (!Array.isArray(entries)) {
            return [];
        }

        // A HAR can contain more than one page, for example when a concurrent
        // browsertime run ends up in the same browser session (crossed DevTools
        // port) and navigates to another website mid-recording. Requests made
        // by other pages must not be attributed to the tested website, and if
        // the recording doesn't even start with the tested website nothing in
        // it can be trusted.
        if (url && entries.length > 0) {
            const firstUrl = entries[0].request && entries[0].request.url;
            if (firstUrl) {
                try {
                    const firstHost = new URL(firstUrl).hostname;
                    // A statement on a central platform of the selected
                    // country (was.digst.dk, uustatus.no) is a page we asked
                    // for ourselves, even when it was reached through a
                    // redirect between host variants (www.was.digst.dk).
                    const isExternal = isExternalHost(firstHost, this.getCountry(group));
                    if (firstHost !== new URL(url).hostname && !isExternal) {
                        return [];
                    }
                } catch {
                    // Unparsable URLs are handled by the entry loops as before
                }
            }
        }

        const pages = harData.pages;
        if (!Array.isArray(pages) || pages.length === 0) {
            return entries;
        }
        const firstPageId = pages[0].id;
        if (firstPageId === undefined) {
            return entries;
        }
        return entries.filter(entry =>
            entry.pageref === undefined || entry.pageref === firstPageId);
    }

    transform2SimplifiedData(harData, url, group) {
        const data = {
            'url': url,
            'htmls': []
        };

        let reqIndex = 1;

        for (const entry of this.getFirstPageEntries(url, harData, group)) {
            const req = entry.request;
            const res = entry.response;
            const reqUrl = req.url;

            if (!res.content || !res.content.text || !res.content.mimeType || !res.content.size || res.content.size <= 0 || !res.status) {
                continue;
            }

            const obj = {
                'url': reqUrl,
                'content': res.content.text,
                'index': reqIndex
            };
            if (res.content.mimeType.includes('html')) {
                data.htmls.push(obj);
                break;
            }

            reqIndex++;
        }

        return data;
    }

    async createKnowledgeFromData(analyzedData, url, group) {
        let knowledgeData = {
            'url': url,
            'group': group,
            'issues': {},
            'interesting-urls': {}
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('htmls' in analyzedData)) {
            return knowledgeData;
        }

        if (analyzedData['htmls'].length === 0) {
            knowledgeData['issues']['no-network'] = {
                'test': 'a11y-statement',
                'rule': 'no-network',
                'category': 'technical',
                'severity': 'warning',
                'subIssues': [
                    {
                        'url': url,
                        'rule': 'no-network',
                        'category': 'a11y',
                        'severity': 'warning',
                        'text': `No HTML content found in the HAR file.`,
                        'line': 0,
                        'column': 0
                    }
                ]
            }
            return knowledgeData;
        }

        const parsedUrl = new URL(url);
        const org_url_start = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

        for (const entry of analyzedData.htmls) {
            if (!entry.content) {
                continue;
            }

            const entryUrl = entry.url;
            const dom = new JSDOM(entry.content);
            const doc = dom.window.document;

            const lang = doc.documentElement ? doc.documentElement.getAttribute('lang') : null;
            const selection = this.resolveCountry(group, url, lang);
            knowledgeData['country'] = selection.code || null;
            const country = this.getCountry(group);
            if (!country) {
                // No rules for this country (or they are pending): report it
                // as info instead of failing the site for a statement we
                // cannot recognise, and do not crawl further.
                if (!this.groups[group]['no-country-rules']) {
                    this.groups[group]['no-country-rules'] = true;
                    knowledgeData.issues = {
                        ...knowledgeData.issues,
                        ...this.makeNoCountryRulesIssues(url, selection)
                    };
                }
                continue;
            }

            const body = doc.querySelector('body');
            if (body) {
                const isExternalPage = isExternalHost(parsedUrl.hostname, country);
                const externalStatementUrl = isExternalPage
                    ? undefined
                    : this.getExternalStatementLink(org_url_start, body, country);

                if (country.externalOnly) {
                    // Italy: the statement lives only on form.agid.gov.it and
                    // its HTML is an empty app shell. A link to it from the
                    // site is the statement; content rules cannot be checked.
                    if (externalStatementUrl) {
                        knowledgeData['external-a11y-statement-url'] = externalStatementUrl;
                        knowledgeData['is-a11y-statement'] = true;
                        this.groups[group]['has-a11y-statement'] = true;
                        knowledgeData.issues = {
                            ...knowledgeData.issues,
                            ...this.padResolvedRules({}, knowledgeData.issues)
                        };
                        continue;
                    }
                }

                const interesting_links = isExternalPage
                    ? undefined
                    : this.getInterestingUrlsWithFallback(org_url_start, body, entry.content, entryUrl, country);
                if (interesting_links) {
                    knowledgeData['interesting-urls'] = interesting_links
                    this.groups[group]['interesting-urls'] = {
                        ...this.groups[group]['interesting-urls'],
                        ...knowledgeData['interesting-urls']
                    };
                    this.groups[group]['interesting-urls'] = this.sortInterestingUrls(this.groups[group]['interesting-urls']);
                }

                let isA11yStatement = false;
                let issues_if_a11y_statement = []
                const bodyText = this.getMinifiedBodyText(body, knowledgeData);
                issues_if_a11y_statement.push(...this.tryGetCompatibleText(entryUrl, bodyText, knowledgeData, country));
                issues_if_a11y_statement.push(...this.tryGetNotificationUrl(entryUrl, body, doc, knowledgeData, country));
                issues_if_a11y_statement.push(...this.tryGetUnreasonablyBurdensomeAccommodation(entryUrl, bodyText, knowledgeData, country));

                // An own-site page that only points on to the central
                // platform (fhi.no, oslo.kommune.no) is a signpost, not the
                // statement: keep crawling so the platform page is rated.
                const isSignpost = !!externalStatementUrl && !knowledgeData['compatible-word'];

                if (!isSignpost && this.looks_like_a11y_statement(knowledgeData, body, doc, country)) {
                    knowledgeData['is-a11y-statement'] = true;
                    isA11yStatement = true;
                    this.groups[group]['has-a11y-statement'] = true;
                    // TODO: Check found depth of the a11y statement
                    issues_if_a11y_statement.push(...this.tryGetEvaluationMethod(entryUrl, bodyText, knowledgeData, country));
                    issues_if_a11y_statement.push(...this.tryGetUpdatedDate(entryUrl, bodyText, knowledgeData, country));
                }

                if (isA11yStatement) {
                    // Convert issues to a set grouped by rule
                    const issuesByRule = {};
                    for (const issue of issues_if_a11y_statement) {
                        if (!issuesByRule[issue.rule]) {
                            issuesByRule[issue.rule] = {
                                'test': 'a11y-statement',
                                rule: issue.rule,
                                category: issue.category,
                                severity: issue.severity,
                                subIssues: []
                            };
                        }
                        issuesByRule[issue.rule].subIssues.push(issue);
                    }

                    this.padResolvedRules(issuesByRule);

                    knowledgeData.issues = {
                        ...knowledgeData.issues,
                        ...issuesByRule
                    };
                }
            }
        }

        return knowledgeData;
    }

    // Collects every date found next to one of the country's trigger words
    // ("uppdaterad", "senest revideret", "zuletzt ... überprüft") and rates the
    // age of the one whose trigger has the lowest weight.
    findDates(bodyText, country) {
        const dates = [];
        for (const regex of country.dates.regexes) {
            regex.lastIndex = 0;
            for (const match of bodyText.matchAll(regex)) {
                dates.push(this.getWeightedDocDateFromMatch(match, bodyText, country));
            }
        }
        return dates;
    }

    tryGetUpdatedDate(url, bodyText, knowledgeData, country) {
        const dates = this.findDates(bodyText, country);
        let issues = [];

        const uniqueDates = dates.filter((date, index, self) =>
            index === self.findIndex(d =>
                d.word === date.word &&
                d.text === date.text &&
                d.type === date.type &&
                d.date[0] === date.date[0] &&
                d.date[1] === date.date[1] &&
                d.date[2] === date.date[2] &&
                d.weight === date.weight
            )
        );

        uniqueDates.sort((a, b) => b.weight - a.weight);

        if (uniqueDates.length === 0) {
            issues.push({
                url: url,
                rule: 'no-updated-date',
                category: 'a11y',
                text: `Unable to find when the accessibility statement was updated`,
                severity: 'error',
            });
        } else {
            const dateInfo = uniqueDates.pop().date;
            const dateDoc = new Date(dateInfo[0], dateInfo[1] - 1, dateInfo[2]);

            const year = 365 * 24 * 60 * 60 * 1000;
            const now = new Date();

            const cutoff1Year = new Date(now.getTime() - year);
            const cutoff2Year = new Date(now.getTime() - 2 * year);
            const cutoff3Year = new Date(now.getTime() - 3 * year);
            const cutoff4Year = new Date(now.getTime() - 4 * year);
            const cutoff5Year = new Date(now.getTime() - 5 * year);

            if (cutoff1Year < dateDoc) {
                // Everything is ok, no issues
            }
            else if (cutoff2Year < dateDoc) {
                issues.push({
                    url: url,
                    rule: 'updated-date-older-than-1years',
                    category: 'a11y',
                    text: `Accessibility statement seems to be older than 1 year`,
                    severity: 'warning',
                });
            }
            else if (cutoff3Year < dateDoc) {
                issues.push({
                    url: url,
                    rule: 'updated-date-older-than-2years',
                    category: 'a11y',
                    text: `Accessibility statement seems to be older than 2 years`,
                    severity: 'error',
                });
            }
            else if (cutoff4Year < dateDoc) {
                issues.push({
                    url: url,
                    rule: 'updated-date-older-than-3years',
                    category: 'a11y',
                    text: `Accessibility statement seems to be older than 3 years`,
                    severity: 'error',
                });
            }
            else if (cutoff5Year < dateDoc) {
                issues.push({
                    url: url,
                    rule: 'updated-date-older-than-4years',
                    category: 'a11y',
                    text: `Accessibility statement seems to be older than 4 years`,
                    severity: 'error',
                });
            }
            else {
                issues.push({
                    url: url,
                    rule: 'updated-date-older-than-5years',
                    category: 'a11y',
                    text: `Accessibility statement seems to be older than 5 years`,
                    severity: 'error',
                });
            }
        }

        knowledgeData['dates'] = uniqueDates;
        return issues;
    }

    getWeightedDocDateFromMatch(match, bodyText, country) {
        let weight = 0.3;
        let text = match[0];
        if (text) {
            text = text.trim();
        }
        let remark = match.groups.typ;
        let word = remark;
        if (remark) {
            remark = remark.trim().toLowerCase();
        }

        let day = match.groups.day;
        let month = match.groups.month;
        let year = match.groups.year;

        if (year) {
            year = parseInt(year.trim().replace(/-$/, ''), 10);
        }
        if (month) {
            month = month.trim().replace(/-$/, '').toLowerCase();
            month = this.convertToMonthNumber(month, country);
        }

        if (day && day !== '') {
            day = parseInt(day.trim().replace(/-$/, ''), 10);
        } else {
            day = 1;
            weight = 0.1;
        }

        const tmpWeight = this.getDateWeight(remark, country);
        if (tmpWeight !== null) {
            weight = tmpWeight;
        }

        return {
            word: this.tryGetFullWord(word, bodyText, country),
            text: this.tryGetWordSentence(text, bodyText, country),
            type: remark,
            date: [year, month, day],
            weight: weight
        };
    }

    // Month name (or any form starting with its unique prefix, such as
    // "jan", "januari", "juil.") or a number.
    convertToMonthNumber(month, country) {
        const lower = month.toLowerCase();
        const prefixes = country.dates.prefixes;
        for (let i = 0; i < prefixes.length; i++) {
            if (lower.startsWith(prefixes[i])) {
                return i + 1;
            }
        }
        return parseInt(month, 10);
    }

    getDateWeight(text, country) {
        for (const trigger of country.dates.triggers) {
            if (trigger.regex.test(text)) {
                return trigger.weight;
            }
        }

        return null;
    }

    tryGetEvaluationMethod(url, bodyText, knowledgeData, country) {
        let issues = [];
        const evaluationMethod = country.evaluation ? bodyText.match(country.evaluation) : null;
        if (evaluationMethod) {
            const searchWord = evaluationMethod[0];
            knowledgeData['evaluation-method-word'] = searchWord.trim();
            knowledgeData['evaluation-method-text'] = this.tryGetWordSentence(searchWord, bodyText, country);
        }
        else {
            issues.push({
                url: url,
                rule: 'no-evaluation-method',
                category: 'a11y',
                text: `Unable to find which audit method used`,
                severity: 'error',
            });
        }
        return issues;
    }

    looks_like_a11y_statement(knowledgeData, body, doc, country) {
        // Extract h1 and title whichever path is taken below, so that they
        // show up in the output (used as debug info).
        const h1Element = body.querySelector('h1');
        if (h1Element) {
            knowledgeData['h1'] = h1Element.textContent.replace(/\u00AD/g, '').trim();
        }
        const titleElement = doc.querySelector('title');
        if (titleElement) {
            knowledgeData['page-title'] = titleElement.textContent.replace(/\u00AD/g, '').trim();
        }

        const h1Text = knowledgeData['h1'] || '';
        const titleText = knowledgeData['page-title'] || '';

        // strict: the legal name of the statement ("tillgänglighetsredogörelse",
        // "Tilgængelighedserklæring", "Erklärung zur Barrierefreiheit").
        // loose: only the root word ("tillgänglighet", "Barrierefreiheit").
        const strictRegex = country.strict;
        const looseRegex = country.loose;

        const hasStrictMatch = !!strictRegex && (strictRegex.test(h1Text) || strictRegex.test(titleText));

        // Strong signal on its own: h1 or title holds the full legal name.
        // Specific enough that no legal-language signal is needed. Handles
        // sites (such as rvn.se) that neither say "delvis förenlig" nor link
        // to digg.se.
        if (hasStrictMatch) {
            return true;
        }

        // Weaker signal: h1 or title only holds the root word. Then at least
        // one legal-language signal must also be found in the text, showing
        // that this is the legal statement. Handles sites (such as
        // regionostergotland.se) with headings like "Tillgänglighet på
        // webbplatsen".
        const hasLooseMatch = !!looseRegex && (looseRegex.test(h1Text) || looseRegex.test(titleText));
        const hasLegalSignal = !!(
            knowledgeData['compatible-word'] ||
            knowledgeData['notification-function-link-url'] ||
            knowledgeData['unreasonably-burdensome-accommodation-word']
        );

        if (hasLooseMatch && hasLegalSignal) {
            return true;
        }

        return false;
    }

    getMinifiedBodyText(body, knowledgeData) {
        const minifiedBody = body.cloneNode(true);

        const tagsToRemove = ['script', 'nav', 'form', 'input', 'button', 'a'];
        tagsToRemove.forEach(tag => {
            const elements = minifiedBody.querySelectorAll(tag);
            elements.forEach(element => element.remove());
        });

        const bodyText = minifiedBody.textContent
            .replace(/\u00AD/g, '')
            .replace(/\n/g, ' ')
            .replace(/\t/g, ' ')
            .replace(/ {2,}/g, ' ').trim();
        knowledgeData['body-text'] = bodyText;
        return bodyText;
    }

    // Looks for the enforcement procedure: a link (or, for countries without
    // a complaint URL such as Denmark, an e-mail address in the text) to the
    // body that handles complaints. Checked in the order canonical, old,
    // accepted: the old Swedish DIGG URL pattern also matches the canonical
    // URL, and Finland accepts any saavutettavuusvaatimukset.fi link but
    // flags its removed /oikeutesi/ page as old.
    tryGetNotificationUrl(url, body, doc, knowledgeData, country) {
        let issues = [];
        const enforcement = country.enforcement;
        const label = enforcement.label;
        const matchesAny = (regexes, value) => regexes.some(regex => regex.test(value));

        body.querySelectorAll('a').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (href && href.length > 0) {
                const linkText = anchor.textContent.replace(/­/g, '').trim();
                if (matchesAny(enforcement.canonical, href)) {
                    knowledgeData['notification-function-link-text'] = linkText;
                    knowledgeData['notification-function-link-url'] = href;
                    issues.push({
                        url: url,
                        rule: 'has-canonical-notification-function-link',
                        category: 'a11y',
                        text: `Correct link (canonical) to ${label}`,
                        severity: 'info',
                        data: {
                            text: linkText,
                            url: href
                        }
                    });
                }
                else if (matchesAny(enforcement.old, href)) {
                    knowledgeData['notification-function-link-text'] = linkText;
                    knowledgeData['notification-function-link-url'] = href;
                    issues.push({
                        url: url,
                        rule: 'has-old-notification-function-link',
                        category: 'a11y',
                        text: `Uses old or incorrect link to ${label}`,
                        severity: 'warning',
                        data: {
                            text: linkText,
                            url: href
                        }
                    });
                }
                else if (matchesAny(enforcement.accepted, href)) {
                    knowledgeData['notification-function-link-text'] = linkText;
                    knowledgeData['notification-function-link-url'] = href;
                }
            }
        });

        if (!knowledgeData['notification-function-link-url']
            && (enforcement.text.length > 0 || enforcement.oldText.length > 0)) {
            const fullText = body.textContent.replace(/­/g, '');
            const canonicalMatch = this.firstMatch(enforcement.text, fullText);
            const oldMatch = canonicalMatch ? null : this.firstMatch(enforcement.oldText, fullText);
            const textMatch = canonicalMatch || oldMatch;
            if (textMatch) {
                knowledgeData['notification-function-link-text'] = textMatch[0];
                knowledgeData['notification-function-link-url'] = textMatch[0];
                issues.push({
                    url: url,
                    rule: canonicalMatch ? 'has-canonical-notification-function-link' : 'has-old-notification-function-link',
                    category: 'a11y',
                    text: canonicalMatch
                        ? `Correct reference (in text) to ${label}`
                        : `Uses old or incorrect reference (in text) to ${label}`,
                    severity: canonicalMatch ? 'info' : 'warning',
                    data: {
                        text: textMatch[0]
                    }
                });
            }
        }

        if (!knowledgeData['notification-function-link-url']) {
            issues.push({
                url: url,
                rule: 'no-notification-function-link',
                category: 'a11y',
                text: `Missing or has an incorrect link to ${label}`,
                severity: 'error',
            });
        }
        return issues;
    }

    firstMatch(regexes, text) {
        for (const regex of regexes) {
            const match = text.match(regex);
            if (match) {
                return match;
            }
        }
        return null;
    }

    // Finds the self-declared compliance level. The leftmost phrase in the
    // text wins; on the same position partial beats none beats full, so
    // "inte helt förenlig" (as on alvsbyn.se) is partial, not full.
    findCompliance(bodyText, country) {
        let best = null;
        for (const { level, regexes } of country.compliance) {
            for (const regex of regexes) {
                const match = bodyText.match(regex);
                if (match && (best === null || match.index < best.match.index)) {
                    best = { level, match };
                }
            }
        }
        return best;
    }

    tryGetCompatibleText(url, bodyText, knowledgeData, country) {
        let issues = [];

        const compliance = this.findCompliance(bodyText, country);
        if (compliance) {
            const searchWord = compliance.match[0];
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText, country);

            const isPartly = compliance.level === 'partial';
            const isNot = compliance.level === 'none';

            if (isPartly) {
                issues.push({
                    url: url,
                    rule: 'compatible-word-partly',
                    category: 'a11y',
                    text: `Self-indicates that the website is only partially compliant with the legal requirements`,
                    severity: 'error',
                });
            }
            else if (isNot) {
                issues.push({
                    url: url,
                    rule: 'compatible-word-not',
                    category: 'a11y',
                    text: `Self-indicates that website is not compliant with legal requirements`,
                    severity: 'error',
                });
            }
            // level 'full': no issue
        }
        else {
            issues.push({
                url: url,
                rule: 'no-compatible-word',
                category: 'a11y',
                text: `Lacks any specific statement on the legal compliancy`,
                severity: 'error',
            });
        }
        return issues;
    }

    escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    tryGetWordSentence(word, bodyText, country) {
        const { upper, lower, flags } = country.letters;
        const escaped = this.escapeRegExp(word);
        const sentenceMatch = bodyText.match(new RegExp(`[${upper}.]{0,1}[${lower} ]+?${escaped}[^${upper}.]*\\.`, flags));
        if (sentenceMatch) {
            let compatibleText = sentenceMatch[0].trim();
            if (compatibleText.length > 200) {
                const searchWordIndex = compatibleText.indexOf(word);
                const start = Math.max(0, searchWordIndex - 100);
                const end = Math.min(compatibleText.length, searchWordIndex + 100 + word.length);
                compatibleText = compatibleText.substring(start, end).trim();

                if (start > 0) compatibleText = '...' + compatibleText;
                if (end < compatibleText.length) compatibleText += '...';
            }

            return compatibleText;
        }
        return word;
    }

    tryGetFullWord(word, bodyText, country) {
        const { upper, lower, flags } = country.letters;
        const escaped = this.escapeRegExp(word);
        const sentenceMatch = bodyText.match(new RegExp(`[${upper} .]{0,1}[${lower}]*${escaped}[${lower}]*[^ .]*`, flags));
        if (sentenceMatch) {
            let compatibleText = sentenceMatch[0].trim();
            if (compatibleText.length > 20) {
                const searchWordIndex = compatibleText.indexOf(word);
                const start = Math.max(0, searchWordIndex - 10);
                const end = Math.min(compatibleText.length, searchWordIndex + 10 + word.length);
                compatibleText = compatibleText.substring(start, end).trim();
            }

            return compatibleText;
        }
        return word;
    }

    tryGetUnreasonablyBurdensomeAccommodation(url, bodyText, knowledgeData, country) {
        let issues = [];
        // Patterns are tried in order; the first one found anywhere wins.
        const compatTextMatch = this.firstMatch(country.burden, bodyText);
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0];
            knowledgeData['unreasonably-burdensome-accommodation-word'] = searchWord;
            knowledgeData['unreasonably-burdensome-accommodation-text'] = this.tryGetWordSentence(searchWord, bodyText, country);
            const reference = country.burdenReference ? ` (${country.burdenReference})` : '';
            issues.push({
                url: url,
                rule: 'has-unreasonably-burdensome-accommodation',
                category: 'a11y',
                text: `Claims resolution to be unreasonably burdensome${reference}`,
                severity: 'error',
            });
        }
        return issues;
    }

    getInterestingTextPrecision(text, country) {
        for (const pattern of country.linkPrecision) {
            if (pattern.regex.test(text)) {
                return pattern.precision;
            }
        }

        return 0.1;
    }

    // Returns the absolute URL when href points to one of the country's
    // central statement platforms (was.digst.dk, uustatus.no, form.agid.gov.it).
    toExternalStatementUrl(org_url_start, href, country) {
        if (!country || country.externalHosts.length === 0) {
            return undefined;
        }
        try {
            const absolute = new URL(href, org_url_start);
            if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
                return undefined;
            }
            if (isExternalHost(absolute.hostname, country)) {
                return absolute.href;
            }
        } catch {
            // Not a URL
        }
        return undefined;
    }

    getExternalStatementLink(org_url_start, body, country) {
        if (!country || country.externalHosts.length === 0) {
            return undefined;
        }
        for (const anchor of body.querySelectorAll('a[href]')) {
            const external = this.toExternalStatementUrl(org_url_start, anchor.getAttribute('href'), country);
            if (external) {
                return external;
            }
        }
        return undefined;
    }

    // "www.example.se" and "example.se" are the same site.
    getSiteKey(hostname) {
        return (hostname || '').toLowerCase().replace(/^www\./, '');
    }

    // Resolves href against the page it was found on and returns it as an
    // absolute URL on the tested site, or undefined for links to other
    // sites, non-web schemes and fragments. Links to the same site with or
    // without "www" are rewritten to the start URL's host, so that one page
    // is not queued twice.
    toSameSiteUrl(org_url_start, href, pageUrl) {
        let resolved;
        try {
            resolved = new URL(href.trim(), pageUrl || org_url_start);
        } catch {
            return undefined;
        }
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
            return undefined;
        }
        const start = new URL(org_url_start);
        if (this.getSiteKey(resolved.hostname) !== this.getSiteKey(start.hostname)) {
            return undefined;
        }
        resolved.protocol = start.protocol;
        resolved.hostname = start.hostname;
        resolved.port = start.port;
        resolved.hash = '';
        return resolved.href;
    }

    isNonHtmlUrl(url) {
        const path = url.toLowerCase().split(/[?#]/)[0];
        const nonHtmlExtensions = [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.odt', '.ods', '.odp', '.rtf', '.csv', '.txt',
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff',
            '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov', '.flac', '.m4a',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            '.json', '.xml', '.rss', '.atom', '.js', '.css'
        ];
        return nonHtmlExtensions.some(ext => path.endsWith(ext));
    }

    // Some sites build their footer with JavaScript from data in the page,
    // for example {"name":"Tillgänglighetsredogörelse","url":"https://..."}
    // on skatteverket.se, so the link never appears as an <a> element in the
    // HTML the server sends. This looks for URLs anywhere in the raw HTML
    // whose path names an accessibility statement. Precision stays at or
    // below what the same wording gives as link text. <a> elements are left
    // out: getInterestingUrls() rates those by their link text, and matching
    // their paths as well would change which page is picked on sites such as
    // 1177.se, where many statements for sub-services share one hub page.
    getInterestingUrlsFromPageData(org_url_start, content, pageUrl) {
        const urls = {};
        if (!content) {
            return urls;
        }
        const text = content
            .replace(/<a\b[^>]*>/gi, ' ')
            .replace(/\\\//g, '/');
        const candidates = text.matchAll(/(?:https?:\/\/[^\s"'<>()\\]+|\/[^\s"'<>()\\]*tillg[^\s"'<>()\\]*)/gi);
        for (const match of candidates) {
            const raw = match[0];
            if (this.isNonHtmlUrl(raw)) {
                continue;
            }
            const url = this.toSameSiteUrl(org_url_start, raw, pageUrl);
            if (!url) {
                continue;
            }
            let path;
            try {
                path = decodeURIComponent(new URL(url).pathname).toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            } catch {
                continue;
            }
            let precision = 0;
            if (/tillganglighetsredogorelse/.test(path)) {
                precision = 0.5;
            } else if (/tillganglighet/.test(path)) {
                precision = 0.3;
            }
            if (precision > (urls[url] || 0)) {
                urls[url] = precision;
            }
        }
        return urls;
    }

    // Lowest link text precision that means the link is about accessibility
    // ("tillgänglighet" anywhere in the text gives 0.3).
    static ACCESSIBILITY_LINK_PRECISION = 0.3;

    // Links in the page come first. Page data is only a fallback for pages
    // whose <a> elements say nothing about accessibility, so that pages
    // where the old link text rules already find a candidate keep exactly
    // the same candidates as before.
    getInterestingUrlsWithFallback(org_url_start, body, content, pageUrl, country) {
        const fromLinks = this.getInterestingUrls(org_url_start, body, country, pageUrl);
        const hasAccessibilityLink = Object.values(fromLinks)
            .some(precision => precision >= HarAnalyzer.ACCESSIBILITY_LINK_PRECISION);
        // The page data patterns are Swedish ("tillganglighetsredogorelse"),
        // so the fallback only applies to Swedish rules.
        if (hasAccessibilityLink || !country || country.code !== 'se') {
            return fromLinks;
        }
        return this.mergeInterestingUrls(
            fromLinks,
            this.getInterestingUrlsFromPageData(org_url_start, content, pageUrl));
    }

    // Combines candidate URLs, keeping the highest precision per URL.
    mergeInterestingUrls(...lists) {
        const merged = {};
        for (const list of lists) {
            for (const [url, precision] of Object.entries(list || {})) {
                if (precision > (merged[url] || 0)) {
                    merged[url] = precision;
                }
            }
        }
        return this.sortInterestingUrls(merged);
    }

    getInterestingUrls(org_url_start, body, country, pageUrl) {
        const urls = {};
        const anchors = body.querySelectorAll('a[href]');
        for (const anchor of anchors) {
            let href = anchor.getAttribute('href');
            if (!href || href.length == 0) {
                continue;
            }
            // Skip links to files that are not HTML. They can match through
            // their file name (for example "tillganglighetsanalys.docx") and
            // end up in the queue; following them gives no HTML response and
            // a false "no-network" warning.
            const lowerHref = href.toLowerCase();
            const nonHtmlExtensions = [
                // Documents
                '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                '.odt', '.ods', '.odp', '.rtf', '.csv', '.txt',
                // Images
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff',
                // Media
                '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov', '.flac', '.m4a',
                // Archives
                '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
                // Data
                '.json', '.xml', '.rss', '.atom'
            ];
            if (nonHtmlExtensions.some(ext => lowerHref.endsWith(ext))) {
                continue;
            }
            // Statements on a central platform (Denmark, Norway) are fetched
            // like an own-site page. For Italy (externalOnly) the link itself
            // is the finding and the platform page is never fetched.
            const external = this.toExternalStatementUrl(org_url_start, href, country);
            if (external) {
                if (!country.externalOnly) {
                    urls[external] = EXTERNAL_STATEMENT_PRECISION;
                }
                continue;
            }
            if (href.trim().startsWith('#')) {
                continue;
            }
            href = this.toSameSiteUrl(org_url_start, href, pageUrl);
            if (!href) {
                continue;
            }

            const text = anchor.textContent.replace(/­/g, '').trim();
            // Only links whose text matches one of the country's statement
            // patterns get a precision above 0.1.
            const precision = this.getInterestingTextPrecision(text, country);
            if (precision > 0.1) {
                urls[href] = precision;
            }

        }

        return this.sortInterestingUrls(urls);
    }

    sortInterestingUrls(urls) {
        const sortedUrls = Object.entries(urls)
            .sort(([, precisionA], [, precisionB]) => precisionB - precisionA)
            .reduce((acc, [href, precision]) => {
                acc[href] = precision;
                return acc;
            }, {});
        return sortedUrls;
    }

    async analyzeData(url, harData, group) {
        if (this.groups[group] === undefined) {
            this.groups[group] = {};
        }

        const analyzedData = this.transform2SimplifiedData(harData, url, group);
        if (!('analyzedData' in this.groups[group])) {
            this.groups[group]['analyzedData'] = []
        }
        this.groups[group]['analyzedData'].push(analyzedData);

        const knowledgeData = await this.createKnowledgeFromData(analyzedData, url, group);
        if (!('knowledgeData' in this.groups[group])) {
            this.groups[group]['knowledgeData'] = []
        }
        this.groups[group]['knowledgeData'].push(knowledgeData);

        return {
            'version': this.version,
            'dependencies': this.dependencies,
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }

    // Runs in the summarize phase. When no statement was found, adds
    // no-a11y-statement (critical) plus every other rule as resolved to the
    // first page, so that plugin-webperf-core can compute a correct score.
    // When the site has no supported country, no-country-rules (info) is
    // reported instead. Returns true when issues were added, meaning the
    // first page has to be published again.
    checkNoAccessibilityStatement(group) {
        if (this.groups[group] === undefined) {
            return false;
        }

        if (this.groups[group]['has-a11y-statement']) {
            return false;
        }

        if (!this.groups[group]['knowledgeData'] || this.groups[group]['knowledgeData'].length === 0) {
            return false;
        }

        const knowledgeData = this.groups[group]['knowledgeData'][0];
        const url = knowledgeData['url'] || this.groups[group]['start-url'];

        if (this.groups[group]['no-country-rules']) {
            // Already reported on the first page when it was analysed.
            return false;
        }

        // No HTML was analysed (for example 'no-network'), so the country
        // was never decided: decide it now from the option and the TLD.
        const selection = this.resolveCountry(group, url, undefined);
        if (!this.getCountry(group)) {
            this.groups[group]['no-country-rules'] = true;
            knowledgeData['country'] = selection.code || null;
            knowledgeData.issues = {
                ...knowledgeData.issues,
                ...this.makeNoCountryRulesIssues(url, selection, knowledgeData.issues)
            };
            return true;
        }

        // Build the full rule set the same way as the happy path in
        // createKnowledgeFromData.
        const issuesByRule = {
            'no-a11y-statement': {
                'test': 'a11y-statement',
                rule: 'no-a11y-statement',
                category: 'a11y',
                severity: 'critical',
                subIssues: [{
                    url: url,
                    rule: 'no-a11y-statement',
                    category: 'a11y',
                    text: `Unable to find accessibility statement`,
                    severity: 'critical',
                    line: 0,
                    column: 0
                }]
            }
        };

        this.padResolvedRules(issuesByRule, knowledgeData.issues);

        knowledgeData.issues = {
            ...knowledgeData.issues,
            ...issuesByRule
        };
        return true;
    }

    // The 15 URL limit is enforced here; checkNoAccessibilityStatement in the
    // sitespeedio.summarize phase reports the missing statement.
    getNextInterestingUrl(group) {
        if (this.groups[group] === undefined) {
            return undefined;
        }

        if (!('interesting-urls' in this.groups[group])) {
            return undefined;
        }

        if (!('visited-urls' in this.groups[group])) {
            this.groups[group]['visited-urls'] = new Set();
        }

        if (this.groups[group]['has-a11y-statement']) {
            return undefined;
        }

        const visitedUrls = this.groups[group]['visited-urls'];
        if (visitedUrls.size >= 15) {
            return undefined;
        }

        const interestingUrls = this.groups[group]['interesting-urls'];
        for (const url of Object.keys(interestingUrls)) {
            if (!visitedUrls.has(url)) {
                visitedUrls.add(url);
                delete interestingUrls[url];
                return url;
            }
        }

        return undefined;
    }

    getSummary() {
        return this;
    }
}