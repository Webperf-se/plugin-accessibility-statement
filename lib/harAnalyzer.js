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
    transform2SimplifiedData(harData, url, group) {
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
            'interesting-links': {}
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('htmls' in analyzedData)) {
            return knowledgeData;
        }

        const parsedUrl = new URL(url);
        const org_url_start = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

        for (const entry of analyzedData.htmls) {
            if (!entry.content) {
                continue;
            }

            const dom = new JSDOM(entry.content);
            const doc = dom.window.document;

            const body = doc.querySelector('body');
            if (body) {
                const interesting_links = this.getInterestingUrls(org_url_start, body);
                if (interesting_links) {
                    knowledgeData['interesting-links'] = interesting_links
                }

                const bodyText = this.getMinifiedBodyText(body, knowledgeData);
                this.tryGetCompatibleText(bodyText, knowledgeData);
                this.tryGetNotificationUrl(body, doc, knowledgeData);
                this.tryGetUnreasonablyBurdensomeAccommodation(bodyText, knowledgeData);

                if (this.looks_like_a11y_statement(knowledgeData, body, doc)) {
                    knowledgeData['is_a11y_statement'] = true;
                    // TODO: Check found depth of the a11y statement
                    this.tryGetEvaluationMethod(bodyText, knowledgeData);
                    this.tryGetUpdatedDate(bodyText, knowledgeData);
                }
            }
        }

        return knowledgeData;
    }
    tryGetUpdatedDate(bodyText, knowledgeData) {
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

        regexes.forEach(regex => {
            const matches = bodyText.matchAll(regex); // Use matchAll to get all matches
            for (const match of matches) {
                dates.push(this.getWeightedDocDateFromMatch(match, bodyText)); // Push the named groups into the dates array
            }
        });
        knowledgeData['dates'] = dates;
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
    tryGetEvaluationMethod(bodyText, knowledgeData) {
        const evaluation_method = bodyText.match(/(sj(.{1, 6}|ä|&auml;|&#228;)lvskattning|intern[a]{0,1} kontroller|intern[a]{0,1} test(ning|er){0,1}]|utvärderingsmetod|tillgänglighetsexpert(er){0,1}|funka|etu ab|siteimprove|oberoende granskning|oberoende tillgänglighetsgranskning(ar){0,1}|tillgänglighetskonsult(er){0,1}|med hjälp av|egna tester|oberoende experter|Hur vi testat webbplats(en){0,1}|vi testat webbplatsen|intervjuer|rutiner|checklistor|checklista|utbildningar|automatiserade|automatisk|maskinell|kontrollverktyg|tillgänglighetskontroll)/gim);
        if (evaluation_method) {
            const searchWord = evaluation_method[0]; // The matched word
            knowledgeData['evaluation_method-word'] = searchWord.trim();
            knowledgeData['evaluation_method-text'] = this.tryGetWordSentence(searchWord, bodyText);
        }
    }

    looks_like_a11y_statement(knowledgeData, body, doc) {
        if (knowledgeData['compatible-word'] || knowledgeData['notification-function-link-url'] || knowledgeData['unreasonably-burdensome-accommodation-word']) {
            let h1 = body.querySelector('h1');
            if (h1) {
                knowledgeData['h1'] = h1.textContent.trim();
                const is_a11y_statement_h1 = /tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/gim.test(knowledgeData['h1']);
                if (is_a11y_statement_h1) {
                    return true;
                }
            }
            let title = doc.querySelector('title');
            if (title) {
                knowledgeData['page-title'] = title.textContent.trim();
                const is_a11y_statement_title = /tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/gim.test(knowledgeData['page-title']);
                if (is_a11y_statement_title) {
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
        const tagsToRemove = ['script', 'nav', 'form', 'a'];
        // Iterate through each tag and remove all instances of it
        tagsToRemove.forEach(tag => {
            const elements = minifiedBody.querySelectorAll(tag);
            elements.forEach(element => element.remove());
        });

        // Get mimized text content
        const bodyText = minifiedBody.textContent
            .replace(/\n/g, ' ')
            .replace(/\t/g, ' ')
            .replace(/ {2,}/g, ' ').trim();
        knowledgeData['body-text'] = bodyText;
        return bodyText;
    }

    tryGetNotificationUrl(body, doc, knowledgeData) {
        // Meddelandefunktion eller länk till sådan.
        // Länk till DIGG:s anmälningsfunktion (https://www.digg.se/tdosanmalan).
        body.querySelectorAll('a').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (href && href.length > 0) {
                if (href === this.DIGG_URL) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else if (href === this.DIGG_CANONICAL_URL) {
                    knowledgeData['notification-function-link-text'] = anchor.textContent.trim();
                    knowledgeData['notification-function-link-url'] = href;
                }
                else {
                    const digg_old_url = /digg\.se[a-z\/\-]+anmal\-bristande\-tillganglighet/i.test(href);
                    if (digg_old_url) {
                        knowledgeData['notification-function-link-text'] = anchor.textContent.trim();
                        knowledgeData['notification-function-link-url'] = href;
                    }
                }

                let isDigg = false;

                // Check if any canonical link contains 'digg.se'
                doc.querySelectorAll('link[rel*=canonical]').forEach(link => {
                    if (link.href.includes('digg.se')) {
                        isDigg = true;
                    }
                });

                if (isDigg) {
                    // Fix for relative links on digg.se
                    const matchCanonicalUrl = doc.querySelector('main').querySelector(
                        `a[href="${canonical.replace('https://www.digg.se', '')}"]`
                    );
                    if (matchCanonicalUrl) {
                        knowledgeData['notification-function-link-text'] = matchCanonicalUrl.textContent.trim();
                        knowledgeData['notification-function-link-url'] = matchCanonicalUrl.href;
                    }
                }
            }
        });
    }

    tryGetCompatibleText(bodyText, knowledgeData) {
        // Följsamhet till lagkraven med formuleringen:
        // helt förenlig,
        // delvis förenlig eller
        // inte förenlig.

        const compatTextMatch = bodyText.match(/(?<test>helt|delvis|inte) förenlig/i);
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0]; // The matched word
            knowledgeData['compatible-word'] = searchWord;
            knowledgeData['compatible-text'] = this.tryGetWordSentence(searchWord, bodyText);
        }
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
        const sentenceMatch = bodyText.match(new RegExp(`[ .]{0,1}[a-zåäö]*${word}[a-zåäö]*[^ .]*`));
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
    tryGetUnreasonablyBurdensomeAccommodation(bodyText, knowledgeData) {
        // Redogörelse av innehåll som undantagits på grund av
        // oskäligt betungande anpassning (12 §) med tydlig motivering.
        let compatTextMatch = bodyText.match(/(?<test>12[ \t\r\n]§ lagen)/gim);
        if (!compatTextMatch) {
            compatTextMatch = bodyText.match(/(?<test>Oskäligt betungande anpassning)/gim);
        }
        if (compatTextMatch) {
            const searchWord = compatTextMatch[0]; // The matched word
            knowledgeData['unreasonably-burdensome-accommodation-word'] = searchWord;
            knowledgeData['unreasonably-burdensome-accommodation-text'] = this.tryGetWordSentence(searchWord, bodyText);
        }
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

            const text = anchor.textContent.trim();
            const match = text.match(/(om [a-z]+|(tillg(.{1,6}|ä|&auml;|&#228;)nglighet(sredog(.{1,6}|ö|&ouml;|&#246;)relse){0,1}))/gim);
            if (!match) {
                continue;
            }
            const precision = this.getInterestingTextPrecision(text);
            if (precision > 0.1) {
                urls[href] = precision;
            }

        }

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
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }

    getSummary() {
        return this;
    }
}