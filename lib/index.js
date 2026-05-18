import { SitespeedioPlugin } from '@sitespeed.io/plugin';
import { HarAnalyzer } from './harAnalyzer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const fsp = fs.promises;

const pluginname = 'webperf-plugin-accessibility-statement';

export default class AccessibilityStatementPlugin extends SitespeedioPlugin {
  constructor(options, context, queue) {
    super({ name: pluginname, options, context, queue });
  }

  async open(context, options) {
    this.make = context.messageMaker(pluginname).make;
    this.harAnalyzer = new HarAnalyzer();
    this.isWebperfCorePluginPresent = false;
    const libFolder = fileURLToPath(new URL('..', import.meta.url));
    this.pluginFolder = path.resolve(libFolder);
    this.options = options;
    this.log = context.log;

    this.pug = await fsp.readFile(
      path.resolve(this.pluginFolder, 'pug', 'index.pug'),
      'utf8'
    );
  }

  async processMessage(message, queue) {
    switch (message.type) {
      case 'browsertime.setup': {
        queue.postMessage(this.make('browsertime.config', {
          "chrome": {
            "includeResponseBodies": "all",
          },
          "firefox": {
            "includeResponseBodies": "all"
          }
        }));
        break;
      }
      case 'sitespeedio.setup': {
        queue.postMessage(this.make(pluginname + '.setup', {
          'version': this.version,
          'dependencies': this.dependencies
        }));
        queue.postMessage(
          this.make('html.pug', {
            id: pluginname,
            name: 'A11y statement',
            pug: this.pug,
            type: 'pageSummary'
          })
        );
        queue.postMessage(
          this.make('html.pug', {
            id: pluginname,
            name: 'A11y statement',
            pug: this.pug,
            type: 'run'
          })
        );
        break;
      }
      case 'plugin-webperf-core.setup': {
        this.isWebperfCorePluginPresent = true;
        break;
      }
      case 'url': {
        const url = message.url;
        const uuid = message.uuid;
        const group = message.group;
        if (message.source !== pluginname) {
          this.harAnalyzer.trySetStartUrl(url, uuid, group);
        }
        break;
      }
      case 'browsertime.har': {
        const url = message.url;
        const group = message.group;
        const harData = message.data;
        var data = await this.harAnalyzer.analyzeData(url, harData, group);

        if (this.isWebperfCorePluginPresent) {
          super.sendMessage(
            pluginname + '.webPerfCoreSummary',
            data,
            {
              url,
              group
            }
          );
        } else {
          super.sendMessage(
            pluginname + '.pageSummary',
            data,
            {
              url,
              group
            }
          );
        }

        const interestingUrl = this.harAnalyzer.getNextInterestingUrl(group);
        if (!interestingUrl) {
          break;
        }
        queue.postMessage(this.make('url', {}, { url: interestingUrl, group: message.group }));
        break;
      }
      case 'sitespeedio.summarize': {
        const summary = this.harAnalyzer.getSummary();
        for (let group of Object.keys(summary.groups)) {
          this.harAnalyzer.checkNoAccessibilityStatement(group);

          // FIX: När ingen tillgänglighetsredogörelse hittats har checkNoAccessibilityStatement just
          // lagt till "no-a11y-statement" + alla resolved-regler på knowledgeData[0]. Per-sida-meddelandet
          // (webPerfCoreSummary) skickades redan när browsertime.har bearbetades, så plugin-webperf-core
          // har inte sett dessa issues. Vi publicerar nu om sidan så att plugin-webperf-core kan räkna
          // ut en korrekt poäng och rapportera issuet.
          if (this.isWebperfCorePluginPresent && !summary.groups[group]['has-a11y-statement']) {
            const knowledgeDataArr = summary.groups[group]['knowledgeData'];
            const analyzedDataArr = summary.groups[group]['analyzedData'];
            if (knowledgeDataArr && knowledgeDataArr.length > 0) {
              const firstKnowledge = knowledgeDataArr[0];
              const firstAnalyzed = analyzedDataArr && analyzedDataArr.length > 0
                ? analyzedDataArr[0]
                : undefined;
              super.sendMessage(
                pluginname + '.webPerfCoreSummary',
                {
                  version: this.harAnalyzer.version,
                  dependencies: this.harAnalyzer.dependencies,
                  url: firstKnowledge['url'],
                  analyzedData: firstAnalyzed,
                  knowledgeData: firstKnowledge
                },
                {
                  url: firstKnowledge['url'],
                  group
                }
              );
            }
          }

          super.sendMessage(pluginname + '.summary', summary.groups[group], {
            group
          });

          if (this.options.allystatement && this.options.allystatement.terminal && this.options.allystatement.terminal.showresults) {
            this.log.info('accessibility-statement', group, JSON.stringify(summary.groups[group], false, '   '));
          }
        }
        break;
      }
    }
  }
}