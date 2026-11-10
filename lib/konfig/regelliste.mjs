// Welche Regel-Kennungen es gibt, welche Familien, welche geschützt sind.
import { REGELN } from '../regeln/index.mjs';
import { MARKER, DATEINAMEN } from '../regeln/marker.mjs';

const STUFE_NACH_KONFIG = { block: 'fehler', warn: 'warnung', info: 'hinweis' };

/** Alle konkreten Kennungen mit ihrer üblichen Stufe (Marker einzeln aufgelöst). */
export const REGEL_STUFEN = (() => {
  const m = new Map();
  for (const r of REGELN) if (!r.id.endsWith('/*')) m.set(r.id, r.stufe);
  for (const x of MARKER) m.set(`marker/${x.id}`, x.stufe || 'block');
  for (const x of DATEINAMEN) m.set(`marker/${x.id}`, 'block');
  return m;
})();

export const REGEL_IDS = [...REGEL_STUFEN.keys()];
export const FAMILIEN = [...new Set(REGEL_IDS.map((id) => id.split('/')[0]))];

/**
 * Nicht abschaltbar: die Regeln mit der höchsten Trefferschärfe (fast nie ein Fehlalarm) und das Fail-closed-Signal.
 * Sie lassen sich nur per Ausnahme mit Grund für einen Pfad aussetzen, nie global senken.
 * Begründung steht in der README (Abschnitt Konfiguration).
 */
const GESCHUETZT_FEST = ['anhang/fuellung', 'anhang/global-tag', 'tarnung/magic-bytes', 'autostart/vscode-task', 'projekt/workflow-pwn-request', 'pruefung/unvollstaendig'];
export const GESCHUETZT = new Set([
  ...GESCHUETZT_FEST,
  ...REGEL_IDS.filter((id) => id.startsWith('marker/') && REGEL_STUFEN.get(id) === 'block'),
]);

export const stufeNachKonfig = (intern) => STUFE_NACH_KONFIG[intern];
export const familieVon = (id) => String(id).split('/')[0];
