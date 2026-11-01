import { auszug, saeuberePfad } from './diff.mjs';

export const STUFEN = ['info', 'warn', 'block'];

/** Ein Befund: was, wie schlimm, wo, warum, Quelle. Auszug ist immer gesäubert und gekürzt. */
export function befund({ regel, stufe, datei, zeile = null, text = '', warum, quelle = '' }) {
  if (!STUFEN.includes(stufe)) throw new Error(`Unbekannte Stufe ${stufe}`);
  return { regel, stufe, datei: saeuberePfad(datei), zeile, auszug: auszug(text), warum: auszug(warum, 400), quelle };
}

export function hoechsteStufe(befunde) {
  return befunde.reduce((max, b) => (STUFEN.indexOf(b.stufe) > STUFEN.indexOf(max) ? b.stufe : max), 'info');
}

export function zaehle(befunde) {
  const z = { block: 0, warn: 0, info: 0 };
  for (const b of befunde) z[b.stufe]++;
  return z;
}
