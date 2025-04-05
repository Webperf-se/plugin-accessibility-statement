import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class HarAnalyzer {
    constructor() {
        this.groups = {};

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
            }
        }
        
        return knowledgeData;
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