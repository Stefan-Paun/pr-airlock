import { zaehle } from '../befund.mjs';
import { saeubere } from '../diff.mjs';

// Fremdtext in Markdown entschärfen: Code-Spans ohne Backticks, kein HTML, keine Link-Syntax.
export const md = (s) => saeubere(s).replace(/\r?\n/g, ' ').replace(/[\\`*_\[\]()<>|#~]/g, (c) => '\\' + c);
// Code-Spans: Backticks, Pipes (zerstören Tabellen) und spitze Klammern durch ähnliche Zeichen ersetzen.
export const code = (s) => '`' + saeubere(s).replace(/\r?\n/g, '\u240a').replace(/`/g, 'ˋ').replace(/\|/g, '¦').replace(/</g, '‹').replace(/>/g, '›') + '`';

const STUFE_TEXT = { block: '🟥 block', warn: '🟨 warn', info: '⬜ info' };

export function toMarkdown(ergebnis) {
  const { befunde, meta = {} } = ergebnis;
  const z = zaehle(befunde);
  const z1 = ['<!-- schleuse -->', `### Schleuse · ${md(meta.ziel || '')}`, ''];
  if (!befunde.length) {
    z1.push(`✅ Nichts Auffälliges in ${meta.dateien ?? '?'} geänderten Dateien. Kein Freispruch, nur: nichts von dem, was Schleuse kennt.`);
  } else {
    z1.push(`**${z.block} block · ${z.warn} warn · ${z.info} info** in ${meta.dateien ?? '?'} geänderten Dateien. Dieser PR wurde nicht ausgecheckt oder ausgeführt, nur als Text gelesen.`, '');
    z1.push('| Stufe | Regel | Datei | Warum |', '|---|---|---|---|');
    for (const b of befunde) {
      z1.push(`| ${STUFE_TEXT[b.stufe]} | ${code(b.regel)} | ${code(b.datei + (b.zeile ? ':' + b.zeile : ''))} | ${md(b.warum)} |`);
    }
    z1.push('', '<details><summary>Auszüge (nur Text, gekürzt)</summary>', '');
    for (const b of befunde.filter((x) => x.auszug)) z1.push(`- ${code(b.regel)} ${code(b.datei)}: ${code(b.auszug)}`);
    z1.push('', '</details>');
  }
  for (const h of meta.hinweise || []) z1.push('', `> ⚠️ ${code(h)}`);
  z1.push('', '<sub>Schleuse prüft eingehende Pull Requests nur als Daten über die GitHub-API. Regeln: Struktur angehängter Payloads, bekannte PolinRider-Marker, Binär-Tarnung, Autostart, Projekt-Hygiene.</sub>');
  return z1.join('\n') + '\n';
}
