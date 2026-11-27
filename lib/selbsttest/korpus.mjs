// Korpus für den Selbsttest: ein Ordner je Fall unter korpus/boese/ und korpus/gut/, darin fall.json und die Diffs.
// Die Fälle sind Daten: sie werden nur gelesen, zerlegt und durch die Regeln geschickt, nie ausgeführt.
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUFEN } from '../befund.mjs';
import { alsHinzugefuegt } from '../pruefung.mjs';
import { BINAER_ENDUNGEN } from '../regeln/index.mjs';
import { endung } from '../diff.mjs';

export const REPO_WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KORPUS_STANDARD = path.join(REPO_WURZEL, 'korpus');
export const FIXTURES = path.join(REPO_WURZEL, 'test', 'fixtures');
export const ARTEN = ['boese', 'gut'];
const BEKANNT_ARTEN = ['fehlalarm', 'luecke', 'stufe'];
const STATUS = ['added', 'modified', 'renamed', 'removed'];
const KENNUNG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const MAX_DATEI = 1024 * 1024; // ein Korpus-Fixture ist klein; alles darüber ist ein Versehen

const fehler = (wo, was) => new Error(`Korpus ${wo}: ${was}`);

// Nur einfache Dateinamen im Fall-Ordner bzw. in test/fixtures, kein Weg nach außen.
function sichererName(wo, name) {
  if (typeof name !== 'string' || !/^[\w.-]{1,120}$/.test(name) || name.startsWith('.')) throw fehler(wo, `ungültiger Dateiname ${JSON.stringify(name)}`);
  return name;
}

async function liesKlein(wo, datei) {
  const info = await lstat(datei).catch(() => null);
  if (!info || !info.isFile()) throw fehler(wo, `${path.basename(datei)} fehlt oder ist keine normale Datei`);
  if (info.size > MAX_DATEI) throw fehler(wo, `${path.basename(datei)} ist größer als 1 MB`);
  return readFile(datei);
}

function pruefeErwartung(wo, e) {
  if (!e || typeof e.regel !== 'string' || !/^[a-z]+\/[\w-]+$/.test(e.regel)) throw fehler(wo, `erwartet: ungültige Regel ${JSON.stringify(e?.regel)}`);
  if (e.stufe !== undefined && !STUFEN.includes(e.stufe)) throw fehler(wo, `erwartet: ungültige Stufe ${JSON.stringify(e.stufe)}`);
  return { regel: e.regel, ...(e.stufe ? { stufe: e.stufe } : {}) };
}

function pruefeBekannt(wo, b) {
  if (!b || !BEKANNT_ARTEN.includes(b.art)) throw fehler(wo, `bekannt.art muss ${BEKANNT_ARTEN.join('|')} sein`);
  if (typeof b.regel !== 'string' || !b.regel) throw fehler(wo, 'bekannt.regel fehlt');
  if (typeof b.grund !== 'string' || b.grund.trim().length < 10) throw fehler(wo, 'bekannt.grund fehlt oder ist zu knapp');
  return { art: b.art, regel: b.regel, grund: b.grund.trim() };
}

/** Eine Datei des Falls → Eintrag im Format der GitHub-API plus `_bytes` (Blob-Inhalt, falls vorhanden) und `_texte` (für die Hygiene). */
async function ladeDatei(wo, ordner, d) {
  if (!d || typeof d.pfad !== 'string' || !d.pfad || d.pfad.length > 300) throw fehler(wo, 'Datei ohne pfad');
  const status = d.status ?? 'modified';
  if (!STATUS.includes(status)) throw fehler(wo, `ungültiger status ${JSON.stringify(status)}`);
  const quellen = ['diff', 'inhalt', 'fixture', 'hex', 'ohneInhalt'].filter((k) => d[k] !== undefined);
  if (quellen.length !== 1) throw fehler(wo, `${d.pfad}: genau eins von diff, inhalt, fixture, hex, ohneInhalt angeben`);
  const basis = { filename: d.pfad, status, sha: null, ...(d.previous_filename ? { previous_filename: String(d.previous_filename) } : {}) };

  if (d.diff !== undefined) {
    const patch = (await liesKlein(wo, path.join(ordner, sichererName(wo, d.diff)))).toString('utf8').replace(/\n$/, '');
    const zeilen = patch.split('\n');
    const additions = zeilen.filter((z) => z.startsWith('+')).length;
    const deletions = zeilen.filter((z) => z.startsWith('-')).length;
    if (!/^@@ -\d+/.test(zeilen[0] || '')) throw fehler(wo, `${d.diff} beginnt nicht mit einem @@-Kopf`);
    return { ...basis, additions, deletions, patch, _texte: [patch] };
  }
  if (d.ohneInhalt !== undefined) {
    // GitHub hat keinen Patch geliefert und der Blob ist nicht ladbar (fail-closed-Fall).
    const additions = Number.isInteger(d.additions) && d.additions >= 0 ? d.additions : 0;
    return { ...basis, additions, deletions: 0, changes: d.changes ?? additions, _texte: [] };
  }
  let bytes;
  if (d.hex !== undefined) {
    if (typeof d.hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(d.hex)) throw fehler(wo, `${d.pfad}: hex ist kein Hex-String`);
    bytes = Buffer.from(d.hex, 'hex');
  } else if (d.fixture !== undefined) {
    bytes = await liesKlein(wo, path.join(FIXTURES, sichererName(wo, d.fixture)));
  } else {
    bytes = await liesKlein(wo, path.join(ordner, sichererName(wo, d.inhalt)));
  }
  const text = bytes.toString('utf8');
  const binaer = BINAER_ENDUNGEN.has(endung(d.pfad)) || bytes.subarray(0, 512).includes(0);
  if (binaer) return { ...basis, additions: 0, deletions: 0, _bytes: bytes, _texte: [text] };
  return { ...alsHinzugefuegt(d.pfad, bytes), ...basis, _bytes: bytes, _texte: [text] };
}

/** Liest und prüft einen Fall-Ordner. Wirft bei jedem Formfehler, damit ein kaputter Fall nie still wegfällt. */
export async function ladeFall(ordner, art) {
  const kennung = path.basename(ordner);
  const wo = `${art}/${kennung}`;
  if (!KENNUNG.test(kennung)) throw fehler(wo, 'Ordnername ist keine gültige Kennung (a-z, 0-9, -)');
  const rohText = (await liesKlein(wo, path.join(ordner, 'fall.json'))).toString('utf8');
  let roh;
  try { roh = JSON.parse(rohText); } catch (e) { throw fehler(wo, `fall.json ist kein JSON: ${e.message}`); }
  if (roh.kennung !== kennung) throw fehler(wo, `kennung ${JSON.stringify(roh.kennung)} passt nicht zum Ordner`);
  if (roh.art !== art) throw fehler(wo, `art ${JSON.stringify(roh.art)} passt nicht zum Ordner ${art}/`);
  if (typeof roh.warum !== 'string' || roh.warum.trim().length < 10) throw fehler(wo, 'warum fehlt oder ist zu knapp');
  if (!Array.isArray(roh.erwartet ?? []) || !Array.isArray(roh.bekannt ?? [])) throw fehler(wo, 'erwartet und bekannt müssen Listen sein');
  const erwartet = (roh.erwartet ?? []).map((e) => pruefeErwartung(wo, e));
  if (art === 'boese' && !erwartet.length) throw fehler(wo, 'ein böser Fall braucht mindestens eine erwartete Regel');
  if (art === 'gut' && erwartet.length) throw fehler(wo, 'ein guter Fall erwartet keine Regel');
  if (new Set(erwartet.map((e) => e.regel)).size !== erwartet.length) throw fehler(wo, 'eine Regel steht doppelt in erwartet');
  const bekannt = (roh.bekannt ?? []).map((b) => pruefeBekannt(wo, b));
  if (!Array.isArray(roh.dateien) || !roh.dateien.length) throw fehler(wo, 'dateien fehlt');
  const dateien = [];
  for (const d of roh.dateien) dateien.push(await ladeDatei(wo, ordner, d));
  const kontext = { ausFork: roh.kontext?.ausFork === true };
  return { kennung, art, warum: roh.warum.trim(), erwartet, bekannt, kontext, dateien, _texte: [rohText, ...dateien.flatMap((d) => d._texte)] };
}

/** Alle Fälle eines Korpus-Ordners, sortiert nach Art und Kennung (stabile Reihenfolge für reproduzierbare Berichte). */
export async function ladeKorpus(wurzel = KORPUS_STANDARD) {
  const faelle = [];
  for (const art of ARTEN) {
    const ordner = path.join(wurzel, art);
    let namen;
    try { namen = await readdir(ordner, { withFileTypes: true }); } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw fehler(art, e.message);
    }
    for (const n of namen.filter((x) => x.isDirectory()).map((x) => x.name).sort()) faelle.push(await ladeFall(path.join(ordner, n), art));
  }
  if (!faelle.length) throw new Error(`Korpus ${wurzel}: keine Fälle gefunden`);
  const doppelt = faelle.map((f) => f.kennung).find((k, i, alle) => alle.indexOf(k) !== i);
  if (doppelt) throw fehler(doppelt, 'Kennung kommt in boese/ und gut/ vor');
  return faelle;
}
