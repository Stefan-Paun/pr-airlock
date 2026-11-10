// Wendet eine geprüfte Konfiguration auf Befunde an: Ausnahmen, Abstufen, Familien. Reine Funktion, kein Netz, keine Dateien.
import { kompiliere } from './muster.mjs';
import { INTERN, STANDARD_SCHWELLEN, alsFamilie, regelPasst } from './schema.mjs';
import { GESCHUETZT } from './regelliste.mjs';
import { STUFEN } from '../befund.mjs';
import { auszug } from '../diff.mjs';

/** Wirksame Konfiguration: Datei (Basis-Stand) plus Eingaben der Action/CLI. Rangfolge: Eingabe > Datei > Standard. */
export function wirksameKonfig(konfig, { failOn = null } = {}) {
  const f = konfig?.failOn ? INTERN[konfig.failOn] : null;
  return {
    quelle: konfig ? 'datei' : 'standard',
    regeln: konfig?.regeln ?? Object.create(null),
    ausnahmen: konfig?.ausnahmen ?? [],
    schwellen: { ...STANDARD_SCHWELLEN, ...(konfig?.schwellen ?? {}) },
    failOn: failOn ?? f ?? 'block',
    failOnQuelle: failOn ? 'eingabe' : f ? 'datei' : 'standard',
  };
}

const KONFIG_BEFUND = /^konfig\//;

/** Ist für diese Kennung eine Ausnahme zulässig? Geschützte Regeln nur, wenn die Ausnahme sie beim exakten Namen nennt. */
function ausnahmeGilt(a, b) {
  if (KONFIG_BEFUND.test(b.regel) || b.unsauber) return false;
  if (a.regel === null) return !GESCHUETZT.has(b.regel);
  if (alsFamilie(a.regel)) return regelPasst(a.regel, b.regel) && !GESCHUETZT.has(b.regel);
  return a.regel === b.regel;
}

/**
 * Ergebnis: { befunde, unterdrueckt }. `unterdrueckt` nennt jeden verschwundenen Befund samt Grund, damit nichts still fehlt.
 * Reihenfolge je Befund: erst Ausnahmen (Pfad + Regel), dann Regel-Stufe (exakte Kennung vor Familie).
 */
export function wendeKonfigAn(befunde, wirksam) {
  const ausnahmen = wirksam.ausnahmen.map((a) => ({ ...a, passt: kompiliere(a.pfad) }));
  const out = [];
  const unterdrueckt = [];
  for (const b of befunde) {
    if (KONFIG_BEFUND.test(b.regel)) { out.push(b); continue; }
    const a = ausnahmen.find((x) => ausnahmeGilt(x, b) && x.passt(b.datei));
    if (a) {
      unterdrueckt.push({ regel: b.regel, stufe: b.stufe, datei: b.datei, zeile: b.zeile, art: 'ausnahme', muster: a.pfad, grund: auszug(a.grund, 300) });
      continue;
    }
    const fam = `${b.regel.split('/')[0]}/*`;
    const wert = wirksam.regeln[b.regel] ?? (GESCHUETZT.has(b.regel) ? undefined : wirksam.regeln[fam]);
    if (wert === undefined) { out.push(b); continue; }
    const neu = INTERN[wert];
    if (neu === null) {
      unterdrueckt.push({ regel: b.regel, stufe: b.stufe, datei: b.datei, zeile: b.zeile, art: 'regel-aus', muster: wirksam.regeln[b.regel] !== undefined ? b.regel : fam, grund: 'Regel in .schleuse.json auf "aus" gesetzt' });
      continue;
    }
    out.push(neu === b.stufe ? b : { ...b, stufe: neu, urspruenglich: b.stufe });
  }
  return { befunde: out, unterdrueckt };
}

export const stufeErreicht = (stufe, schwelle) => STUFEN.indexOf(stufe) >= STUFEN.indexOf(schwelle);
