import { parsePatch, endung, saeuberePfad } from '../diff.mjs';
import { pruefeAnhang } from './anhang.mjs';
import { pruefeMarker } from './marker.mjs';
import { pruefeTarnung, pruefeBase64, MAGIC } from './tarnung.mjs';
import { pruefeAutostart } from './autostart.mjs';
import { pruefeProjekt } from './projekt.mjs';
import { istCode } from './hilfen.mjs';
import { befund, STUFEN } from '../befund.mjs';

export const REGELN = [
  { id: 'anhang/fuellung', stufe: 'block', text: 'Code hinter einer langen Weißraum-Füllung in einer Zeile (warn ohne Code-Token)' },
  { id: 'anhang/riesenzeile', stufe: 'block', text: 'Riesige obfuskierte Zeile mit Ausführungs-Token in einer Konfig-/Quelldatei' },
  { id: 'anhang/global-tag', stufe: 'block', text: 'global.x=\'8-270-2\'-Versions-Tag oder global[…]=require/module' },
  { id: 'marker/*', stufe: 'block', text: 'Bekannte PolinRider-Literale (3 Varianten, Seeds, XOR-Schlüssel, C2, Skripte)' },
  { id: 'tarnung/magic-bytes', stufe: 'block', text: 'Font/Bild, dessen erste Bytes nicht zur Endung passen (block bei Text/JS-Inhalt, sonst warn)' },
  { id: 'tarnung/base64-block', stufe: 'warn', text: 'Großer Base64-Block in einer Quelldatei' },
  { id: 'autostart/vscode-task', stufe: 'block', text: '.vscode/tasks.json mit runOn: folderOpen und Kommando' },
  { id: 'autostart/vscode-settings', stufe: 'warn', text: 'Workspace-Einstellung schaltet automatische Tasks frei' },
  { id: 'autostart/idea', stufe: 'warn', text: 'JetBrains-Startkonfiguration geändert' },
  { id: 'autostart/npm-lifecycle', stufe: 'warn', text: 'Neues/geändertes install/prepare-Skript in package.json (block bei pipe-to-shell)' },
  { id: 'autostart/pipe-to-shell', stufe: 'warn', text: 'curl/wget/iwr direkt in sh/iex gepiped' },
  { id: 'projekt/workflow-pwn-request', stufe: 'block', text: 'pull_request_target + Checkout des PR-Heads' },
  { id: 'projekt/workflow-aus-fork', stufe: 'warn', text: 'Workflow-Datei aus einem Fork geändert' },
  { id: 'projekt/gitignore-versteck', stufe: 'warn', text: '.gitignore versteckt Kampagnen-Skripte' },
  { id: 'projekt/neues-skript-im-root', stufe: 'warn', text: 'Neues Shell-/Batch-Skript im Projektstamm' },
  { id: 'pruefung/unvollstaendig', stufe: 'warn', text: 'Ein Teil des PRs konnte nicht geprüft werden (kein Diff, 3000-Dateien-Limit, Blob nicht ladbar)' },
];

export const BINAER_ENDUNGEN = new Set(Object.keys(MAGIC).filter((k) => MAGIC[k]));
export const MAX_BLOBS = 100;

const Q_UNVOLL = 'GitHub-API-Grenzen: max. 3000 Dateien pro PR, kein Patch für sehr große Dateien';
const unvoll = (datei, warum) => befund({ regel: 'pruefung/unvollstaendig', stufe: 'warn', datei, warum, quelle: Q_UNVOLL });

/**
 * Prüft eine Liste geänderter Dateien im Format der GitHub-API (/pulls/{n}/files):
 * { filename, status, additions, deletions, patch?, sha }.
 * `ladeBytes(datei)` liefert die ersten Bytes einer Datei (oder null) – injizierbar, damit Tests ohne Netz laufen.
 * Fail-closed: Was nicht geprüft werden konnte, wird als warn-Befund gemeldet, nicht nur als Hinweis.
 */
export async function pruefeDateien(dateien, { ladeBytes = async () => null, kontext = {}, maxBlobs = MAX_BLOBS } = {}) {
  const befunde = [];
  const hinweise = [];
  let blobs = 0;
  if (dateien.length >= 3000) befunde.push(unvoll('(PR)', 'GitHub liefert höchstens 3000 Dateien pro PR – die Prüfung ist unvollständig.'));
  if (kontext.erwarteteDateien && kontext.erwarteteDateien > dateien.length) befunde.push(unvoll('(PR)', `PR meldet ${kontext.erwarteteDateien} geänderte Dateien, die API lieferte ${dateien.length}.`));

  const holeBytes = async (datei) => {
    if (blobs >= maxBlobs) { befunde.push(unvoll(datei.filename, `Mehr als ${maxBlobs} Binär-/Großdateien – diese wurde nicht geladen.`)); return undefined; }
    blobs++;
    try {
      const bytes = await ladeBytes(datei);
      if (bytes == null) befunde.push(unvoll(datei.filename, 'Inhalt konnte nicht geladen werden (kein Blob oder keine Base64-Antwort).'));
      return bytes;
    } catch (e) {
      befunde.push(unvoll(datei.filename, `Inhalt nicht ladbar: ${e.message}`));
      return undefined;
    }
  };

  for (const datei of dateien) {
    if (datei.status === 'removed') continue;
    const pfad = datei.filename;
    let { added } = parsePatch(datei.patch || '');
    const binaer = BINAER_ENDUNGEN.has(endung(pfad));
    // Kein Diff von GitHub (zu groß): Code-Dateien trotzdem prüfen, indem der ganze Inhalt als „hinzugefügt“ gilt.
    if (!datei.patch && !binaer && (datei.additions || 0) > 0) {
      if (istCode(pfad)) {
        const bytes = await holeBytes(datei);
        if (bytes) added = Buffer.from(bytes).toString('utf8').split('\n').map((text, i) => ({ zeile: i + 1, text }));
      } else {
        hinweise.push(`${saeuberePfad(pfad)}: kein Diff von GitHub geliefert (zu groß) – Textregeln nicht angewendet.`);
      }
    }
    befunde.push(...pruefeMarker(datei, added));
    befunde.push(...pruefeAnhang(datei, added));
    befunde.push(...pruefeBase64(datei, added));
    befunde.push(...pruefeAutostart(datei, added));
    befunde.push(...pruefeProjekt(datei, added, kontext));
    if (binaer) {
      const bytes = await holeBytes(datei);
      if (bytes) befunde.push(...pruefeTarnung(datei, bytes));
    }
  }
  // Pro Datei und Regel ein Befund, und zwar der mit der höchsten Stufe.
  const beste = new Map();
  for (const b of befunde) {
    const k = `${b.datei}|${b.regel}`;
    const alt = beste.get(k);
    if (!alt || STUFEN.indexOf(b.stufe) > STUFEN.indexOf(alt.stufe)) beste.set(k, b);
  }
  return { befunde: [...beste.values()], hinweise, geprueft: dateien.length };
}

export { befund };
