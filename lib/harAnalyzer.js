import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import securityConfig from '../configurations/security.mjs';
import standardConfig from '../configurations/standard.mjs';

export class HarAnalyzer {
    constructor() {
        this.groups = {};

        // Create a shared ESLint instance
        this.eslintSecurity = new ESLint({
            overrideConfigFile: true,
            overrideConfig: securityConfig
        });
        this.eslintStandard = new ESLint({
            overrideConfigFile: true,
            overrideConfig: standardConfig
        });

        const libFolder = fileURLToPath(new URL('..', import.meta.url));
        this.pluginFolder = path.resolve(libFolder, '..');
    }
    transform2SimplifiedData(harData, url, group) {
        const data = {
            'url': url,
            'security-rules': this.configSecurity,
            'standard-rules': this.configStandard,
            'htmls': [],
            'all-scripts': [],
            'script-elements': [],
            'script-attributes': [],
            'script-files': []
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
            else if (res.content.mimeType.includes('javascript')) {
                data['all-scripts'].push(obj);
                data['script-files'].push(obj);
            }

            reqIndex++;
        }

        // Extract <script> elements from HTML content
        for (const htmlObj of data.htmls) {
            const dom = new JSDOM(htmlObj.content);
            const styleElements = dom.window.document.querySelectorAll('script');
            styleElements.forEach((styleElement, index) => {
                const styleElementObj = {
                    'url': htmlObj.url,
                    'content': styleElement.textContent,
                    'index': htmlObj.index
                };

                // Only include if content is not empty
                if (styleElementObj.content && styleElementObj.content.trim() !== '') {
                    data['all-scripts'].push(styleElementObj);
                    data['script-elements'].push(styleElementObj);
                }
            });

            // Extract style="" attributes from HTML content
            // const elementsWithStyleAttr = dom.window.document.querySelectorAll('[style]');
            // elementsWithStyleAttr.forEach((element, index) => {
            //     const styleAttrContent = element.getAttribute('style');
            //     const styleAttrObj = {
            //         'url': htmlObj.url,
            //         // Wrap the style attribute content in a dummy #id rule
            //         'content': `#dummy-style-attribute-id { ${styleAttrContent} }`,
            //         'index': htmlObj.index
            //     };
            //     data['all-styles'].push(styleAttrObj);
            //     data['style-attributes'].push(styleAttrObj);
            // });
        }

        return data;
    }

    async createKnowledgeFromData(analyzedData, url, group) {
        let knowledgeData = {
            'url': url,
            'group': group,
            'issues': [],
            'resolved-rules': []
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('all-scripts' in analyzedData)) {
            return knowledgeData;
        }

        try {
            // Lint with both security and standard configurations
            const lintPromises = analyzedData['all-scripts'].flatMap(entry => [
                this.eslintSecurity.lintText(entry.content).then(results => {
                    return results.flatMap(result =>
                        result.messages
                            .filter(message => message.ruleId !== null) // Ignore messages with null ruleId
                            .map(message => ({
                                url: entry.url,
                                rule: message.ruleId,
                                category: 'security',
                                severity: message.severity === 1 ? "warning" : message.severity === 2 ? "error" : message.severity,
                                text: message.message,
                                line: message.line,
                                column: message.column
                            }))
                    );
                }),
                this.eslintStandard.lintText(entry.content).then(results => {
                    return results.flatMap(result =>
                        result.messages
                            .filter(message => message.ruleId !== null) // Ignore messages with null ruleId
                            .map(message => ({
                                url: entry.url,
                                rule: message.ruleId,
                                category: 'standard',
                                severity: message.severity === 1 ? "warning" : message.severity === 2 ? "error" : message.severity,
                                text: message.message,
                                line: message.line,
                                column: message.column
                            }))
                    );
                })
            ]);

            // Wait for all linting promises to resolve and flatten the results
            const lintResults = await Promise.all(lintPromises);
            knowledgeData.issues = lintResults.flat();

            // Populate "resolved-rules" with rules not mentioned in "issues"
            // const allRules = [
            //     ...Object.keys(this.configSecurity[0].rules),
            //     ...Object.keys(this.configStandard[0].rules)
            // ];
            // const mentionedRules = new Set(knowledgeData.issues.map(issue => issue.rule));
            // knowledgeData['resolved-rules'] = allRules.filter(rule => !mentionedRules.has(rule));
        } catch (err) {
            // console.error('Error during linting:', err);
        }

        return knowledgeData;
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