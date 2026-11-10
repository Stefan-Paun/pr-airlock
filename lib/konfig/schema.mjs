// Strenge Prüfung von .schleuse.json: unbekannte Felder, Kennungen, Muster und Werte sind Fehler mit Feld, Wert und Vorschlag.
import { REGEL_IDS, FAMILIEN, GESCHUETZT, familieVon } from './regelliste.mjs';
import { pruefeMuster } from './muster.mjs';
import { SCHWELLEN } from '../regeln/anhang.mjs';

export const SCHEMA_VERSION = 1;
export const MAX_BYTES = 64 * 1024;
export const MAX_AUSNAHMEN = 200;
export const MIN_GRUND = 8;
export const STUFEN_KONFIG = ['aus', 'hinweis', 'warnung', 'fehler'];
export const INTERN = { aus: null, hinweis: 'info', warnung: 'warn', fehler: 'block' };
export const RANG = { aus: 0, hinweis: 1, warnung: 2, fehler: 3 };

// Alle Schwellen, die Regeln heute als Konstanten haben. Höher = lockerer. Grenzen verhindern Unsinn wie 0 oder 1e12.
export const STANDARD_SCHWELLEN = { ...SCHWELLEN, base64Min: 2000 };
export const SCHWELLEN_GRENZEN = {
  fuellung: [20, 10000, true], fuehrend: [20, 10000, true], mindestCode: [20, 100000, true],
  riesenzeile: [200, 1000000, true], entropie: [1, 8, false], tokenMin: [1, 10, true], base64Min: [200, 1000000, true],
};

const FELDER = ['version', 'regeln', 'ausnahmen', 'schwellen', 'failOn'];
const AUSNAHME_FELDER = ['pfad', 'regel', 'grund'];

function abstand(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

export function vorschlag(wert, kandidaten) {
  const w = String(wert).toLowerCase();
  let best = null; let bestD = Infinity;
  for (const k of kandidaten) { const d = abstand(w, k.toLowerCase()); if (d < bestD) { best = k; bestD = d; } }
  return best !== null && bestD <= Math.max(2, Math.floor(best.length / 4)) ? best : null;
}

const zeig = (v) => { const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v); return s.length > 80 ? s.slice(0, 79) + '…' : s; };
const sauber = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g, '?');

/** Ist `schluessel` eine Familie (`x/*`)? Gibt den Familiennamen zurück. */
export const alsFamilie = (k) => (/^[a-z]+\/\*$/.test(k) ? k.slice(0, -2) : null);

/** Gilt die Regel-Angabe (Kennung oder `familie/*`) für diese konkrete Kennung? */
export const regelPasst = (angabe, id) => (alsFamilie(angabe) ? familieVon(id) === alsFamilie(angabe) : angabe === id);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Prüft ein geparstes Objekt. Ergebnis: { konfig, fehler, hinweise }; bei Fehlern ist konfig null.
 * Fehler: { feld, wert, meldung, vorschlag }.
 */
export function pruefeKonfig(roh) {
  const fehler = [];
  const hinweise = [];
  const err = (feld, wert, meldung, vor = null) => fehler.push({ feld: sauber(feld), wert: sauber(zeig(wert)), meldung, vorschlag: vor });
  if (!isObj(roh)) { err('(Datei)', roh, 'Oberste Ebene muss ein JSON-Objekt sein'); return { konfig: null, fehler, hinweise }; }

  for (const k of Object.keys(roh)) if (!FELDER.includes(k)) err(k, roh[k], 'Unbekanntes Feld', vorschlag(k, FELDER) && `meinst du "${vorschlag(k, FELDER)}"?`);
  if (roh.version === undefined) err('version', undefined, `Pflichtfeld; aktuell ${SCHEMA_VERSION}`);
  else if (roh.version !== SCHEMA_VERSION) err('version', roh.version, `Nicht unterstützte Schema-Version (erwartet ${SCHEMA_VERSION})`);

  const regeln = Object.create(null);
  if (roh.regeln !== undefined) {
    if (!isObj(roh.regeln)) err('regeln', roh.regeln, 'Muss ein Objekt Kennung → Stufe sein');
    else for (const [k, v] of Object.entries(roh.regeln)) {
      const feld = `regeln.${k}`;
      const fam = alsFamilie(k);
      if (fam ? !FAMILIEN.includes(fam) : !REGEL_IDS.includes(k)) {
        const v1 = vorschlag(k, [...REGEL_IDS, ...FAMILIEN.map((f) => `${f}/*`)]);
        err(feld, k, fam ? 'Unbekannte Regel-Familie' : 'Unbekannte Regel-Kennung', v1 && `meinst du "${v1}"?`);
        continue;
      }
      if (!STUFEN_KONFIG.includes(v)) { err(feld, v, `Stufe muss ${STUFEN_KONFIG.join(' | ')} sein`, typeof v === 'string' && vorschlag(v, STUFEN_KONFIG) ? `meinst du "${vorschlag(v, STUFEN_KONFIG)}"?` : null); continue; }
      if (!fam && GESCHUETZT.has(k) && v !== 'fehler') {
        err(feld, v, 'Diese Regel ist nicht abschaltbar und nicht absenkbar', 'Für einen Pfad: Eintrag in "ausnahmen" mit Regel und Grund');
        continue;
      }
      if (fam) {
        const geschuetzt = REGEL_IDS.filter((id) => familieVon(id) === fam && GESCHUETZT.has(id));
        if (geschuetzt.length && v !== 'fehler') hinweise.push(`${feld}: ${geschuetzt.length} geschützte Regel(n) der Familie bleiben unverändert (nicht abschaltbar)`);
      }
      regeln[k] = v;
    }
  }

  const ausnahmen = [];
  if (roh.ausnahmen !== undefined) {
    if (!Array.isArray(roh.ausnahmen)) err('ausnahmen', roh.ausnahmen, 'Muss eine Liste sein');
    else {
      if (roh.ausnahmen.length > MAX_AUSNAHMEN) err('ausnahmen', roh.ausnahmen.length, `Höchstens ${MAX_AUSNAHMEN} Ausnahmen`);
      roh.ausnahmen.slice(0, MAX_AUSNAHMEN).forEach((a, i) => {
        const feld = `ausnahmen[${i}]`;
        if (!isObj(a)) { err(feld, a, 'Muss ein Objekt mit pfad, grund und optional regel sein'); return; }
        for (const k of Object.keys(a)) if (!AUSNAHME_FELDER.includes(k)) err(`${feld}.${k}`, a[k], 'Unbekanntes Feld', vorschlag(k, AUSNAHME_FELDER) && `meinst du "${vorschlag(k, AUSNAHME_FELDER)}"?`);
        let ok = true;
        const m = pruefeMuster(a.pfad);
        if (m) { err(`${feld}.pfad`, a.pfad, m); ok = false; }
        if (typeof a.grund !== 'string' || a.grund.trim().length < MIN_GRUND) { err(`${feld}.grund`, a.grund, `Pflichtfeld: eine echte Begründung (mindestens ${MIN_GRUND} Zeichen)`); ok = false; }
        else if (a.grund.length > 300) { err(`${feld}.grund`, a.grund, 'Höchstens 300 Zeichen'); ok = false; }
        if (a.regel !== undefined) {
          const fam = typeof a.regel === 'string' ? alsFamilie(a.regel) : null;
          if (typeof a.regel !== 'string' || (fam ? !FAMILIEN.includes(fam) : !REGEL_IDS.includes(a.regel))) {
            const v1 = typeof a.regel === 'string' && vorschlag(a.regel, [...REGEL_IDS, ...FAMILIEN.map((f) => `${f}/*`)]);
            err(`${feld}.regel`, a.regel, 'Unbekannte Regel-Kennung', v1 && `meinst du "${v1}"?`); ok = false;
          }
        } else if (ok) hinweise.push(`${feld}: ohne "regel" gilt die Ausnahme für alle abschaltbaren Regeln; geschützte Regeln musst du einzeln nennen`);
        if (ok) ausnahmen.push({ pfad: a.pfad, regel: a.regel ?? null, grund: a.grund.trim() });
      });
    }
  }

  const schwellen = Object.create(null);
  if (roh.schwellen !== undefined) {
    if (!isObj(roh.schwellen)) err('schwellen', roh.schwellen, 'Muss ein Objekt Name → Zahl sein');
    else for (const [k, v] of Object.entries(roh.schwellen)) {
      const g = SCHWELLEN_GRENZEN[k];
      if (!g) { err(`schwellen.${k}`, v, 'Unbekannte Schwelle', vorschlag(k, Object.keys(SCHWELLEN_GRENZEN)) && `meinst du "${vorschlag(k, Object.keys(SCHWELLEN_GRENZEN))}"? Gültig: ${Object.keys(SCHWELLEN_GRENZEN).join(', ')}`); continue; }
      if (typeof v !== 'number' || !Number.isFinite(v) || (g[2] && !Number.isInteger(v))) { err(`schwellen.${k}`, v, g[2] ? 'Muss eine ganze Zahl sein' : 'Muss eine Zahl sein'); continue; }
      if (v < g[0] || v > g[1]) { err(`schwellen.${k}`, v, `Muss zwischen ${g[0]} und ${g[1]} liegen (Standard ${STANDARD_SCHWELLEN[k]})`); continue; }
      schwellen[k] = v;
    }
  }

  let failOn = null;
  if (roh.failOn !== undefined) {
    if (!['hinweis', 'warnung', 'fehler'].includes(roh.failOn)) err('failOn', roh.failOn, 'Muss hinweis | warnung | fehler sein', typeof roh.failOn === 'string' && vorschlag(roh.failOn, ['hinweis', 'warnung', 'fehler']) && `meinst du "${vorschlag(roh.failOn, ['hinweis', 'warnung', 'fehler'])}"?`);
    else failOn = roh.failOn;
  }

  if (fehler.length) return { konfig: null, fehler, hinweise };
  return { konfig: { version: SCHEMA_VERSION, regeln, ausnahmen, schwellen, failOn }, fehler, hinweise };
}

/** Text → geprüfte Konfiguration. Zu große oder kaputte Dateien sind ein Fehler, nie ein stiller Standard. */
export function ladeKonfig(text) {
  if (Buffer.byteLength(String(text)) > MAX_BYTES) return { konfig: null, fehler: [{ feld: '(Datei)', wert: '', meldung: `Datei größer als ${MAX_BYTES / 1024} KB`, vorschlag: null }], hinweise: [] };
  let roh;
  try { roh = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) {
    return { konfig: null, fehler: [{ feld: '(Datei)', wert: '', meldung: `Kein gültiges JSON: ${sauber(e.message).slice(0, 120)}`, vorschlag: null }], hinweise: [] };
  }
  return pruefeKonfig(roh);
}

export function fehlerText(f) {
  return `${f.feld}: ${f.meldung}${f.wert && f.wert !== 'undefined' ? ` (Wert ${f.wert})` : ''}${f.vorschlag ? ` – ${f.vorschlag}` : ''}`;
}
