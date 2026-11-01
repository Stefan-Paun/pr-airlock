import { parsePatch } from '../diff.mjs';
import { pruefeAnhang } from './anhang.mjs';
import { pruefeMarker } from './marker.mjs';
import { pruefeTarnung, pruefeBase64, MAGIC } from './tarnung.mjs';
import { pruefeAutostart } from './autostart.mjs';
import { pruefeProjekt } from './projekt.mjs';
import { endung } from '../diff.mjs';
import { befund } from '../befund.mjs';

export const REGELN = [
  { id: 'anhang/fuellung', stufe: 'block', text: 'Code hinter einer langen Leerzeichen-Füllung in einer Zeile' },
  { id: 'anhang/riesenzeile', stufe: 'block', text: 'Riesige obfuskierte Zeile mit Ausführungs-Token in einer Konfig-/Quelldatei' },
  { id: 'anhang/global-tag', stufe: 'block', text: 'global.x=\'…\'-Versions-Tag oder global[…]=require/module' },
  { id: 'marker/*', stufe: 'block', text: 'Bekannte PolinRider-Literale (3 Varianten, Seeds, XOR-Schlüssel, C2, Skripte)' },
  { id: 'tarnung/magic-bytes', stufe: 'block', text: 'Font/Bild, dessen erste Bytes nicht zur Endung passen' },
  { id: 'tarnung/base64-block', stufe: 'warn', text: 'Großer Base64-Block in einer Quelldatei' },
  { id: 'autostart/vscode-task', stufe: 'block', text: '.vscode/tasks.json mit runOn: folderOpen und Kommando' },
  { id: 'autostart/npm-lifecycle', stufe: 'warn', text: 'Neues/geändertes install/prepare-Skript in package.json' },
  { id: 'autostart/pipe-to-shell', stufe: 'warn', text: 'curl/wget/iwr direkt in sh/iex gepiped' },
  { id: 'projekt/workflow-pwn-request', stufe: 'block', text: 'pull_request_target + Checkout des PR-Heads' },
  { id: 'projekt/workflow-aus-fork', stufe: 'warn', text: 'Workflow-Datei aus einem Fork geändert' },
  { id: 'projekt/gitignore-versteck', stufe: 'warn', text: '.gitignore versteckt Kampagnen-Skripte' },
  { id: 'projekt/neues-skript-im-root', stufe: 'warn', text: 'Neues Shell-/Batch-Skript im Projektstamm' },
];

export const BINAER_ENDUNGEN = new Set(Object.keys(MAGIC).filter((k) => MAGIC[k]));

/**
 * Prüft eine Liste geänderter Dateien im Format der GitHub-API (/pulls/{n}/files):
 * { filename, status, additions, deletions, patch?, sha }.
 * `ladeBytes(datei)` liefert die ersten Bytes einer Binärdatei (oder null) – injizierbar, damit Tests ohne Netz laufen.
 */
export async function pruefeDateien(dateien, { ladeBytes = async () => null, kontext = {} } = {}) {
  const befunde = [];
  const hinweise = [];
  if (dateien.length >= 3000) hinweise.push('GitHub liefert höchstens 3000 Dateien pro PR – die Prüfung ist unvollständig.');
  for (const datei of dateien) {
    if (datei.status === 'removed') continue;
    const { added } = parsePatch(datei.patch || '');
    if (!datei.patch && (datei.additions || 0) > 0 && !BINAER_ENDUNGEN.has(endung(datei.filename))) {
      hinweise.push(`${datei.filename}: kein Diff von GitHub geliefert (zu groß oder binär) – nicht geprüft.`);
    }
    befunde.push(...pruefeMarker(datei, added));
    befunde.push(...pruefeAnhang(datei, added));
    befunde.push(...pruefeBase64(datei, added));
    befunde.push(...pruefeAutostart(datei, added));
    befunde.push(...pruefeProjekt(datei, added, kontext));
    if (BINAER_ENDUNGEN.has(endung(datei.filename))) {
      try {
        const bytes = await ladeBytes(datei);
        befunde.push(...pruefeTarnung(datei, bytes));
      } catch (e) {
        hinweise.push(`${datei.filename}: Binärinhalt nicht ladbar (${e.message}).`);
      }
    }
  }
  // Pro Datei und Regel nur ein Befund: 15 identische Zeilen machen den Bericht nicht klüger.
  const gesehen = new Set();
  const eindeutig = befunde.filter((b) => { const k = `${b.datei}|${b.regel}`; if (gesehen.has(k)) return false; gesehen.add(k); return true; });
  return { befunde: eindeutig, hinweise, geprueft: dateien.length };
}

export { befund };
