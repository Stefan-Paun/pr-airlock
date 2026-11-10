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
    z1.push(`✅ Nichts Auffälliges in ${meta.dateien ?? '?'} ${meta.modus === 'scan' ? 'verfolgten' : 'geänderten'} Dateien. Kein Freispruch, nur: nichts von dem, was Schleuse kennt.`);
  } else {
    z1.push(`**${z.block} block · ${z.warn} warn · ${z.info} info** in ${meta.dateien ?? '?'} ${meta.modus === 'scan' ? 'verfolgten' : 'geänderten'} Dateien. ${meta.modus ? 'Der Inhalt wurde nur mit git gelesen, nichts davon ausgeführt.' : 'Dieser PR wurde nicht ausgecheckt oder ausgeführt, nur als Text gelesen.'}`, '');
    z1.push('| Stufe | Regel | Datei | Warum |', '|---|---|---|---|');
    for (const b of befunde) {
      z1.push(`| ${STUFE_TEXT[b.stufe]} | ${code(b.regel)} | ${code(b.datei + (b.zeile ? ':' + b.zeile : ''))} | ${md(b.warum)}${b.urspruenglich ? md(` (per Konfiguration von ${b.urspruenglich} umgestuft)`) : ''} |`);
    }
    for (const b of befunde.filter((x) => x.details?.length)) {
      z1.push('', `**${code(b.regel)}**`, ...b.details.map((d) => `- ${md(d)}`));
    }
    z1.push('', '<details><summary>Auszüge (nur Text, gekürzt)</summary>', '');
    for (const b of befunde.filter((x) => x.auszug)) z1.push(`- ${code(b.regel)} ${code(b.datei)}: ${code(b.auszug)}`);
    z1.push('', '</details>');
  }
  const u = ergebnis.unterdrueckt || [];
  if (u.length) {
    z1.push('', `<details><summary>${u.length} Befund(e) per .schleuse.json unterdrückt</summary>`, '', '| Regel | Datei | Unterdrückt wegen |', '|---|---|---|');
    for (const x of u.slice(0, 100)) z1.push(`| ${code(x.regel)} | ${code(x.datei + (x.zeile ? ':' + x.zeile : ''))} | ${md(x.grund)} (${code(x.muster)}) |`);
    if (u.length > 100) z1.push('', `… und ${u.length - 100} weitere`);
    z1.push('', '</details>');
  }
  if (meta.nichtAnwendbar?.length) z1.push('', `> ℹ️ ${code('Nicht anwendbar im Scan: ' + meta.nichtAnwendbar.map((r) => r.id).join(', '))}`);
  for (const h of meta.hinweise || []) z1.push('', `> ⚠️ ${code(h)}`);
  z1.push('', '<sub>Schleuse prüft eingehende Pull Requests nur als Daten über die GitHub-API. Regeln: Struktur angehängter Payloads, bekannte PolinRider-Marker, Binär-Tarnung, Autostart, Projekt-Hygiene.</sub>');
  return z1.join('\n') + '\n';
}
