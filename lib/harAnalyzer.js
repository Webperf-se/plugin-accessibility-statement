import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLocalesForHostname } from './locales.js';

export class HarAnalyzer {
    constructor() {
        this.groups = {};

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
            "no-a11y-statement": "critical"
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

    getFirstPageEntries(url, harData) {
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
                    if (new URL(firstUrl).hostname !== new URL(url).hostname) {
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

    transform2SimplifiedData(harData, url) {
        const data = {
            'url': url,
            'htmls': []
        };

        let reqIndex = 1;

        for (const entry of this.getFirstPageEntries(url, harData)) {
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

        // Which country's wording/regulator applies is decided per fetched page
        // (not once for the whole site), since a Danish site's statement may live
        // on was.digst.dk and a Norwegian one on uustatus.no - both off-domain,
        // both still their own country's TLD. A .fi hostname yields two
        // candidates (Finnish, then Swedish - Finland is officially bilingual).
        const topLevelCandidateLocales = detectLocalesForHostname(parsedUrl.hostname);

        for (const entry of analyzedData.htmls) {
            if (!entry.content) {
                continue;
            }

            const entryUrl = entry.url;
            const dom = new JSDOM(entry.content);
            const doc = dom.window.document;

            const body = doc.querySelector('body');
            if (body) {
                const entryHostname = new URL(entryUrl).hostname;
                const candidateLocales = detectLocalesForHostname(entryHostname);
                const locale = this.detectLocaleForPage(candidateLocales, body, doc);

                const interesting_links = this.getInterestingUrls(org_url_start, body, locale);

                // Every Danish statement is centrally hosted at a predictable URL
                // (was.digst.dk/<domain>). Seed it as a top-precision candidate
                // instead of relying on finding an on-site footer link, unless
                // we're already looking at that central host.
                const primaryLocale = topLevelCandidateLocales[0];
                if (primaryLocale.centralStatementUrl && !org_url_start.includes('was.digst.dk')) {
                    interesting_links[primaryLocale.centralStatementUrl(parsedUrl.hostname)] = 1.0;
                }

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
                knowledgeData['locale'] = locale.code;
                issues_if_a11y_statement.push(...this.tryGetCompatibleText(entryUrl, bodyText, knowledgeData, locale));
                issues_if_a11y_statement.push(...this.tryGetNotificationUrl(entryUrl, body, doc, knowledgeData, locale));
                issues_if_a11y_statement.push(...this.tryGetUnreasonablyBurdensomeAccommodation(entryUrl, bodyText, knowledgeData, locale));

                if (this.looks_like_a11y_statement(knowledgeData, body, doc, locale)) {
                    knowledgeData['is-a11y-statement'] = true;
                    isA11yStatement = true;
                    this.groups[group]['has-a11y-statement'] = true;
                    // TODO: Check found depth of the a11y statement
                    issues_if_a11y_statement.push(...this.tryGetEvaluationMethod(entryUrl, bodyText, knowledgeData, locale));
                    issues_if_a11y_statement.push(...this.tryGetUpdatedDate(entryUrl, bodyText, knowledgeData, locale));
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

                    const allRules = [
                        ...Object.keys(this.rules || {}).filter(rule => this.rules[rule] !== "off")
                    ];

                    for (const rule of allRules) {
                        if (!issuesByRule[rule]) {
                            issuesByRule[rule] = {
                                'test': 'a11y-statement',
                                rule: rule,
                                category: 'a11y',
                                severity: 'resolved', // Default severity for missing issues
                                subIssues: []
                            };
                        }
                    }

                    knowledgeData.issues = {
                        ...knowledgeData.issues,
                        ...issuesByRule
                    };
                }
            }
        }

        return knowledgeData;
    }

    // Picks which locale's rules apply to a fetched page, from a prioritized list
    // of candidates for its hostname's TLD (see lib/locales.js). Only the strict
    // statement-title regex is checked here - cheap and side-effect-free - so we
    // don't need to run each candidate's full (side-effecting) analysis just to
    // find out which language the page is in.
    detectLocaleForPage(candidateLocales, body, doc) {
        const h1Element = body.querySelector('h1');
        const titleElement = doc.querySelector('title');
        const h1Text = h1Element ? h1Element.textContent.replace(/­/g, '').trim() : '';
        const titleText = titleElement ? titleElement.textContent.replace(/­/g, '').trim() : '';

        for (const locale of candidateLocales) {
            if (locale.statementTitle.strict.test(h1Text) || locale.statementTitle.strict.test(titleText)) {
                return locale;
            }
        }
        return candidateLocales[0];
    }

    tryGetUpdatedDate(url, bodyText, knowledgeData, locale) {
        const dates = [];
        let issues = [];

        locale.dateRegexes.forEach(regex => {
            const matches = bodyText.matchAll(regex);
            for (const match of matches) {
                dates.push(this.getWeightedDocDateFromMatch(match, bodyText, locale));
            }
        });

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

        // Highest-confidence marker word wins; ties (e.g. a statement mentioning
        // both when it was first published and when it was last updated, both
        // under the same marker word) are broken by preferring the more recent
        // date, not by whichever happened to appear first/last in the document.
        uniqueDates.sort((a, b) => {
            if (b.weight !== a.weight) {
                return b.weight - a.weight;
            }
            const aTime = new Date(a.date[0], a.date[1] - 1, a.date[2]).getTime();
            const bTime = new Date(b.date[0], b.date[1] - 1, b.date[2]).getTime();
            return bTime - aTime;
        });

        if (uniqueDates.length === 0) {
            issues.push({
                url: url,
                rule: 'no-updated-date',
                category: 'a11y',
                text: `Unable to find when the accessibility statement was updated`,
                severity: 'error',
            });
        } else {
            const dateInfo = uniqueDates.shift().date;
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

    getWeightedDocDateFromMatch(match, bodyText, locale) {
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
            month = this.convertToMonthNumber(month, locale);
        }

        if (day && day !== '') {
            day = parseInt(day.trim().replace(/-$/, ''), 10);
        } else {
            day = 1;
            weight = 0.1;
        }

        const tmpWeight = this.getDateWeight(remark, locale);
        if (tmpWeight !== null) {
            weight = tmpWeight;
        }

        return {
            word: this.tryGetFullWord(word, bodyText),
            text: this.tryGetWordSentence(text, bodyText),
            type: remark,
            date: [year, month, day],
            weight: weight
        };
    }

    convertToMonthNumber(month, locale) {
        for (const [shortMonthName, monthNumber] of Object.entries(locale.monthDict)) {
            if (month.toLowerCase().startsWith(shortMonthName)) {
                return monthNumber;
            }
        }
        return parseInt(month, 10);
    }

    getDateWeight(text, locale) {
        const patterns = locale.dateMarkers;

        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                return pattern.weight;
            }
        }

        return null;
    }

    tryGetEvaluationMethod(url, bodyText, knowledgeData, locale) {
        let issues = [];
        const evaluationMethod = bodyText.match(locale.evaluationMethodKeywords);
        if (evaluationMethod) {
            const searchWord = evaluationMethod[0];
            knowledgeData['evaluation-method-word'] = searchWord.trim();
            knowledgeData['evaluation-method-text'] = this.tryGetWordSentence(searchWord, bodyText);
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

    looks_like_a11y_statement(knowledgeData, body, doc, locale) {
        // Extrahera h1 och title oavsett vilken väg som tas nedan,
        // så att de syns i utdata (har använts som debug-info tidigare).
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

        // Hela det juridiska ordet ("tillgänglighetsredogörelse" / "tilgængelighedserklæring" / ...)
        const strictRegex = locale.statementTitle.strict;
        // Bara rotordet ("tillgänglighet" / "tilgængelighed" / ...)
        const looseRegex = locale.statementTitle.loose;

        const hasStrictMatch = strictRegex.test(h1Text) || strictRegex.test(titleText);

        // Stark signal på egen hand: h1 eller title innehåller hela ordet
        // "tillgänglighetsredogörelse". Så pass specifikt att vi inte också
        // behöver kräva en lagspråk-signal. Hanterar sajter (som rvn.se) som
        // inte använder formuleringen "delvis förenlig" och inte länkar
        // explicit till digg.se.
        if (hasStrictMatch) {
            return true;
        }

        // Svagare signal: h1 eller title innehåller bara "tillgänglighet".
        // Då kräver vi också att minst en lagspråk-signal hittats i texten,
        // som visar att det faktiskt rör sig om en juridisk redogörelse.
        // Hanterar sajter (som regionostergotland.se) som använder kortare
        // rubriker som "Tillgänglighet på webbplatsen".
        const hasLooseMatch = looseRegex.test(h1Text) || looseRegex.test(titleText);
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

    tryGetNotificationUrl(url, body, doc, knowledgeData, locale) {
        let issues = [];
        const reportLink = locale.reportLink;
        body.querySelectorAll('a').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (href && href.length > 0) {
                if (reportLink.exact && href === reportLink.exact) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else if (reportLink.canonical && href === reportLink.canonical) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                    issues.push({
                        url: url,
                        rule: 'has-canonical-notification-function-link',
                        category: 'a11y',
                        text: `Correct link (canonical) to ${reportLink.authorityName} report function`,
                        severity: 'info',
                        data: {
                            text: anchor.textContent.replace(/\u00AD/g, '').trim(),
                            url: href
                        }
                    });
                }
                else if (reportLink.domainPattern && reportLink.domainPattern.test(href)) {
                    // Countries without one single fixed report URL (Denmark, Norway):
                    // any link to the regulator's domain counts as having the report link.
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else if (reportLink.mailto && href.toLowerCase() === `mailto:${reportLink.mailto.toLowerCase()}`) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else if (reportLink.oldPattern && reportLink.oldPattern.test(href)) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                    issues.push({
                        url: url,
                        rule: 'has-old-notification-function-link',
                        category: 'a11y',
                        text: `Uses old or incorrect link to ${reportLink.authorityName} report function`,
                        severity: 'warning',
                        data: {
                            text: anchor.textContent.replace(/\u00AD/g, '').trim(),
                            url: href
                        }
                    });
                }
            }
        });
        if (!knowledgeData['notification-function-link-url']) {
            issues.push({
                url: url,
                rule: 'no-notification-function-link',
                category: 'a11y',
                text: `Missing or has an incorrect link to ${reportLink.authorityName} report function`,
                severity: 'error',
            });
        }
        return issues;
    }

    tryGetCompatibleText(url, bodyText, knowledgeData, locale) {
        let issues = [];

        // Each country's regulator only recognizes a small set of literal
        // compliance phrases (see lib/locales.js for the per-country wording and
        // sources). We match only those literally - no paraphrases. Anything else
        // is treated as the statement lacking the required wording, not silently
        // reinterpreted as "partial".
        const partialMatch = bodyText.match(locale.compliance.partial);
        const noneMatch = bodyText.match(locale.compliance.none);
        const fullResult = this.findUnnegatedFull(bodyText, locale);
        const fullMatch = fullResult.match;

        if (partialMatch) {
            const searchWord = partialMatch[0];
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText);
            issues.push({
                url: url,
                rule: 'compatible-word-partly',
                category: 'a11y',
                text: `Self-indicates that the website is only partially compliant with the legal requirements`,
                severity: 'error',
            });
        }
        else if (noneMatch) {
            const searchWord = noneMatch[0];
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText);
            issues.push({
                url: url,
                rule: 'compatible-word-not',
                category: 'a11y',
                text: `Self-indicates that website is not compliant with legal requirements`,
                severity: 'error',
            });
        }
        else if (fullMatch) {
            const searchWord = fullMatch[0];
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText);
            // Fully compliant, no issue.
        }
        else if (fullResult.wasNegated) {
            // A "full compliance" phrase was found, but disqualified because a
            // negation/downgrade word sits earlier in the same clause (e.g.
            // "inte helt förenlig", "ikke ... fuldt ud"). Still scored the same
            // as any other missing-statement case (same rule, same severity) -
            // just with a message that tells the site owner what's actually
            // wrong, instead of implying nothing relevant was said at all.
            issues.push({
                url: url,
                rule: 'no-compatible-word',
                category: 'a11y',
                text: `Uses wording close to a compliance statement, but not one of the exact required phrases - state compliance using the required wording instead`,
                severity: 'error',
            });
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

    // A plain substring search for the "full compliance" phrase would also match
    // inside a negated or partial sentence phrased differently than the exact
    // "partial"/"none" patterns (e.g. Swedish "webbplatsen är INTE helt förenlig"),
    // misreading a non-compliant statement as fully compliant. Disqualify any
    // match whose clause (back to the previous sentence boundary) contains one of
    // the locale's downgrade words. Also reports whether such a disqualified
    // candidate existed at all, so callers can give a more specific "near miss"
    // message rather than implying no relevant wording was found.
    findUnnegatedFull(bodyText, locale) {
        const fullRegex = new RegExp(locale.compliance.full.source, locale.compliance.full.flags.includes('g') ? locale.compliance.full.flags : locale.compliance.full.flags + 'g');
        const negationRegex = locale.compliance.negationWords;
        let match;
        let wasNegated = false;
        while ((match = fullRegex.exec(bodyText)) !== null) {
            const clauseStart = Math.max(
                bodyText.lastIndexOf('.', match.index - 1),
                bodyText.lastIndexOf('!', match.index - 1),
                bodyText.lastIndexOf('?', match.index - 1)
            ) + 1;
            const clause = bodyText.substring(clauseStart, match.index);
            if (!negationRegex.test(clause)) {
                return { match, wasNegated: false };
            }
            wasNegated = true;
        }
        return { match: null, wasNegated };
    }

    tryGetWordSentence(word, bodyText) {
        const sentenceMatch = bodyText.match(new RegExp(`[A-ZÅÄÖ.]{0,1}[a-zåäö ]+?${word}[^A-ZÅÄÖ.]*\\.`));
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

    tryGetFullWord(word, bodyText) {
        const sentenceMatch = bodyText.match(new RegExp(`[A-ZÅÄÖ .]{0,1}[a-zåäö]*${word}[a-zåäö]*[^ .]*`));
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

    tryGetUnreasonablyBurdensomeAccommodation(url, bodyText, knowledgeData, locale) {
        let issues = [];
        // Not every locale's "disproportionate burden" wording (EU directive
        // 2016/2102, art. 5) is verified yet - see the TODOs in lib/locales.js.
        // Skip the check rather than guess at unverified legal phrasing.
        if (!locale.unreasonablyBurdensome) {
            return issues;
        }
        const compatTextMatch = bodyText.match(locale.unreasonablyBurdensome);
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0];
            knowledgeData['unreasonably-burdensome-accommodation-word'] = searchWord;
            knowledgeData['unreasonably-burdensome-accommodation-text'] = this.tryGetWordSentence(searchWord, bodyText);
            issues.push({
                url: url,
                rule: 'has-unreasonably-burdensome-accommodation',
                category: 'a11y',
                text: `Claims resolution to be unreasonably burdensome (12 §)`,
                severity: 'error',
            });
        }
        return issues;
    }

    getInterestingTextPrecision(text, locale) {
        for (const pattern of locale.interestingTextPrecision) {
            if (pattern.regex.test(text)) {
                return pattern.precision;
            }
        }

        return 0.1;
    }

    getInterestingUrls(org_url_start, body, locale) {
        const urls = {};
        const anchors = body.querySelectorAll('a[href]');
        for (const anchor of anchors) {
            let href = anchor.getAttribute('href');
            if (!href || href.length == 0) {
                continue;
            }
            // Hoppa över länkar till filer som inte är HTML. Dessa kan matcha
            // regex:en via sitt filnamn (t.ex. "tillganglighetsanalys.docx") och
            // då hamna i kön av intressanta URL:er. När pluginet sedan följer dem
            // får det inget HTML-svar och fyrar av en falsk "no-network"-varning.
            const lowerHref = href.toLowerCase();
            const nonHtmlExtensions = [
                // Dokument
                '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                '.odt', '.ods', '.odp', '.rtf', '.csv', '.txt',
                // Bilder
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff',
                // Media
                '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov', '.flac', '.m4a',
                // Arkiv
                '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
                // Data
                '.json', '.xml', '.rss', '.atom'
            ];
            if (nonHtmlExtensions.some(ext => lowerHref.endsWith(ext))) {
                continue;
            }
            if (href.startsWith('//')) {
                continue;
            }
            if (href.startsWith('/')) {
                href = org_url_start + href;
            }
            if (href.startsWith('#')) {
                continue;
            }
            if (href.startsWith('mailto:')) {
                continue;
            }
            if (href.startsWith('tel:')) {
                continue;
            }
            if (href.startsWith('javascript:')) {
                continue;
            }
            if (href.startsWith('data:')) {
                continue;
            }
            const isTrustedOffDomainHost = (locale.trustedOffDomainHosts || []).some(host => {
                try {
                    return new URL(href).hostname === host;
                } catch {
                    return false;
                }
            });
            if (!href.startsWith(org_url_start) && !isTrustedOffDomainHost) {
                continue
            }

            const text = anchor.textContent.replace(/\u00AD/g, '').trim();
            const match = text.match(locale.interestingLinkText);
            if (!match) {
                continue;
            }
            const precision = this.getInterestingTextPrecision(text, locale);
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

        const analyzedData = this.transform2SimplifiedData(harData, url);
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

    // FIX: Använder nu knowledgeData[0]['url'] istället för knowledgeData['url'] (som var undefined),
    // och bygger upp hela regeluppsättningen (alla regler som "resolved" + no-a11y-statement som "critical")
    // så att plugin-webperf-core kan beräkna en korrekt poäng.
    checkNoAccessibilityStatement(group) {
        if (this.groups[group] === undefined) {
            return;
        }

        if (this.groups[group]['has-a11y-statement']) {
            return;
        }

        if (!this.groups[group]['knowledgeData'] || this.groups[group]['knowledgeData'].length === 0) {
            return;
        }

        const knowledgeData = this.groups[group]['knowledgeData'][0];
        const url = knowledgeData['url'] || this.groups[group]['start-url'];

        // Bygg full regeluppsättning på samma sätt som happy-path gör i createKnowledgeFromData
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

        const allRules = Object.keys(this.rules || {}).filter(rule => this.rules[rule] !== 'off');
        for (const rule of allRules) {
            // Hoppa över regler som redan finns (t.ex. 'no-network' som varning) — skriv inte över dem som resolved
            if (issuesByRule[rule] || (knowledgeData.issues && knowledgeData.issues[rule])) {
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

        knowledgeData.issues = {
            ...knowledgeData.issues,
            ...issuesByRule
        };
    }

    // FIX: Den duplicerade (och felaktiga) issue-koden för 15-URL-gränsen är borttagen.
    // checkNoAccessibilityStatement i sitespeedio.summarize-fasen sköter det nu.
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