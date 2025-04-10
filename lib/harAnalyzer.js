import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class HarAnalyzer {
    constructor() {
        this.groups = {};
        this.DIGG_URL = 'https://www.digg.se/tdosanmalan'
        this.DIGG_CANONICAL_URL = 'https://www.digg.se/analys-och-uppfoljning/lagen-om-tillganglighet-till-digital-offentlig-service-dos-lagen/anmal-bristande-tillganglighet'

        const libFolder = fileURLToPath(new URL('..', import.meta.url));
        this.pluginFolder = path.resolve(libFolder, '..');
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
    transform2SimplifiedData(harData, url) {
        const data = {
            'url': url,
            'htmls': []
        };

        if ('log' in harData) {
            harData = harData['log'];
        }

        let reqIndex = 1;

        for (const entry of harData.entries) {
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
            'issues': [],
            'resolved-rules': [],
            'interesting-urls': {}
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('htmls' in analyzedData)) {
            return knowledgeData;
        }

        if (analyzedData['htmls'].length === 0) {
            knowledgeData['issues'] = {
                'no-network': {
                    'rule': 'no-network',
                    'category': 'technical',
                    'severity': 'warning',
                    'subIssues': [
                        {
                            'url': url,
                            'rule': 'no-network',
                            'category': 'standard',
                            'severity': 'warning',
                            'text': `No HTML content found in the HAR file.`,
                            'line': 0,
                            'column': 0
                        }
                    ]
                }
            };
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

            const body = doc.querySelector('body');
            if (body) {
                const interesting_links = this.getInterestingUrls(org_url_start, body);
                if (interesting_links) {
                    knowledgeData['interesting-urls'] = interesting_links
                    this.groups[group]['interesting-urls'] = { 
                        ...this.groups[group]['interesting-urls'], 
                        ...knowledgeData['interesting-urls'] 
                    };
                    this.groups[group]['interesting-urls'] = this.sortInterestingUrls(this.groups[group]['interesting-urls']);
                }

                let issues_if_a11y_statement = []
                const bodyText = this.getMinifiedBodyText(body, knowledgeData);
                issues_if_a11y_statement.push(...this.tryGetCompatibleText(entryUrl, bodyText, knowledgeData));
                issues_if_a11y_statement.push(...this.tryGetNotificationUrl(entryUrl, body, doc, knowledgeData));
                issues_if_a11y_statement.push(...this.tryGetUnreasonablyBurdensomeAccommodation(entryUrl, bodyText, knowledgeData));

                if (this.looks_like_a11y_statement(knowledgeData, body, doc)) {
                    knowledgeData['is-a11y-statement'] = true;
                    this.groups[group]['has-a11y-statement'] = true;
                    // TODO: Check found depth of the a11y statement
                    issues_if_a11y_statement.push(...this.tryGetEvaluationMethod(entryUrl, bodyText, knowledgeData));
                    issues_if_a11y_statement.push(...this.tryGetUpdatedDate(entryUrl, bodyText, knowledgeData));
                    knowledgeData['issues'].push(...issues_if_a11y_statement);
                }
            }
        }

        return knowledgeData;
    }
    tryGetUpdatedDate(url, bodyText, knowledgeData) {
        const regexes = [
            /(?<typ>bedömning|redogörelse|uppdater|gransk)(?<text>[^>.]*) (?<day>[0-9]{1,2} )(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})/gi,
            / (?<day>[0-9]{1,2} )(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>bedömning|redogörelse|uppdater|gransk)/gi,
            /(?<typ>bedömning|redogörelse|uppdater|gransk)(?<text>[^>.]*) (?<day>)(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})/gi,
            / (?<day>)(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>bedömning|redogörelse|uppdater|gransk)/gi,
            /(?<typ>bedömning|redogörelse|uppdater|gransk)(?<text>[^>.]*) (?<year>20[0-9]{2}-)(?<month>[0-9]{2}-)(?<day>[0-9]{2})/gi,
            / (?<year>20[0-9]{2}-)(?<month>[0-9]{2}-)(?<day>[0-9]{2})(?<text>[^>.]*)(?<typ>bedömning|redogörelse|uppdater|gransk)/gi,
            /(?<typ>bedömning|redogörelse|uppdater|gransk)(?<text>[^>.]*) (?<day>[0-9]{1,2} )*(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})/gi,
            / (?<day>[0-9]{1,2} )*(?<month>(?:jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*) )(?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>bedömning|redogörelse|uppdater|gransk)/gi
        ];

        const dates = [];
        let issues = [];

        regexes.forEach(regex => {
            const matches = bodyText.matchAll(regex); // Use matchAll to get all matches
            for (const match of matches) {
                dates.push(this.getWeightedDocDateFromMatch(match, bodyText)); // Push the named groups into the dates array
            }
        });

        // Eliminate duplicates by comparing all properties
        const uniqueDates = dates.filter((date, index, self) =>
            index === self.findIndex(d =>
                d.word === date.word &&
                d.text === date.text &&
                d.type === date.type &&
                d.date[0] === date.date[0] && // Compare year
                d.date[1] === date.date[1] && // Compare month
                d.date[2] === date.date[2] && // Compare day
                d.weight === date.weight
            )
        );

        // Sort dates by weight in descending order
        uniqueDates.sort((a, b) => b.weight - a.weight);

        if (uniqueDates.length === 0) {
            issues.push({
                url: url,
                rule: 'no-updated-date',
                category: 'a11y',
                text: `Unable to find when the accessibility statement was updated`,
                severity: 'error',
            });
        }else {
            const dateInfo = uniqueDates.pop().date;
            const dateDoc = new Date(dateInfo[0], dateInfo[1] - 1, dateInfo[2]); // Month is 0-indexed in JavaScript
            
            const year = 365 * 24 * 60 * 60 * 1000; // Convert year to milliseconds
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

    getWeightedDocDateFromMatch(match, bodyText) {
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
            month = this.convertToMonthNumber(month);
        }

        if (day && day !== '') {
            day = parseInt(day.trim().replace(/-$/, ''), 10);
        } else {
            day = 1;
            weight = 0.1;
        }

        const tmpWeight = this.getDateWeight(remark);
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
    convertToMonthNumber(month) {
        const monthDict = {
            'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
            'maj': 5, 'jun': 6, 'jul': 7, 'aug': 8,
            'sep': 9, 'okt': 10, 'nov': 11, 'dec': 12
        };

        for (const [shortMonthName, monthNumber] of Object.entries(monthDict)) {
            if (month.toLowerCase().startsWith(shortMonthName)) {
                return monthNumber;
            }
        }
        return parseInt(month, 10);
    }
    getDateWeight(text) {
        const patterns = [
            { regex: /bedömning/i, weight: 1.0 },
            { regex: /redogörelse/i, weight: 0.9 },
            { regex: /gransk/i, weight: 0.7 },
            { regex: /uppdater/i, weight: 0.5 }
        ];

        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                return pattern.weight;
            }
        }

        return null;
    }
    tryGetEvaluationMethod(url, bodyText, knowledgeData) {
        let issues = [];
        const evaluationMethod = bodyText.match(/(sj(.{1, 6}|ä|&auml;|&#228;)lvskattning|intern[a]{0,1} kontroller|intern[a]{0,1} test(ning|er){0,1}]|utvärderingsmetod|tillgänglighetsexpert(er){0,1}|funka|etu ab|siteimprove|oberoende granskning|oberoende tillgänglighetsgranskning(ar){0,1}|tillgänglighetskonsult(er){0,1}|med hjälp av|egna tester|oberoende experter|Hur vi testat webbplats(en){0,1}|vi testat webbplatsen|intervjuer|rutiner|checklistor|checklista|utbildningar|automatiserade|automatisk|maskinell|kontrollverktyg|tillgänglighetskontroll)/gim);
        if (evaluationMethod) {
            const searchWord = evaluationMethod[0]; // The matched word
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

    looks_like_a11y_statement(knowledgeData, body, doc) {
        if (knowledgeData['compatible-word'] || knowledgeData['notification-function-link-url'] || knowledgeData['unreasonably-burdensome-accommodation-word']) {
            let h1 = body.querySelector('h1');
            if (h1) {
                knowledgeData['h1'] = h1.textContent.replace(/\u00AD/g, '').trim();
                const isA11yStatementH1 = /tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/gim.test(knowledgeData['h1']);
                if (isA11yStatementH1) {
                    return true;
                }
            }
            let title = doc.querySelector('title');
            if (title) {
                knowledgeData['page-title'] = title.textContent.replace(/\u00AD/g, '').trim();
                const isA11yStatementTitle = /tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/gim.test(knowledgeData['page-title']);
                if (isA11yStatementTitle) {
                    return true;
                }
            }
            // TODO: Check link precision level for this page (if it is 0.5 or more return true)
        }
        return false;
    }

    getMinifiedBodyText(body, knowledgeData) {
        const minifiedBody = body.cloneNode(true); // Deep clone the body, including all child nodes

        // Specify the tags you want to remove
        const tagsToRemove = ['script', 'nav', 'form', 'input', 'button', 'a'];
        // Iterate through each tag and remove all instances of it
        tagsToRemove.forEach(tag => {
            const elements = minifiedBody.querySelectorAll(tag);
            elements.forEach(element => element.remove());
        });

        // Get mimized text content
        const bodyText = minifiedBody.textContent
            .replace(/\u00AD/g, '')
            .replace(/\n/g, ' ')
            .replace(/\t/g, ' ')
            .replace(/ {2,}/g, ' ').trim();
        knowledgeData['body-text'] = bodyText;
        return bodyText;
    }

    tryGetNotificationUrl(url, body, doc, knowledgeData) {
        // Meddelandefunktion eller länk till sådan.
        // Länk till DIGG:s anmälningsfunktion (https://www.digg.se/tdosanmalan).
        let issues = [];
        body.querySelectorAll('a').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (href && href.length > 0) {
                if (href === this.DIGG_URL) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else if (href === this.DIGG_CANONICAL_URL) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.replace(/\u00AD/g, '').trim();
                    knowledgeData['notification-function-link-url'] = href;
                    issues.push({
                        url: url,
                        rule: 'has-canonical-notification-function-link',
                        category: 'a11y',
                        text: `Correct link (canonical) to DIGG's report function`,
                        severity: 'info',
                            data: {
                                text: anchor.textContent.replace(/\u00AD/g, '').trim(),
                                url: href
                            }
                    });
                }
                else {
                    const digg_old_url = /digg\.se[a-z/-]+anmal-bristande-tillganglighet/i.test(href);
                    if (digg_old_url) {
                        knowledgeData['notification-function-link-text'] = anchor.replace(/\u00AD/g, '').textContent.trim();
                        knowledgeData['notification-function-link-url'] = href;
                        issues.push({
                            url: url,
                            rule: 'has-old-notification-function-link',
                            category: 'a11y',
                            text: `Uses old or incorrect link to DIGG's report function`,
                            severity: 'warning',
                            data: {
                                text: anchor.replace(/\u00AD/g, '').textContent.trim(),
                                url: href
                            }
                        });
                    }
                }
            }
        });

        if (!knowledgeData['notification-function-link-url']) {
            issues.push({
                url: url,
                rule: 'no-notification-function-link',
                category: 'a11y',
                text: `Missing or has an incorrect link to DIGG's report function`,
                severity: 'error',
            });
        }
        return issues;
    }

    tryGetCompatibleText(url, bodyText, knowledgeData) {
        // Följsamhet till lagkraven med formuleringen:
        // helt förenlig,
        // delvis förenlig eller
        // inte förenlig.
        let issues = [];

        const compatTextMatch = bodyText.match(/(?<test>helt|delvis|inte) förenlig/i);
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0]; // The matched word
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText);

            if (knowledgeData['compatible-word'].indexOf('inte') !== -1) {
                issues.push({
                    url: url,
                    rule: 'compatible-word-not',
                    category: 'a11y',
                    text: `Self-indicates that website is not compliant with legal requirements`,
                    severity: 'error',
                });
            }
            else if (knowledgeData['compatible-word'].indexOf('delvis') !== -1) {
                issues.push({
                    url: url,
                    rule: 'compatible-word-partly',
                    category: 'a11y',
                    text: `Self-indicates that the website is only partially compliant with the legal requirements`,
                    severity: 'error',
                });
            }
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
    tryGetWordSentence(word, bodyText) {
        // Match the whole sentence containing the word
        const sentenceMatch = bodyText.match(new RegExp(`[A-ZÅÄÖ.]{0,1}[a-zåäö ]+?${word}[^A-ZÅÄÖ.]*\\.`));
        if (sentenceMatch) {
            let compatibleText = sentenceMatch[0].trim(); // Extract the sentence
            if (compatibleText.length > 200) {
                const searchWordIndex = compatibleText.indexOf(word);
                const start = Math.max(0, searchWordIndex - 100); // Ensure the search word is centered
                const end = Math.min(compatibleText.length, searchWordIndex + 100 + word.length);
                compatibleText = compatibleText.substring(start, end).trim();

                // Add ellipses if text was trimmed
                if (start > 0) compatibleText = '...' + compatibleText;
                if (end < compatibleText.length) compatibleText += '...';
            }

            return compatibleText;
        }
        return word;
    }
    tryGetFullWord(word, bodyText) {
        // Match the whole sentence containing the word
        const sentenceMatch = bodyText.match(new RegExp(`[A-ZÅÄÖ .]{0,1}[a-zåäö]*${word}[a-zåäö]*[^ .]*`));
        if (sentenceMatch) {
            let compatibleText = sentenceMatch[0].trim(); // Extract the sentence
            if (compatibleText.length > 20) {
                const searchWordIndex = compatibleText.indexOf(word);
                const start = Math.max(0, searchWordIndex - 10); // Ensure the search word is centered
                const end = Math.min(compatibleText.length, searchWordIndex + 10 + word.length);
                compatibleText = compatibleText.substring(start, end).trim();
            }

            return compatibleText;
        }
        return word;
    }
    tryGetUnreasonablyBurdensomeAccommodation(url, bodyText, knowledgeData) {
        // Redogörelse av innehåll som undantagits på grund av
        // oskäligt betungande anpassning (12 §) med tydlig motivering.
        let issues = [];
        let compatTextMatch = bodyText.match(/(?<test>12[ \t\r\n]§ lagen)/gim);
        if (!compatTextMatch) {
            compatTextMatch = bodyText.match(/(?<test>Oskäligt betungande anpassning)/gim);
        }
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0]; // The matched word
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
    getInterestingTextPrecision(text) {
        const patterns = [
            {
                regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse$/i,
                precision: 0.55
            },
            {
                regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/i,
                precision: 0.5
            },
            {
                regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighet$/i,
                precision: 0.4
            },
            {
                regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighet/i,
                precision: 0.35
            },
            {
                regex: /tillg(.{1,6}|ä|&auml;|&#228;)nglighet/i,
                precision: 0.3
            },
            {
                regex: /om webbplats/i,
                precision: 0.29
            },
            {
                regex: /^[ \t\r\n]*om [a-z]+$/i,
                precision: 0.25
            },
            {
                regex: /^[ \t\r\n]*om [a-z]+/i,
                precision: 0.2
            }
        ];

        for (const pattern of patterns) {
            if (pattern.regex.test(text)) {
                return pattern.precision;
            }
        }

        return 0.1;
    }
    getInterestingUrls(org_url_start, body) {
        const urls = {};
        const anchors = body.querySelectorAll('a[href]');
        for (const anchor of anchors) {
            let href = anchor.getAttribute('href');
            if (!href || href.length == 0) {
                continue;
            }
            if (href.endsWith('.pdf')) {
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
            if (!href.startsWith(org_url_start)) {
                continue
            }

            const text = anchor.textContent.replace(/\u00AD/g, '').trim();
            const match = text.match(/(om [a-z]+|(tillg(.{1,6}|ä|&auml;|&#228;)nglighet(sredog(.{1,6}|ö|&ouml;|&#246;)relse){0,1}))/gim);
            if (!match) {
                continue;
            }
            const precision = this.getInterestingTextPrecision(text);
            if (precision > 0.1) {
                urls[href] = precision;
            }

        }

        return this.sortInterestingUrls(urls);
    }

    sortInterestingUrls(urls) {
        // Sort URLs by precision in descending order
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
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }
    checkNoAccessibilityStatement(group) {
        if (this.groups[group] === undefined) {
            return;
        }

        if (this.groups[group]['has-a11y-statement']) {
            return;
        }

        if (this.groups[group]['knowledgeData'].length === 0) {
            return;
        }

        this.groups[group]['knowledgeData'][0]['issues'].push({
            url: this.groups[group]['knowledgeData']['url'],
            rule: 'no-a11y-statement',
            category: 'a11y',
            text: `Unable to find accessibility statement`,
            severity: 'critical',
        });
    }
    getNextInterestingUrl(group) {
        if (this.groups[group] === undefined) {
            return undefined;
        }

        if (!('interesting-urls' in this.groups[group])) {
            return undefined;
        }        

        if (!('visited-urls' in this.groups[group])) {
            this.groups[group]['visited-urls'] = new Set(); // Initialize visited URLs if not present
        }

        if (this.groups[group]['has-a11y-statement']) {
            return undefined; // No more URLs to visit if an a11y statement is found
        }

        // Do not return a URL if more than 15 URLs have been visited
        const visitedUrls = this.groups[group]['visited-urls'];
        if (visitedUrls.size >= 15) {
            if (this.groups[group]['knowledgeData'].length === 0) {
                return undefined;
            }
    
            this.groups[group]['knowledgeData'][0]['issues'].push({
                url: this.groups[group]['knowledgeData']['url'],
                rule: 'no-a11y-statement',
                category: 'a11y',
                text: `Unable to find accessibility statement`,
                severity: 'critical',
            });

            return undefined;
        }
    
        const interestingUrls = this.groups[group]['interesting-urls'];
        for (const url of Object.keys(interestingUrls)) {
            if (!visitedUrls.has(url)) {
                visitedUrls.add(url); // Mark the URL as visited
                delete interestingUrls[url]; // Remove the URL from the dictionary
                return url; // Return the first unvisited URL
            }
        }

        return undefined; // Return the first URL or undefined if none exist
    }
    getSummary() {
        return this;
    }
}