# plugin-accessibility-statement
Accessibility statement plugin for sitespeed.io

## Overview

The `plugin-accessibility-statement` is a plugin for [sitespeed.io](https://www.sitespeed.io/) that helps identify and log accessibility statement errors during web testing. It integrates with sitespeed.io to provide detailed information about accessibility statement errors.

## Features


## Installation

To install the plugin, run the following command:

```sh
npm install plugin-accessibility-statement
```

## Usage

To use the plugin with sitespeed.io, add it to your sitespeed.io configuration file or command line options.

### Configuration

Add the plugin to your sitespeed.io configuration file:

```json
{
  "plugins": {
    "plugin-accessibility-statement": {
      "enabled": true
    }
  }
}
```

### Command Line

You can also enable the plugin via the command line:

```sh
sitespeed.io --plugins.add plugin-accessibility-statement
```

## Example

Here is an example of how to use the plugin with sitespeed.io:

```sh
sitespeed.io https://www.example.com --plugins.add plugin-accessibility-statement
```

## Country rules

The EU Web Accessibility Directive (2016/2102) requires a statement from public sector bodies, but each country decides its name, wording, where it is published and who handles complaints. The plugin therefore reads one rule file per country from `lib/countries/<cc>.json`.

| Country | Where the statement lives | Enforcement body the statement must point to |
| --- | --- | --- |
| Sweden (`se`) | Own site, "Tillgänglighetsredogörelse" | DIGG, digg.se/tdosanmalan |
| Denmark (`dk`) | was.digst.dk, linked from the own site | Digitaliseringsstyrelsen / Digitaliseringsministeriet (e-mail) |
| Norway (`no`) | uustatus.no, linked from the own site (sometimes via an own page) | Diskrimineringsnemnda |
| Finland (`fi`) | Own site, "Saavutettavuusseloste" / "Tillgänglighetsutlåtande" | Traficom (Etelä-Suomen AVI counts as outdated) |
| Germany (`de`) | Own site, "Erklärung zur Barrierefreiheit" | Schlichtungsstelle BGG, BFIT-Bund or the Land body |
| France (`fr`) | Own site, "Déclaration d'accessibilité" | Défenseur des droits |
| Spain (`es`) | Own site, "Declaración de accesibilidad" | The body's own sede electrónica |
| Italy (`it`) | Only on form.agid.gov.it, linked from the own site | Difensore civico per il digitale (AgID) |
| Iceland (`is`) | Pending: law 20/2026 applies to websites from 2027 | Not yet designated |

For Italy the AgID page is a JavaScript app with no content in its HTML, so a link from the site to form.agid.gov.it counts as the statement and the content rules are reported as resolved. For Denmark and Norway the plugin follows the link to the central platform and rates the statement there.

### How the country is chosen

1. The option `--allystatement.country <cc>`, for example `--allystatement.country dk`.
2. The top-level domain of the tested URL (`.se`, `.dk`, `.no`, `.fi`, `.de`, `.fr`, `.es`, `.it`, `.is`).
3. The primary subtag of `<html lang>` on the start page (`sv-SE` gives `sv`, which gives Sweden).

The domain wins over the language because the law follows the country, not the language: a Finnish municipality publishing in Swedish on a `.fi` domain follows Finnish rules.

When no country is found, or its rules are pending (Iceland), the plugin reports `no-country-rules` with severity `info` and does not report `no-a11y-statement`. The site is not failed for a statement the plugin cannot recognise.

```sh
sitespeed.io https://www.example.com --plugins.add plugin-accessibility-statement --allystatement.country fr
```

### Adding a country

Copy a file in `lib/countries/` that is close in structure (`fr.json` for a statement on the own site, `dk.json` for a central platform) and name it after the country code. The fields:

- `code`, `name`, `status` (`supported` or `pending`), `tlds`, `languages`.
- `statement.strict` (the legal name of the statement, matched in `<h1>` and `<title>`), `statement.loose` (the root word, accepted together with a compliance phrase, enforcement link or burden claim), `statement.linkText` (extra link texts with a precision), `statement.externalHosts`, `statement.externalOnly` and `statement.centralUrl` (a statement URL on a central platform derived from the hostname, `{host}` being the hostname with dots as dashes, queued even when the site has no link to it).
- `compliance.full`, `compliance.partial`, `compliance.none`: the literal phrases the regulator accepts for the self-declared compliance level. A partial or none phrase anywhere wins. `compliance.negation`: words that, earlier in the same clause, disqualify a full phrase ("inte är helt förenlig"); such a near miss gives `no-compatible-word` with its own message.
- `burden` and `burdenReference`: the disproportionate burden claim and the legal reference shown in the issue text.
- `evaluation`: words that describe how the site was evaluated.
- `dates.months`, `dates.triggers` (words next to the date, with a weight; the date with the highest weight is rated, and on equal weight the most recent one) and `dates.formats` (see `DATE_FORMATS` in `lib/countries.js`).
- `enforcement.canonical`, `enforcement.old` and `enforcement.accepted` (link patterns), `enforcement.text` and `enforcement.oldText` (patterns for e-mail addresses written in the text), and `enforcement.label` for issue texts.

All patterns are regular expressions, compiled once with the `i` and `u` flags. Add phrases from real statements to `test/unit/countries.test.js` and run `npm test`.

## Development

### Running Tests

To run the tests, use the following command:

```sh
npm test
```

### Linting

To lint the code, use the following command:

```sh
npm run lint
```

To automatically fix linting issues, use the following command:

```sh
npm run lint:fix
```

### License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## Author

- **7h3Rabbit** - [GitHub](https://github.com/7h3Rabbit)

## Acknowledgements

- [sitespeed.io](https://www.sitespeed.io/)
- [plugin-webperf-core](https://www.npmjs.com/package/plugin-webperf-core)
