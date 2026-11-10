import { auszug, saeuberePfad } from './diff.mjs';

export const STUFEN = ['info', 'warn', 'block'];

/** Ein Befund: was, wie schlimm, wo, warum, Quelle. Auszug ist immer gesäubert und gekürzt. */
export function befund({ regel, stufe, datei, zeile = null, text = '', warum, quelle = '', details = [] }) {
  if (!STUFEN.includes(stufe)) throw new Error(`Unbekannte Stufe ${stufe}`);
  const sauber = saeuberePfad(datei);
  return {
    regel, stufe, datei: sauber, zeile, auszug: auszug(text), warum: auszug(warum, 400), quelle,
    // Der Name wurde beim Säubern verändert (Bidi-/Steuerzeichen): Pfad-Ausnahmen dürfen so einen Befund nie treffen.
    ...(sauber !== String(datei) ? { unsauber: true } : {}),
    ...(details.length ? { details: details.slice(0, 30).map((d) => auszug(d, 200)) } : {}),
  };
}

export function hoechsteStufe(befunde) {
  return befunde.reduce((max, b) => (STUFEN.indexOf(b.stufe) > STUFEN.indexOf(max) ? b.stufe : max), 'info');
}

export function zaehle(befunde) {
  const z = { block: 0, warn: 0, info: 0 };
  for (const b of befunde) z[b.stufe]++;
  return z;
}
