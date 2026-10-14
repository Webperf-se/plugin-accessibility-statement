// Per-country vocabulary and rules for accessibility statements ("tillgänglighetsredogörelse"
// and its Danish/Norwegian/Finnish equivalents). All four countries implement the same EU
// directive (2016/2102), but each requires its own wording, its own regulator/report link,
// and - for Denmark and Norway - a fundamentally different discovery mechanism:
//
// - Sweden & Finland: the organization publishes the statement on its own site. We crawl for
//   it, same as today.
// - Denmark: every statement is centrally hosted at a predictable URL, was.digst.dk/<domain>.
//   We don't need to find a footer link - we can go straight there.
// - Norway: statements are authored via Digdir's central tool, uustatus.no, but each gets a
//   random UUID - not predictable from the domain. We still have to find the on-site link, but
//   it points off-domain to uustatus.no, which the crawler must be allowed to follow.
//
// Confidence varies by field: statement-title detection, compliance phrasing and report-link
// detection are verified against real, live statements (see the plugin's validation notes).
// Evaluation-method vocabulary is best-effort - missing a real-world phrasing there only causes
// a conservative "no-evaluation-method" false positive, not a false "compliant" read.

const MONTHS_SV = 'jan(?:uari)*|feb(?:ruari)*|mar(?:s)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:usti)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*';
const MONTHS_DA = 'jan(?:uar)*|feb(?:ruar)*|mar(?:ts)*|apr(?:il)*|maj|jun(?:i)*|jul(?:i)*|aug(?:ust)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|dec(?:ember)*';
const MONTHS_NO = 'jan(?:uar)*|feb(?:ruar)*|mar(?:s)*|apr(?:il)*|mai|jun(?:i)*|jul(?:i)*|aug(?:ust)*|sep(?:tember)*|okt(?:ober)*|nov(?:ember)*|des(?:ember)*';
const MONTHS_FI = 'tammi(?:kuu)*|helmi(?:kuu)*|maalis(?:kuu)*|huhti(?:kuu)*|touko(?:kuu)*|kesä(?:kuu)*|heinä(?:kuu)*|elo(?:kuu)*|syys(?:kuu)*|loka(?:kuu)*|marras(?:kuu)*|joulu(?:kuu)*';

function buildDateRegexes(markerWord, monthNames) {
    // Same 8-shape strategy as the Swedish patterns: marker-then-date and
    // date-then-marker, with day-month-year and numeric yyyy-mm-dd forms.
    // The day group allows an optional trailing period ("23. april") - Danish
    // and Norwegian conventionally punctuate the day number that way, unlike
    // Swedish ("23 september").
    return [
        new RegExp(`(?<typ>${markerWord})(?<text>[^>.]*) (?<day>[0-9]{1,2}\\.?[ \\t\\r\\n]+)(?<month>${monthNames}) (?<year>20[0-9]{2})`, 'gi'),
        new RegExp(` (?<day>[0-9]{1,2}\\.?[ \\t\\r\\n]+)(?<month>${monthNames}) (?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>${markerWord})`, 'gi'),
        new RegExp(`(?<typ>${markerWord})(?<text>[^>.]*) (?<day>)(?<month>${monthNames}) (?<year>20[0-9]{2})`, 'gi'),
        new RegExp(` (?<day>)(?<month>${monthNames}) (?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>${markerWord})`, 'gi'),
        new RegExp(`(?<typ>${markerWord})(?<text>[^>.]*) (?<year>20[0-9]{2}-)(?<month>[0-9]{2}-)(?<day>[0-9]{2})`, 'gi'),
        new RegExp(` (?<year>20[0-9]{2}-)(?<month>[0-9]{2}-)(?<day>[0-9]{2})(?<text>[^>.]*)(?<typ>${markerWord})`, 'gi'),
        new RegExp(`(?<typ>${markerWord})(?<text>[^>.]*) (?<day>[0-9]{1,2}\\.?[ \\t\\r\\n]+)*(?<month>${monthNames}) (?<year>20[0-9]{2})`, 'gi'),
        new RegExp(` (?<day>[0-9]{1,2}\\.?[ \\t\\r\\n]+)*(?<month>${monthNames}) (?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>${markerWord})`, 'gi')
    ];
}

function buildDottedNumericDateRegexes(markerWord) {
    // Finnish commonly writes dates as d.m.yyyy ("23.1.2026", not zero-padded),
    // unlike Swedish's dashed yyyy-mm-dd - needs its own numeric shape.
    return [
        new RegExp(`(?<typ>${markerWord})(?<text>[^>.]*?) (?<day>[0-9]{1,2})\\.(?<month>[0-9]{1,2})\\.(?<year>20[0-9]{2})`, 'gi'),
        new RegExp(` (?<day>[0-9]{1,2})\\.(?<month>[0-9]{1,2})\\.(?<year>20[0-9]{2})(?<text>[^>.]*)(?<typ>${markerWord})`, 'gi')
    ];
}

export const LOCALE_SE = {
    code: 'se',
    monthDict: { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 },
    statementTitle: {
        strict: /tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/i,
        loose: /tillg(.{1,6}|ä|&auml;|&#228;)nglighet/i
    },
    compliance: {
        full: /\bhelt[ \t\r\n]+förenlig\b/gi,
        partial: /\bdelvis[ \t\r\n]+förenlig\b/i,
        none: /\binte[ \t\r\n]+förenlig\b/i,
        negationWords: /\b(inte|ej)\b/i
    },
    evaluationMethodKeywords: /(sj(.{1, 6}|ä|&auml;|&#228;)lvskattning|intern[a]{0,1} kontroller|intern[a]{0,1} test(ning|er){0,1}]|utvärderingsmetod|tillgänglighetsexpert(er){0,1}|funka|etu ab|siteimprove|oberoende granskning|oberoende tillgänglighetsgranskning(ar){0,1}|tillgänglighetskonsult(er){0,1}|med hjälp av|egna tester|oberoende experter|Hur vi testat webbplats(en){0,1}|vi testat webbplatsen|intervjuer|rutiner|checklistor|checklista|utbildningar|automatiserade|automatisk|maskinell|kontrollverktyg|tillgänglighetskontroll)/gim,
    dateMarkers: [
        { regex: /bedömning/i, weight: 1.0 },
        { regex: /redogörelse/i, weight: 0.9 },
        { regex: /gransk/i, weight: 0.7 },
        { regex: /uppdater/i, weight: 0.5 }
    ],
    dateRegexes: buildDateRegexes('bedömning|redogörelse|uppdater|gransk', MONTHS_SV),
    unreasonablyBurdensome: /12[ \t\r\n]§ lagen|Oskäligt betungande anpassning/gim,
    interestingLinkText: /(om [a-z]+|(tillg(.{1,6}|ä|&auml;|&#228;)nglighet(sredog(.{1,6}|ö|&ouml;|&#246;)relse){0,1}))/gim,
    interestingTextPrecision: [
        { regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse$/i, precision: 0.55 },
        { regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighetsredog(.{1,6}|ö|&ouml;|&#246;)relse/i, precision: 0.5 },
        { regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighet$/i, precision: 0.4 },
        { regex: /^[ \t\r\n]*tillg(.{1,6}|ä|&auml;|&#228;)nglighet/i, precision: 0.35 },
        { regex: /tillg(.{1,6}|ä|&auml;|&#228;)nglighet/i, precision: 0.3 },
        { regex: /om webbplats/i, precision: 0.29 },
        { regex: /^[ \t\r\n]*om [a-z]+$/i, precision: 0.25 },
        { regex: /^[ \t\r\n]*om [a-z]+/i, precision: 0.2 }
    ],
    reportLink: {
        exact: 'https://www.digg.se/tdosanmalan',
        canonical: 'https://www.digg.se/analys-och-uppfoljning/lagen-om-tillganglighet-till-digital-offentlig-service-dos-lagen/anmal-bristande-tillganglighet',
        oldPattern: /digg\.se[a-z/-]+anmal-bristande-tillganglighet/i,
        authorityName: "DIGG's"
    }
};

export const LOCALE_DK = {
    code: 'dk',
    monthDict: { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 },
    statementTitle: {
        strict: /tilg(æ|ae|&aelig;)ngelighedserkl(æ|ae|&aelig;)ring/i,
        loose: /tilg(æ|ae|&aelig;)ngelighed/i
    },
    compliance: {
        // Real statements vary between the guidance's "opfylder" and organizations'
        // own "overholder" (kl.dk: "overholder loven delvist") - both accepted.
        full: /\b(opfylder|overholder)[ \t\r\n]+(standarden|loven)[ \t\r\n]+fuldt[ \t\r\n]+ud\b/gi,
        partial: /\b(opfylder|overholder)[ \t\r\n]+(standarden|loven)?[ \t\r\n]*delvis(t)?\b/i,
        none: /\b(ikke[ \t\r\n]+opfylder|opfylder[ \t\r\n]+ikke|overholder[ \t\r\n]+ikke)[ \t\r\n]+(standarden|loven)\b/i,
        // Guards the "full" match: the pattern above is loose ("...fuldt ud" can
        // appear as a substring of a longer, differently-phrased partial/negated
        // sentence), so any of these words earlier in the clause disqualifies it -
        // same class of bug as the Swedish "inte är helt förenlig" fix.
        negationWords: /\b(ikke|delvis(t)?)\b/i
    },
    evaluationMethodKeywords: /(egenevaluering|selvevaluering|ekstern(t)? (gennemgang|review)|brugertest(ning)?|automatisk(e)? test(ning)?|automatiseret test(ning)?|manuel(le)? (gennemgang|test)|tilgængelighedskonsulent(er)?|tilgængelighedsekspert(er)?|revisionsfirma)/gim,
    dateMarkers: [
        { regex: /vurdering/i, weight: 1.0 },
        { regex: /erklæring/i, weight: 0.9 },
        { regex: /gennemgang|gennemgået/i, weight: 0.7 },
        { regex: /revideret|opdateret/i, weight: 0.5 }
    ],
    dateRegexes: buildDateRegexes('vurdering|erklæring|gennemgang|gennemgået|revideret|opdateret', MONTHS_DA),
    unreasonablyBurdensome: null, // TODO: verify Danish equivalent of the "disproportionate burden" (§ 5, WAD) wording
    interestingLinkText: /(om [a-zæøå]+|tilg(æ|ae|&aelig;)ngelighed(serkl(æ|ae|&aelig;)ring)?)/gim,
    interestingTextPrecision: [
        { regex: /^[ \t\r\n]*tilg(æ|ae|&aelig;)ngelighedserkl(æ|ae|&aelig;)ring$/i, precision: 0.55 },
        { regex: /^[ \t\r\n]*tilg(æ|ae|&aelig;)ngelighedserkl(æ|ae|&aelig;)ring/i, precision: 0.5 },
        { regex: /^[ \t\r\n]*tilg(æ|ae|&aelig;)ngelighed$/i, precision: 0.4 },
        { regex: /^[ \t\r\n]*tilg(æ|ae|&aelig;)ngelighed/i, precision: 0.35 },
        { regex: /tilg(æ|ae|&aelig;)ngelighed/i, precision: 0.3 },
        { regex: /^[ \t\r\n]*om [a-zæøå]+$/i, precision: 0.25 },
        { regex: /^[ \t\r\n]*om [a-zæøå]+/i, precision: 0.2 }
    ],
    // Denmark has no single fixed report URL like Sweden's; the statement links
    // (or gives an email for) Digitaliseringsstyrelsen's web accessibility oversight.
    reportLink: {
        domainPattern: /digst\.dk/i,
        mailto: 'webtilsyn@digst.dk',
        authorityName: "Digitaliseringsstyrelsen's"
    },
    // Every Danish statement is also centrally hosted at a predictable URL - this lets
    // the plugin go straight there instead of relying on finding an on-site link.
    centralStatementUrl: (hostname) => `https://was.digst.dk/${hostname.replace(/\./g, '-')}`
};

export const LOCALE_NO = {
    code: 'no',
    monthDict: { jan: 1, feb: 2, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, des: 12 },
    statementTitle: {
        strict: /tilgjengeleg(heits|hets)erkl(æ|ae|&aelig;)ring/i,
        loose: /tilgjengelig(heit|het)/i
    },
    compliance: {
        // Order matters: "delvis" must be checked before a bare "samsvar" match,
        // since "delvis i samsvar" also contains the word "samsvar".
        full: /\b(er[ \t\r\n]+i[ \t\r\n]+)?samsvar[ \t\r\n]+med\b/gi,
        partial: /\bdelvis[ \t\r\n]+(i[ \t\r\n]+)?samsvar\b/i,
        none: /\bikke[ \t\r\n]+i[ \t\r\n]+samsvar\b/i,
        // Same guard rationale as the Danish pack above: "samsvar med" alone is
        // loose enough to appear inside an unusually-worded negated sentence.
        negationWords: /\b(ikke|delvis)\b/i
    },
    evaluationMethodKeywords: /(egenvurdering|egentesting|selv[ \t\r\n]+testet|ekstern[ \t\r\n]+(gransking|vurdering)|brukertest(ing)?|automatisert[ \t\r\n]+test(ing)?|manuell[ \t\r\n]+test(ing)?|uustatus|siteimprove|tilgjengelighetsekspert(er)?)/gim,
    dateMarkers: [
        { regex: /vurdering/i, weight: 1.0 },
        { regex: /erklæring/i, weight: 0.9 },
        { regex: /gransk(ing|et)/i, weight: 0.7 },
        { regex: /oppdater/i, weight: 0.5 }
    ],
    dateRegexes: buildDateRegexes('vurdering|erklæring|gransk(?:ing|et)|oppdater', MONTHS_NO),
    unreasonablyBurdensome: null, // TODO: verify Norwegian equivalent of the "uforholdsmessig stor byrde" wording
    interestingLinkText: /(om [a-zæøå]+|tilgjengelig(heit|het)(serkl(æ|ae|&aelig;)ring)?)/gim,
    interestingTextPrecision: [
        { regex: /^[ \t\r\n]*tilgjengeleg(heits|hets)erkl(æ|ae|&aelig;)ring$/i, precision: 0.55 },
        { regex: /^[ \t\r\n]*tilgjengeleg(heits|hets)erkl(æ|ae|&aelig;)ring/i, precision: 0.5 },
        { regex: /^[ \t\r\n]*tilgjengelig(heit|het)$/i, precision: 0.4 },
        { regex: /^[ \t\r\n]*tilgjengelig(heit|het)/i, precision: 0.35 },
        { regex: /tilgjengelig(heit|het)/i, precision: 0.3 },
        { regex: /^[ \t\r\n]*om [a-zæøå]+$/i, precision: 0.25 },
        { regex: /^[ \t\r\n]*om [a-zæøå]+/i, precision: 0.2 }
    ],
    // No single fixed URL: the statement should point to Diskrimineringsnemnda
    // (complaints) and/or the org's own uustatus.no-hosted declaration.
    reportLink: {
        domainPattern: /diskrimineringsnemnda\.no/i,
        authorityName: "Diskrimineringsnemnda's"
    },
    // Statements are authored via Digdir's central tool, but each gets a random
    // UUID (not derivable from the domain) - so unlike Denmark we can't jump
    // straight there. We instead have to let the crawler follow an on-site link
    // to it, which is off-domain from the org's own site.
    trustedOffDomainHosts: ['uustatus.no']
};

export const LOCALE_FI = {
    code: 'fi',
    monthDict: {
        tammi: 1, helmi: 2, maalis: 3, huhti: 4, touko: 5, kesä: 6,
        heinä: 7, elo: 8, syys: 9, loka: 10, marras: 11, joulu: 12
    },
    statementTitle: {
        strict: /saavutettavuusseloste/i,
        loose: /saavutettavuus/i
    },
    compliance: {
        // Finnish word order is inverted vs. Swedish/Danish/Norwegian: the verb
        // ("täyttää"/"ei täytä") comes first, the degree word after it.
        full: /\btäyttää[ \t\r\n]+(kokonaan|täysin)\b/gi,
        partial: /\btäyttää[ \t\r\n]+osittain\b/i,
        // Not \b after "täytä" - JS's \b treats "ä" as a non-word character, so a
        // trailing \b would fail to match a word boundary here at all (and would
        // also wrongly allow "täytä" to match as a prefix of the unrelated word
        // "täytäntöönpano", enforcement/implementation). Use an explicit
        // lookahead against a continuing Finnish letter instead.
        none: /\bei[ \t\r\n]+täytä(?![a-zA-ZäöåÄÖÅ])/i,
        negationWords: /\bei\b/i
    },
    evaluationMethodKeywords: /(itsearviointi|omat[ \t\r\n]+havainnot|ulkopuolinen[ \t\r\n]+arviointi|kolmannen[ \t\r\n]+osapuolen|automaattinen[ \t\r\n]+testaus|manuaalinen[ \t\r\n]+testaus|käyttäjätestaus|saavutettavuusasiantuntija)/gim,
    dateMarkers: [
        { regex: /arviointi/i, weight: 1.0 },
        { regex: /seloste/i, weight: 0.9 },
        { regex: /tarkist/i, weight: 0.7 },
        { regex: /päivitet/i, weight: 0.5 }
    ],
    dateRegexes: [
        ...buildDateRegexes('arviointi|seloste|tarkist|päivitet', MONTHS_FI),
        ...buildDottedNumericDateRegexes('arviointi|seloste|tarkist|päivitet')
    ],
    unreasonablyBurdensome: null, // TODO: verify Finnish equivalent of the "kohtuuton rasite" wording
    interestingLinkText: /(saavutettavuus(seloste)?)/gim,
    interestingTextPrecision: [
        { regex: /^[ \t\r\n]*saavutettavuusseloste$/i, precision: 0.55 },
        { regex: /^[ \t\r\n]*saavutettavuusseloste/i, precision: 0.5 },
        { regex: /^[ \t\r\n]*saavutettavuus$/i, precision: 0.4 },
        { regex: /^[ \t\r\n]*saavutettavuus/i, precision: 0.35 },
        { regex: /saavutettavuus/i, precision: 0.3 }
    ],
    reportLink: {
        exact: 'https://www.saavutettavuusvaatimukset.fi/fi/tee-saavutettavuuskantelu-tai-pyyda-selvitysta',
        domainPattern: /saavutettavuusvaatimukset\.fi/i,
        authorityName: "Traficom's"
    }
};

const LOCALES_BY_CODE = {
    se: LOCALE_SE,
    dk: LOCALE_DK,
    no: LOCALE_NO,
    fi: LOCALE_FI
};

// Finland is officially bilingual (Finnish/Swedish), so .fi sites may publish
// their statement in Swedish ("tillgänglighetsutlåtande") instead of Finnish.
// We try Finnish first (more likely), then fall back to Swedish patterns.
const TLD_TO_LOCALE_CODES = {
    se: ['se'],
    dk: ['dk'],
    no: ['no'],
    fi: ['fi', 'se']
};

export function detectLocalesForHostname(hostname) {
    const tld = (hostname || '').split('.').pop().toLowerCase();
    const codes = TLD_TO_LOCALE_CODES[tld] || ['se'];
    return codes.map(code => LOCALES_BY_CODE[code]);
}

export function getLocale(code) {
    return LOCALES_BY_CODE[code];
}
