import { parsePatch, endung, saeuberePfad } from '../diff.mjs';
import { pruefeAnhang } from './anhang.mjs';
import { pruefeMarker } from './marker.mjs';
import { pruefeTarnung, pruefeBase64, MAGIC } from './tarnung.mjs';
import { pruefeAutostart } from './autostart.mjs';
import { pruefeProjekt } from './projekt.mjs';
import { istCode, istGeneriert } from './hilfen.mjs';
import { befund, STUFEN } from '../befund.mjs';

export const REGELN = [
  { id: 'anhang/fuellung', stufe: 'block', text: 'Code hinter einer langen Weißraum-Füllung in einer Zeile (warn ohne Code-Token)' },
  { id: 'anhang/riesenzeile', stufe: 'block', text: 'Riesige obfuskierte Zeile mit Ausführungs-Token in einer Konfig-/Quelldatei' },
  { id: 'anhang/global-tag', stufe: 'block', text: 'global.x=\'8-270-2\'-Versions-Tag oder global[…]=require/module' },
  { id: 'marker/*', stufe: 'block', text: 'Bekannte PolinRider-Literale (3 Varianten, Seeds, XOR-Schlüssel, C2-Adressen und -Hosts, Skripte)' },
  { id: 'marker/blockchain-dead-drop', stufe: 'warn', text: 'Abfrage der letzten Transaktionen einer festen TRON-/Aptos-Adresse (Dead-Drop-Muster)' },
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
export const MAX_BLOBS = 300;
export const BLOB_KOPF = 256 * 1024;      // für Magic-Bytes reichen die ersten Bytes
export const BLOB_CODE = 5 * 1024 * 1024; // Code ohne Diff wird ganz geprüft – der Payload hängt am Ende
export const BLOB_BUDGET = 50 * 1024 * 1024; // Summe aller geladenen Bytes pro Lauf – gegen Actions-Minuten-Fraß
const BILD = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);

const Q_UNVOLL = 'GitHub-API-Grenzen: max. 3000 Dateien pro PR, kein Patch für sehr große oder binäre Diffs';
const unvoll = (datei, warum, stufe = 'warn') => befund({ regel: 'pruefung/unvollstaendig', stufe, datei, warum, quelle: Q_UNVOLL });

// Wer zuerst dran ist, wenn der Blob-Deckel greift: Code ohne Diff, dann Fonts und andere Binärformate, Bilder zuletzt.
// So kann ein Angreifer die Reihenfolge nicht über Dateinamen steuern.
export function risiko(datei) {
  const ext = endung(datei.filename);
  if (!datei.patch && istCode(datei.filename)) return 0;
  if (BINAER_ENDUNGEN.has(ext) && !BILD.has(ext)) return 1;
  return 2;
}

/**
 * Prüft eine Liste geänderter Dateien im Format der GitHub-API (/pulls/{n}/files):
 * { filename, status, additions, deletions, patch?, sha }.
 * `ladeBytes(datei, maxBytes)` liefert die ersten maxBytes einer Datei (oder null) – injizierbar, damit Tests ohne Netz laufen.
 * Fail-closed: Was nicht geprüft werden konnte, wird als Befund gemeldet (block bei Code und Fonts, warn bei Bildern).
 */
export async function pruefeDateien(dateien, { ladeBytes = async () => null, kontext = {}, maxBlobs = MAX_BLOBS, budget = BLOB_BUDGET } = {}) {
  const befunde = [];
  const hinweise = [];
  let blobs = 0;
  let geladen = 0;
  if (dateien.length >= 3000) befunde.push(unvoll('(PR)', 'GitHub liefert höchstens 3000 Dateien pro PR – die Prüfung ist unvollständig.', 'block'));
  if (kontext.erwarteteDateien && kontext.erwarteteDateien > dateien.length) befunde.push(unvoll('(PR)', `PR meldet ${kontext.erwarteteDateien} geänderte Dateien, die API lieferte ${dateien.length}.`));

  const holeBytes = async (datei, maxBytes) => {
    const ext = endung(datei.filename);
    const ernst = risiko(datei) < 2 ? 'block' : 'warn';
    if (blobs >= maxBlobs) { befunde.push(unvoll(datei.filename, `Mehr als ${maxBlobs} Binär-/Großdateien – diese wurde nicht geladen.`, ernst)); return undefined; }
    if (geladen >= budget) { befunde.push(unvoll(datei.filename, `Budget von ${Math.round(budget / 1048576)} MB geladener Inhalte erschöpft – diese Datei wurde nicht geprüft.`, ernst)); return undefined; }
    blobs++;
    try {
      const grenze = Math.min(maxBytes, budget - geladen); // Dateilimit oder Rest des Budgets, was zuerst greift
      const bytes = await ladeBytes(datei, grenze);
      if (bytes == null) { befunde.push(unvoll(datei.filename, 'Inhalt konnte nicht geladen werden (kein Blob oder keine Antwort).', ernst)); return undefined; }
      geladen += bytes.length;
      if (bytes.length >= grenze && !BINAER_ENDUNGEN.has(ext)) {
        // Generierte Riesen-Dateien (Lockfiles, Daten-JSON) sind normal → warn; echter Code über dem Limit → block
        befunde.push(unvoll(datei.filename, `Datei ist größer als ${Math.round(grenze / 1024)} KB – das Ende wurde nicht geprüft, und genau dort hängt PolinRider seinen Loader an.`, istGeneriert(datei.filename) ? 'warn' : 'block'));
      }
      return bytes;
    } catch (e) {
      befunde.push(unvoll(datei.filename, `Inhalt nicht ladbar: ${e.message}`, ernst));
      return undefined;
    }
  };

  const reihenfolge = [...dateien].sort((a, b) => risiko(a) - risiko(b));
  for (const datei of reihenfolge) {
    if (datei.status === 'removed') continue;
    const pfad = datei.filename;
    let { added } = parsePatch(datei.patch || '');
    const binaer = BINAER_ENDUNGEN.has(endung(pfad));
    const reinerRename = datei.status === 'renamed' && !(datei.additions || 0) && !(datei.deletions || 0) && !(datei.changes || 0);
    // Kein Diff von GitHub (zu groß oder ein NUL-Byte → „binär“): Code-Dateien trotzdem ganz prüfen.
    if (!datei.patch && !binaer && !reinerRename) {
      if (istCode(pfad)) {
        const bytes = await holeBytes(datei, BLOB_CODE);
        if (bytes) added = Buffer.from(bytes).toString('utf8').split('\n').map((text, i) => ({ zeile: i + 1, text }));
      } else if ((datei.additions || 0) > 0) {
        hinweise.push(`${saeuberePfad(pfad)}: kein Diff von GitHub geliefert (zu groß) – Textregeln nicht angewendet.`);
      }
    }
    befunde.push(...pruefeMarker(datei, added));
    befunde.push(...pruefeAnhang(datei, added, kontext.schwellen));
    befunde.push(...pruefeBase64(datei, added, kontext.schwellen?.base64Min));
    befunde.push(...pruefeAutostart(datei, added));
    befunde.push(...pruefeProjekt(datei, added, kontext));
    if (binaer) {
      const bytes = await holeBytes(datei, BLOB_KOPF);
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
