// Berichte des Selbsttests: Text fürs Terminal, Markdown für docs/KENNZAHLEN.md, JSON für Maschinen.
// Jede Quote steht mit Zähler und Nenner da, nie als nackte Prozentzahl.
import { saeubere } from '../diff.mjs';

const ART_WORT = { luecke: 'Lücke', stufe: 'falsche Stufe', fehlalarm: 'Fehlalarm', veraltet: 'veraltet' };

// Regeln, die der Korpus absichtlich nicht abdeckt, und warum.
export const OHNE_FALL = {
  'marker/polinrider-c2-host': 'braucht einen echten Hostnamen; der Korpus enthält nur Beispiel-Domains. Abgedeckt in test/regeln.test.mjs.',
  'marker/blockchain-dead-drop': 'braucht die Adresse eines echten Blockchain-API-Hosts; der Korpus enthält nur Beispiel-Domains.',
};

/** 57/58 → „98 % (57/58)“. Gerundet wird nie auf 0 % oder 100 %, solange das nicht stimmt. */
export function quoteText({ zaehler, nenner }) {
  if (!nenner) return '– (0/0)';
  let p = Math.round((zaehler / nenner) * 100);
  if (zaehler > 0 && p === 0) p = 1;
  if (zaehler < nenner && p === 100) p = 99;
  return `${p} % (${zaehler}/${nenner})`;
}

const md = (s) => saeubere(String(s)).replace(/([\\`*_[\]|<>])/g, '\\$1');
const abwText = (a) => `${a.kennung} · ${ART_WORT[a.art] || a.art} · ${a.regel} · erwartet ${a.erwartet}, gefunden ${a.gefunden ?? 'nichts'}`;

export function alsText(w, { filter = [] } = {}) {
  const g = w.gesamt;
  const z = [];
  z.push(`Schleuse-Selbsttest · ${g.boese} böse, ${g.gut} gute Fälle${filter.length ? ` · Regeln: ${filter.join(', ')}` : ''}`);
  const breite = Math.max(5, ...w.regeln.map((r) => r.id.length));
  z.push(`  ${'Regel'.padEnd(breite)}  ${'Treffer'.padEnd(16)}  Fehlalarme`);
  for (const r of w.regeln) z.push(`  ${r.id.padEnd(breite)}  ${quoteText(r.trefferquote).padEnd(16)}  ${quoteText(r.fehlalarmquote)}`);
  z.push(`  ${'Gesamt'.padEnd(breite)}  ${quoteText(g.trefferquote).padEnd(16)}  ${quoteText(g.guteMitAlarm)} gute Fälle mit Fehlalarm`);
  z.push(`  Böse Fälle ganz erkannt: ${quoteText(g.boeseKomplett)}`);
  const offen = w.abweichungen.filter((a) => !a.bekannt);
  const bekannt = w.abweichungen.filter((a) => a.bekannt);
  if (offen.length) { z.push(`  Offene Abweichungen (${offen.length}):`); for (const a of offen) z.push(`    ✗ ${saeubere(abwText(a))}`); }
  if (bekannt.length) { z.push(`  Bekannte Abweichungen (${bekannt.length}, brechen nicht):`); for (const a of bekannt) z.push(`    · ${saeubere(abwText(a))}`); }
  if (w.zusatz.length) z.push(`  Zusätzliche Befunde auf bösen Fällen (nicht erwartet, kein Fehler): ${w.zusatz.length}`);
  z.push(w.ok ? '  Ergebnis: bestanden' : `  Ergebnis: NICHT bestanden (${offen.length} offene Abweichung${offen.length === 1 ? '' : 'en'})`);
  return z.join('\n');
}

/** Die Seite docs/KENNZAHLEN.md. `datum` kommt als Parameter, damit derselbe Korpus dieselbe Datei ergibt. */
export function alsMarkdown(w, { datum, filter = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum))) throw new Error('alsMarkdown: datum als JJJJ-MM-TT angeben');
  const g = w.gesamt;
  const befehl = `node bin/schleuse.mjs selbsttest --format md --datum ${datum}${filter.length ? ` --regel ${filter.join(',')}` : ''}`;
  const z = [];
  z.push('# Kennzahlen', '');
  z.push(`Erzeugt am ${datum} mit \`${befehl}\`. Nicht von Hand ändern: \`npm test\` prüft, dass diese Datei zum Korpus passt.`, '');
  z.push(`**Korpus:** ${g.boese} böse Fälle (Nachbildungen der *Form* bekannter Angriffe, Inhalt ist ein wirkungsloser Platzhalter) und ${g.gut} gute Fälle (harmlose Änderungen, die sich leicht verwechseln lassen). Alles liegt in [\`korpus/\`](../korpus/), ein Ordner je Fall mit Begründung.`, '');
  z.push('## Gesamt', '');
  z.push('| | Ergebnis |', '|---|---|');
  z.push(`| Erwartete Befunde gefunden (in der erwarteten Stufe) | ${quoteText(g.trefferquote)} |`);
  z.push(`| Böse Fälle ganz erkannt | ${quoteText(g.boeseKomplett)} |`);
  z.push(`| Gute Fälle mit Fehlalarm (ab warn) | ${quoteText(g.guteMitAlarm)} |`);
  z.push(`| Abweichungen | ${g.bekannt} bekannt, ${g.offen} offen |`, '');
  z.push('## Je Regel', '');
  z.push('Treffer: böse Fälle, die diese Regel erwarten, und wie viele davon sie in der erwarteten Stufe meldet. Fehlalarme: gute Fälle, auf denen sie ab warn anschlägt.', '');
  z.push('| Regel | Treffer | Fehlalarme |', '|---|---:|---:|');
  for (const r of w.regeln) z.push(`| \`${r.id}\` | ${quoteText(r.trefferquote)} | ${quoteText(r.fehlalarmquote)} |`);
  z.push('');
  const bekannt = w.abweichungen.filter((a) => a.bekannt);
  const offen = w.abweichungen.filter((a) => !a.bekannt);
  if (offen.length) {
    z.push('## Offene Abweichungen', '');
    for (const a of offen) z.push(`- \`${a.kennung}\`: ${ART_WORT[a.art] || a.art} bei \`${a.regel}\` (erwartet ${md(a.erwartet)}, gefunden ${md(a.gefunden ?? 'nichts')})`);
    z.push('');
  }
  if (bekannt.length) {
    z.push('## Bekannte Abweichungen', '');
    z.push('Diese Fälle zeigen bewusste Grenzen der Regeln. Sie zählen in den Quoten oben mit, lassen den Selbsttest aber nicht scheitern. Verschwindet eine, scheitert der Selbsttest, bis der Korpus nachgezogen ist.', '');
    for (const a of bekannt) z.push(`- \`${a.kennung}\` (${ART_WORT[a.art]}, \`${a.regel}\`, gefunden: ${md(a.gefunden ?? 'nichts')}): ${md(a.grund)}`);
    z.push('');
  }
  const ohne = w.regeln.filter((r) => !r.faelle);
  if (ohne.length) {
    z.push('## Regeln ohne bösen Fall im Korpus', '');
    for (const r of ohne) z.push(`- \`${r.id}\`: ${md(OHNE_FALL[r.id] || 'noch kein Fall im Korpus.')}`);
    z.push('');
  }
  z.push('## Was diese Zahlen aussagen', '');
  z.push('Sie zeigen, dass jede Regel den Aufbau erkennt, für den sie gebaut ist, und auf typischen harmlosen Änderungen still bleibt. Die bösen Fälle sind Nachbildungen der Form, die aus Berichten über PolinRider und verwandte Kampagnen bekannt ist; die guten Fälle sind von Hand ausgewählt, gerade weil sie verwechselbar sind.', '');
  z.push('Sie sagen nichts über unbekannte Angriffe. Wer die Regeln kennt, kann einen Angriff so bauen, dass keine anschlägt. Eine Trefferquote von 100 % heißt hier nur: kein bekannter Aufbau aus dem Korpus rutscht durch. Die Fehlalarmquote gilt für diesen Korpus, nicht für jedes Projekt; echte Projekte haben andere harmlose Dateien. Der Feldtest gegen echte Pull Requests steht in der README.', '');
  return z.join('\n');
}

export function alsJson(w, { datum = null, filter = [] } = {}) {
  return { ...(datum ? { datum } : {}), filter, ok: w.ok, gesamt: w.gesamt, regeln: w.regeln, abweichungen: w.abweichungen, zusatz: w.zusatz };
}
