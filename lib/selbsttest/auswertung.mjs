// Auswertung des Selbsttests: Fälle + Befunde → Kennzahlen je Regel und Liste der Abweichungen.
// `werte` ist rein (keine Datei, kein Netz); `fuehreAus` schickt die Fälle durch dieselbe Prüfung wie `pr`/`diff`.
import { pruefeDateien, REGELN } from '../regeln/index.mjs';
import { MARKER, DATEINAMEN } from '../regeln/marker.mjs';
import { STUFEN } from '../befund.mjs';

const rang = (s) => STUFEN.indexOf(s);
const ALARM = rang('warn'); // ab hier zählt ein Befund auf einem guten Fall als Fehlalarm

/** Alle Regel-Kennungen, die Schleuse kennt (Familien-Platzhalter wie marker/* aufgelöst), in fester Reihenfolge. */
export function alleRegeln() {
  const ids = [];
  for (const r of REGELN) {
    if (r.id.endsWith('/*')) {
      for (const m of [...DATEINAMEN, ...MARKER]) ids.push(`marker/${m.id}`);
    } else ids.push(r.id);
  }
  return [...new Set(ids)];
}

/** `--regel`-Werte → Prüffunktion. Erlaubt: genaue Kennung oder Familie mit `/*`. Leer = alles. */
export function regelFilter(muster = []) {
  if (!muster.length) return () => true;
  const liste = muster.flatMap((m) => String(m).split(',')).map((m) => m.trim());
  for (const m of liste) if (!/^[a-z]+\/(?:\*|[\w-]+)$/.test(m)) throw new Error(`--regel: ungültiges Muster ${JSON.stringify(m)} (z. B. anhang/fuellung oder marker/*)`);
  const passt = (id) => liste.some((m) => (m.endsWith('/*') ? id.startsWith(m.slice(0, -1)) : id === m));
  // Ein Tippfehler darf nicht „0 Fälle, bestanden“ ergeben.
  const ids = alleRegeln();
  for (const m of liste) if (!ids.some((id) => (m.endsWith('/*') ? id.startsWith(m.slice(0, -1)) : id === m))) throw new Error(`--regel: ${m} passt zu keiner bekannten Regel`);
  return passt;
}

const quote = (zaehler, nenner) => ({ zaehler, nenner, anteil: nenner ? zaehler / nenner : null });

function bekanntFuer(fall, art, regel, stufe = null) {
  return fall.bekannt.find((b) => b.art === art && b.regel === regel && (!b.stufe || b.stufe === stufe)) || null;
}

/**
 * faelle: [{ kennung, art, erwartet: [{regel, stufe?}], bekannt: [{art, regel, grund}] }]
 * befundeJeFall: Map kennung → [{ regel, stufe, datei }]
 * Ergebnis: { regeln, gesamt, abweichungen, zusatz, ok }
 */
export function werte(faelle, befundeJeFall, { filter = () => true } = {}) {
  const ids = alleRegeln();
  const zeilen = new Map();
  const zeile = (id) => {
    if (!zeilen.has(id)) zeilen.set(id, { id, faelle: 0, treffer: 0, uebersehen: 0, falscheStufe: 0, gut: 0, fehlalarme: 0 });
    return zeilen.get(id);
  };
  for (const id of ids) if (filter(id)) zeile(id);

  const abweichungen = [];
  const zusatz = [];
  const gute = faelle.filter((f) => f.art === 'gut');
  const boese = faelle.filter((f) => f.art === 'boese' && f.erwartet.some((e) => filter(e.regel)));
  let guteMitAlarm = 0;
  let boeseKomplett = 0;

  for (const fall of boese) {
    const befunde = (befundeJeFall.get(fall.kennung) || []).filter((b) => filter(b.regel));
    let komplett = true;
    for (const e of fall.erwartet.filter((x) => filter(x.regel))) {
      const z = zeile(e.regel);
      z.faelle++;
      const passend = befunde.filter((b) => b.regel === e.regel);
      const hoechste = passend.reduce((max, b) => (rang(b.stufe) > rang(max) ? b.stufe : max), null);
      if (passend.length && (!e.stufe || passend.some((b) => b.stufe === e.stufe))) { z.treffer++; continue; }
      komplett = false;
      const art = passend.length ? 'stufe' : 'luecke';
      if (art === 'stufe') z.falscheStufe++; else z.uebersehen++;
      const b = bekanntFuer(fall, art, e.regel);
      abweichungen.push({ kennung: fall.kennung, fallArt: 'boese', art, regel: e.regel, erwartet: e.stufe || 'beliebig', gefunden: hoechste, bekannt: Boolean(b), grund: b?.grund || null });
    }
    if (komplett) boeseKomplett++;
    const erwartetIds = new Set(fall.erwartet.map((e) => e.regel));
    for (const b of befunde) {
      if (!erwartetIds.has(b.regel) && rang(b.stufe) >= ALARM) zusatz.push({ kennung: fall.kennung, regel: b.regel, stufe: b.stufe, datei: b.datei });
    }
  }

  for (const fall of gute) {
    const befunde = (befundeJeFall.get(fall.kennung) || []).filter((b) => filter(b.regel));
    const alarme = new Map();
    for (const b of befunde) if (rang(b.stufe) >= ALARM && rang(b.stufe) > rang(alarme.get(b.regel) ?? 'info')) alarme.set(b.regel, b.stufe);
    for (const [regel, stufe] of alarme) {
      const z = zeile(regel);
      z.fehlalarme++;
      const b = bekanntFuer(fall, 'fehlalarm', regel, stufe);
      abweichungen.push({ kennung: fall.kennung, fallArt: 'gut', art: 'fehlalarm', regel, erwartet: 'nichts ab warn', gefunden: stufe, bekannt: Boolean(b), grund: b?.grund || null });
    }
    if (alarme.size) guteMitAlarm++;
  }
  // Jede Regel läuft auf jedem guten Fall, also ist der Nenner der Fehlalarmquote immer die Zahl der guten Fälle.
  for (const z of zeilen.values()) z.gut = gute.length;

  // Eine als bekannt markierte Abweichung, die nicht mehr auftritt, ist veraltet: der Korpus muss nachgezogen werden.
  for (const fall of [...boese, ...gute]) {
    for (const b of fall.bekannt.filter((x) => filter(x.regel))) {
      const tritt = abweichungen.some((a) => a.kennung === fall.kennung && a.art === b.art && a.regel === b.regel && (!b.stufe || a.gefunden === b.stufe));
      if (!tritt) abweichungen.push({ kennung: fall.kennung, fallArt: fall.art, art: 'veraltet', regel: b.regel, erwartet: `bekannte Abweichung „${b.art}“`, gefunden: 'tritt nicht mehr auf', bekannt: false, grund: b.grund });
    }
  }

  const regeln = [...zeilen.values()].map((z) => ({
    ...z, trefferquote: quote(z.treffer, z.faelle), fehlalarmquote: quote(z.fehlalarme, z.gut),
  }));
  const summe = (k) => regeln.reduce((s, z) => s + z[k], 0);
  const gesamt = {
    boese: boese.length, gut: gute.length,
    erwartungen: summe('faelle'), treffer: summe('treffer'), uebersehen: summe('uebersehen'), falscheStufe: summe('falscheStufe'),
    trefferquote: quote(summe('treffer'), summe('faelle')),
    boeseKomplett: quote(boeseKomplett, boese.length),
    fehlalarme: summe('fehlalarme'),
    guteMitAlarm: quote(guteMitAlarm, gute.length),
    bekannt: abweichungen.filter((a) => a.bekannt).length,
    offen: abweichungen.filter((a) => !a.bekannt).length,
  };
  const ordnung = (a, b) => a.kennung.localeCompare(b.kennung) || a.regel.localeCompare(b.regel) || a.art.localeCompare(b.art);
  return { regeln, gesamt, abweichungen: abweichungen.sort(ordnung), zusatz: zusatz.sort(ordnung), ok: gesamt.offen === 0 };
}

/** Schickt einen geladenen Fall durch die Regeln, ohne Netz: Blob-Inhalte kommen aus dem Fall selbst. */
export async function pruefeFall(fall) {
  const ladeBytes = async (d, maxBytes) => (d._bytes ? d._bytes.subarray(0, maxBytes) : null);
  const { befunde } = await pruefeDateien(fall.dateien, { ladeBytes, kontext: { ...fall.kontext } });
  return befunde.map(({ regel, stufe, datei, zeile }) => ({ regel, stufe, datei, zeile }));
}

export async function fuehreAus(faelle) {
  const ergebnisse = new Map();
  for (const fall of faelle) ergebnisse.set(fall.kennung, await pruefeFall(fall));
  return ergebnisse;
}
