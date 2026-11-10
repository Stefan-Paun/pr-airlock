// Schutz gegen Selbst-Abschaltung: vergleicht die Konfiguration des Basis-Stands mit der, die der PR mitbringt,
// und beschreibt jede Lockerung. Die PR-Fassung wirkt nie; sie wird nur gelesen, um den Diff zu zeigen.
import { ladeKonfig, fehlerText, RANG, INTERN, STANDARD_SCHWELLEN } from './schema.mjs';
import { REGEL_STUFEN, GESCHUETZT, familieVon, stufeNachKonfig } from './regelliste.mjs';
import { befund, STUFEN } from '../befund.mjs';

export const KONFIG_DATEI = '.schleuse.json';

function regelRang(konfig, id) {
  const wert = konfig?.regeln?.[id] ?? (GESCHUETZT.has(id) ? undefined : konfig?.regeln?.[`${familieVon(id)}/*`]);
  return wert ?? stufeNachKonfig(REGEL_STUFEN.get(id));
}
const stufeZahl = (k) => RANG[k];

/** Liste lesbarer Lockerungen von `basis` zu `kopf` (beide geprüfte Konfigurationen oder null = Standard). */
export function lockerungen(basis, kopf) {
  const out = [];
  for (const id of REGEL_STUFEN.keys()) {
    const a = regelRang(basis, id); const b = regelRang(kopf, id);
    if (stufeZahl(b) < stufeZahl(a)) out.push(`Regel ${id}: ${a} → ${b}`);
  }
  const bekannt = new Set((basis?.ausnahmen ?? []).map((x) => `${x.pfad}\u0000${x.regel}`));
  for (const x of kopf?.ausnahmen ?? []) if (!bekannt.has(`${x.pfad}\u0000${x.regel}`)) out.push(`Neue Ausnahme: ${x.pfad}${x.regel ? ` für ${x.regel}` : ' für alle abschaltbaren Regeln'}, Grund „${x.grund}“`);
  for (const [k, std] of Object.entries(STANDARD_SCHWELLEN)) {
    const a = basis?.schwellen?.[k] ?? std; const b = kopf?.schwellen?.[k] ?? std;
    if (b > a) out.push(`Schwelle ${k}: ${a} → ${b} (höher = weniger Treffer)`);
  }
  const fa = basis?.failOn ? INTERN[basis.failOn] : 'block'; const fb = kopf?.failOn ? INTERN[kopf.failOn] : 'block';
  if (STUFEN.indexOf(fb) > STUFEN.indexOf(fa)) out.push(`failOn: ${stufeNachKonfig(fa)} → ${stufeNachKonfig(fb)} (Lauf scheitert erst später)`);
  return out;
}

/**
 * Befund für einen PR, der .schleuse.json anfasst. `basisKonfig`: geprüfte Konfiguration des Basis-Stands oder null.
 * `kopfText`: Inhalt der PR-Fassung (null bei Löschung oder wenn nicht ladbar).
 * Immer Stufe fehler; die Änderung wirkt für diesen Lauf nicht.
 */
export function aenderungsBefund({ basisKonfig, kopfText, geloescht = false, datei = KONFIG_DATEI }) {
  const details = [];
  let was;
  if (geloescht) {
    was = 'Der PR löscht die Konfigurationsdatei.';
    details.push(...lockerungen(basisKonfig, null));
  } else if (kopfText == null) {
    was = 'Der PR ändert die Konfigurationsdatei; der Inhalt konnte nicht gelesen werden, also bleibt der Lockerungs-Diff offen.';
  } else {
    const r = ladeKonfig(kopfText);
    if (r.konfig) {
      was = basisKonfig ? 'Der PR ändert die Konfigurationsdatei.' : 'Der PR legt eine Konfigurationsdatei an.';
      details.push(...lockerungen(basisKonfig, r.konfig));
    } else {
      was = 'Der PR ändert die Konfigurationsdatei, und die neue Fassung ist ungültig.';
      details.push(...r.fehler.slice(0, 5).map(fehlerText));
    }
  }
  if (!details.length) details.push('Keine Lockerung erkannt (nur Verschärfung oder Gleiches).');
  return befund({
    regel: 'konfig/aenderung', stufe: 'block', datei, details,
    warum: `${was} Konfiguration wird nur vom Basis-Zweig gelesen; diese Änderung wirkt für diesen Lauf nicht. Ein Maintainer muss sie prüfen und separat mergen.`,
    quelle: 'Schutz gegen Selbst-Abschaltung der Prüfung',
  });
}

/** Befund, wenn die Konfiguration des Basis-Stands selbst kaputt oder nicht lesbar ist: Standard gilt, die Prüfung bleibt streng. */
export function ungueltigBefund(grund, fehlerListe = []) {
  return befund({
    regel: 'konfig/ungueltig', stufe: 'block', datei: KONFIG_DATEI, details: fehlerListe.slice(0, 10).map(fehlerText),
    warum: `Konfiguration im Basis-Stand ist nicht benutzbar (${grund}). Es gilt der Standard.`,
    quelle: 'Fail-closed: kaputte Konfiguration schaltet nichts ab',
  });
}
