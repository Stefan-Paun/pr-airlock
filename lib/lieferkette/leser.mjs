// Leser für Manifeste und Lockfiles – nur so tief wie für die Lieferketten-Regeln nötig.
// Grundlage ist der Diff, nicht die ganze Datei: Jeder Hunk wird als Vorher- und Nachher-Ausschnitt gelesen.
// Fehlertolerant: Was sich keinem Paket sicher zuordnen lässt, zählt als „unklar“ und wird nicht geraten.
// Fremdtext wird nur zerlegt, nie ausgewertet (kein eval, kein YAML-Parser, JSON.parse nur auf ganze Manifeste).

import { dateiname } from '../diff.mjs';

/** Unified diff → Hunks mit Zeilen { art: ' ' | '+' | '-', text, alt, neu }. */
export function hunks(patch = '') {
  const out = [];
  let h = null;
  let alt = 0;
  let neu = 0;
  for (const roh of String(patch).split('\n')) {
    const kopf = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(roh);
    if (kopf) {
      alt = Number(kopf[1]); neu = Number(kopf[3]);
      h = { altStart: alt, altAnzahl: kopf[2] == null ? 1 : Number(kopf[2]), neuStart: neu, neuAnzahl: kopf[4] == null ? 1 : Number(kopf[4]), zeilen: [] };
      out.push(h);
      continue;
    }
    if (!h || roh.startsWith('\\')) continue;
    if (roh.startsWith('+')) h.zeilen.push({ art: '+', text: roh.slice(1), alt: null, neu: neu++ });
    else if (roh.startsWith('-')) h.zeilen.push({ art: '-', text: roh.slice(1), alt: alt++, neu: null });
    else h.zeilen.push({ art: ' ', text: roh.slice(1), alt: alt++, neu: neu++ });
  }
  return out;
}

/** Ein Hunk aus einer Seite gesehen: Kontext plus entfernte (vorher) bzw. hinzugefügte (nachher) Zeilen. */
export function seite(hunk, welche) {
  const art = welche === 'vorher' ? '-' : '+';
  return hunk.zeilen.filter((z) => z.art === ' ' || z.art === art)
    .map((z) => ({ text: z.text, geaendert: z.art !== ' ', zeile: welche === 'vorher' ? z.alt : z.neu }));
}

/**
 * Wendet den Patch rückwärts auf den Kopf-Stand an und liefert den Basis-Stand – oder null, wenn der Patch nicht
 * genau passt (Kontext weicht ab, Patch abgeschnitten). Dann ist der Vorher-Stand „nicht prüfbar“.
 */
export function rueckwaerts(neuText, patch) {
  const neu = String(neuText).split('\n');
  const alt = [];
  let pos = 0; // Index in neu (0-basiert)
  for (const h of hunks(patch)) {
    const bis = h.neuAnzahl === 0 ? h.neuStart : h.neuStart - 1; // bei leerer Neu-Seite zeigt die Startzahl auf die Zeile davor
    if (bis < pos || bis > neu.length) return null;
    while (pos < bis) alt.push(neu[pos++]);
    for (const z of h.zeilen) {
      if (z.art === '-') { alt.push(z.text); continue; }
      if (neu[pos] !== z.text) return null;
      if (z.art === ' ') alt.push(z.text);
      pos++;
    }
  }
  if (pos > neu.length) return null;
  while (pos < neu.length) alt.push(neu[pos++]);
  return alt.join('\n');
}

const einzug = (t) => /^[ \t]*/.exec(t)[0].replace(/\t/g, '  ').length;
const leer = (t) => !t.trim();

// ---------------------------------------------------------------- package.json

export const ABSCHNITTE = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
// Überschreibungen lenken ebenfalls auf eine Quelle um (npm overrides, yarn resolutions, pnpm.overrides) – nur für die Quellen-Prüfung.
export const UEBERSCHREIBUNGEN = ['overrides', 'resolutions'];
const schluesselVon = (abschnitt, name) => `${abschnitt}\u0000${name}`;

/**
 * Ganzes Manifest → Map (abschnitt + name) → { name, spec, abschnitt } (oder null, wenn es kein lesbares JSON-Objekt ist).
 * Jeder Abschnitt zählt für sich: optionalDependencies überschreibt bei npm dependencies, also darf keiner den anderen verdecken.
 */
export function leseManifest(text) {
  let j;
  try { j = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const m = new Map();
  const nimm = (abschnitt, obj, tiefe = 0) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || tiefe > 8) return;
    for (const [name, spec] of Object.entries(obj)) {
      if (typeof spec === 'string') m.set(schluesselVon(abschnitt, name), { name, spec, abschnitt });
      else if (UEBERSCHREIBUNGEN.includes(abschnitt)) nimm(abschnitt, spec, tiefe + 1); // npm overrides dürfen verschachteln
    }
  };
  for (const abschnitt of [...ABSCHNITTE, ...UEBERSCHREIBUNGEN]) nimm(abschnitt, j[abschnitt]);
  if (j.pnpm && typeof j.pnpm === 'object') nimm('overrides', j.pnpm.overrides);
  return m;
}

const ABSCHNITT_KOPF = new RegExp(`^\\s*"(${[...ABSCHNITTE, ...UEBERSCHREIBUNGEN].join('|')})"\\s*:\\s*\\{\\s*(\\}\\s*,?\\s*)?$`);
const EINTRAG = /^\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/;

/**
 * Abhängigkeiten, die in einer Seite eines Hunks zu sehen sind. Der Abschnitt wird aus dem Kontext gelesen;
 * steht sein Kopf außerhalb des Hunks, ist eine geänderte Zeile „unklar“.
 */
function manifestSeite(zeilen) {
  const eintraege = [];
  let unklar = 0;
  let zustand = 'unbekannt'; // 'unbekannt' | 'aussen' | Abschnittsname
  let kopfEinzug = -1;
  for (const z of zeilen) {
    if (leer(z.text)) continue;
    const k = ABSCHNITT_KOPF.exec(z.text);
    if (k) { zustand = k[2] ? 'aussen' : k[1]; kopfEinzug = einzug(z.text); continue; }
    const e = EINTRAG.exec(z.text);
    if (zustand !== 'unbekannt' && zustand !== 'aussen') {
      if (einzug(z.text) <= kopfEinzug) { zustand = 'aussen'; }
      else if (e) { eintraege.push({ name: e[1], spec: e[2], abschnitt: zustand, zeile: z.zeile, geaendert: z.geaendert }); continue; }
      else continue;
    }
    if (zustand === 'unbekannt') {
      if (/[{[]\s*$/.test(z.text) && einzug(z.text) <= 2) { zustand = 'aussen'; continue; }
      // Eine geänderte Zeile, die wie eine Abhängigkeit aussieht, ohne bekannten Abschnitt: nicht raten.
      if (z.geaendert && e && einzug(z.text) >= 4) unklar++;
    }
  }
  return { eintraege, unklar };
}

/**
 * Was ein Patch an package.json an den Abhängigkeiten ändert.
 * Mit `kopfText` (ganzer Kopf-Stand) wird der Basis-Stand exakt rekonstruiert; sonst nur aus den Hunks.
 * → { vorher: Map, nachher: Map (Schlüssel Abschnitt + Name, Wert { name, spec, abschnitt }), neu: [{ name, spec, abschnitt, zeile }], geaendert: [...], vollstaendig, unklar }
 */
export function manifestAenderung(patch, { kopfText = null, hinzugefuegt = false } = {}) {
  if (kopfText != null) {
    const nachher = leseManifest(kopfText);
    const altText = hinzugefuegt ? '{}' : rueckwaerts(kopfText, patch);
    const vorher = altText == null ? null : leseManifest(altText);
    if (nachher && vorher) {
      const zeilen = String(kopfText).split('\n');
      const zeileVon = (name) => {
        const i = zeilen.findIndex((t) => t.includes(JSON.stringify(name)) && EINTRAG.test(t));
        return i < 0 ? null : i + 1;
      };
      const neu = [];
      const geaendert = [];
      for (const [k, n] of nachher) {
        const v = vorher.get(k);
        if (!v) neu.push({ ...n, zeile: zeileVon(n.name) });
        else if (v.spec !== n.spec) geaendert.push({ ...n, vorher: v.spec, zeile: zeileVon(n.name) });
      }
      return { vorher, nachher, neu, geaendert, vollstaendig: true, unklar: 0 };
    }
  }
  // Nur aus dem Diff: Namen, die auf der Vorher-Seite stehen, gelten als vorhanden.
  const vorher = new Map();
  const nachher = new Map();
  let unklar = 0;
  const nachherListe = [];
  for (const h of hunks(patch)) {
    const v = manifestSeite(seite(h, 'vorher'));
    const n = manifestSeite(seite(h, 'nachher'));
    unklar += n.unklar + v.unklar;
    for (const e of v.eintraege) vorher.set(schluesselVon(e.abschnitt, e.name), { name: e.name, spec: e.spec, abschnitt: e.abschnitt });
    for (const e of n.eintraege) { nachher.set(schluesselVon(e.abschnitt, e.name), { name: e.name, spec: e.spec, abschnitt: e.abschnitt }); nachherListe.push(e); }
  }
  const neu = [];
  const geaendert = [];
  for (const e of nachherListe) {
    if (!e.geaendert) continue;
    const v = vorher.get(schluesselVon(e.abschnitt, e.name));
    const eintrag = { name: e.name, spec: e.spec, abschnitt: e.abschnitt, zeile: e.zeile };
    if (!v) neu.push(eintrag);
    else if (v.spec !== e.spec) geaendert.push({ ...eintrag, vorher: v.spec });
  }
  return { vorher, nachher, neu, geaendert, vollstaendig: false, unklar };
}

// ---------------------------------------------------------------- Lockfiles

/** Welches Lockfile-Format eine Datei hat (oder null). */
export function lockFormat(pfad) {
  const n = dateiname(pfad);
  if (n === 'package-lock.json' || n === 'npm-shrinkwrap.json') return 'npm';
  if (n === 'yarn.lock') return 'yarn';
  if (n === 'pnpm-lock.yaml') return 'pnpm';
  return null;
}

// Paketname aus "lodash@^4.17.21" bzw. "@scope/name@npm:^1.0.0" (Teil vor dem letzten @, das nicht am Anfang steht).
function nameAusSpec(spec) {
  const s = spec.trim().replace(/^["']|["']$/g, '');
  const i = s.indexOf('@', 1);
  return i < 0 ? s : s.slice(0, i);
}

// pnpm-Schlüssel: "/foo/1.0.0" (v5), "/foo@1.0.0(peer@1)" (v6), "foo@1.0.0" (v9), mit Scope.
export function pnpmSchluessel(roh) {
  let s = roh.trim().replace(/^["']|["']$/g, '').replace(/^\//, '').replace(/\(.*$/, '');
  let scope = '';
  if (s.startsWith('@')) { const i = s.indexOf('/'); if (i < 0) return null; scope = s.slice(0, i + 1); s = s.slice(i + 1); }
  let m = /^([^@/\s]+)@([^@/\s]+)$/.exec(s) || /^([^@/\s]+)\/(\d[^@/\s]*)$/.exec(s);
  if (!m || !/^\d/.test(m[2])) return null;
  return { name: scope + m[1], version: m[2] };
}

// npm: Kopf eines Eintrags. v2/v3 "node_modules/…", v1 (und der Legacy-Abschnitt in v2) nur der Paketname.
const NPM_OBJEKT = /^\s*"([^"]+)"\s*:\s*\{\s*$/;
const NPM_EINZEILER = /^\s*"([^"]+)"\s*:\s*(\{.*\})\s*,?\s*$/;
// Ohne verschachtelte Quantoren auf derselben Zeichenklasse (kein Backtracking-Fraß auf Fremdtext).
const NPM_FELD = /^\s*"(version|resolved|integrity|hasInstallScript)"\s*:\s*(?:"([^"]*)"|(true|false))\s*,?\s*$/;
const NPM_STRUKTUR = new Set(['', 'packages', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'requires', 'engines', 'bin', 'funding', 'directories', 'overrides', 'workspaces', 'cpu', 'os', 'libc', 'bundleDependencies', 'bundledDependencies']);
const PAKETNAME = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const YARN_FELD = /^\s+"?(version|resolved|integrity|resolution|checksum)"?(?:\s*:\s*|\s+)"?([^"\s]+)"?\s*$/;

function npmSchluessel(roh, akt) {
  const i = roh.lastIndexOf('node_modules/');
  if (i >= 0) { const name = roh.slice(i + 'node_modules/'.length); return PAKETNAME.test(name) ? { schluessel: roh, name } : null; }
  // v1: nur außerhalb eines v2-Eintrags (sonst wäre z. B. peerDependenciesMeta.x ein „Paket“)
  if ((akt && !akt.v1) || NPM_STRUKTUR.has(roh) || !PAKETNAME.test(roh)) return null;
  return { schluessel: roh, name: roh, v1: true };
}

// Felder aus einem einzeiligen JSON-Objekt (umformatierter Lock: {"version":…,"resolved":…}).
function npmEinzeiler(json) {
  let o;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const f = {};
  for (const k of ['version', 'resolved', 'integrity']) if (typeof o[k] === 'string') f[k] = o[k];
  if (o.hasInstallScript === true) f.install = true;
  return f;
}

// pnpm-Schlüssel ohne Version: "foo@https://…" (v9-Tarball), "github.com/u/r/<sha>" (v6-git).
function pnpmAdressSchluessel(roh) {
  const s = roh.trim().replace(/^["']|["']$/g, '').replace(/^\//, '');
  const i = s.indexOf('@', s.startsWith('@') ? 1 : 0);
  if (i > 0) {
    const rest = s.slice(i + 1);
    if (/^(?:https?:|git\+|git:|github:|gitlab:|bitbucket:|ssh:|file:|link:)/i.test(rest)) return { name: s.slice(0, i), resolved: rest };
  }
  if (/^[\w-]+(?:\.[\w-]+)+\//.test(s)) return { name: s, resolved: 'git+https://' + s };
  return null;
}

// Kopfzeile eines Eintrags je Format → { schluessel, name, version?, felder? } oder null.
function kopf(format, t, akt) {
  if (format === 'npm') {
    const m = NPM_OBJEKT.exec(t);
    if (m) return npmSchluessel(m[1], akt);
    const e = NPM_EINZEILER.exec(t);
    if (!e) return null;
    const k = npmSchluessel(e[1], akt);
    const f = k && npmEinzeiler(e[2]);
    return k && f ? { ...k, felder: f, einzeilig: true } : null;
  }
  if (format === 'yarn') {
    if (/^\s|^#/.test(t) || !/:\s*$/.test(t)) return null;
    const erster = t.replace(/:\s*$/, '').split(',')[0];
    const name = nameAusSpec(erster);
    if (!name || name === '__metadata') return null;
    return { schluessel: name, name };
  }
  if (format === 'pnpm') {
    const m = /^ {2}(\S.*?):\s*$/.exec(t);
    if (!m) return null;
    const k = pnpmSchluessel(m[1]);
    if (k) return { schluessel: k.name, name: k.name, version: k.version };
    const a = pnpmAdressSchluessel(m[1]);
    return a ? { schluessel: a.name, name: a.name, felder: { resolved: a.resolved } } : null;
  }
  return null;
}

// Felder einer Zeile innerhalb eines Eintrags → { version?, resolved?, integrity?, install? }.
function felder(format, t) {
  if (format === 'npm') {
    const m = NPM_FELD.exec(t);
    if (!m) return null;
    if (m[1] === 'hasInstallScript') return (m[3] ?? m[2]) === 'true' ? { install: true } : {};
    return m[2] == null ? null : { [m[1]]: m[2] };
  }
  if (format === 'yarn') {
    const m = YARN_FELD.exec(t);
    if (!m) return null;
    if (m[1] === 'resolution') {
      // Berry: "name@npm:1.2.3" ist Registry; "name@https://…", "name@git+…" ist eine Adresse.
      const rest = m[2].slice(nameAusSpec(m[2]).length + 1);
      return /^npm:/.test(rest) ? {} : { resolved: rest };
    }
    if (m[1] === 'checksum') return { integrity: m[2] };
    if (m[1] === 'resolved') return { resolved: m[2].replace(/#[0-9a-f]{40}$/i, '') };
    return { [m[1]]: m[2] };
  }
  if (format === 'pnpm') {
    const f = {};
    const integ = /\bintegrity:\s*([A-Za-z0-9+/=_-]+)/.exec(t);
    const tar = /\btarball:\s*([^,}\s]+)/.exec(t);
    const repo = /\brepo:\s*([^,}\s]+)/.exec(t);
    if (integ) f.integrity = integ[1];
    if (tar) f.resolved = tar[1];
    if (repo) f.resolved = repo[1].startsWith('git') ? repo[1] : 'git+' + repo[1];
    if (/^\s*requiresBuild:\s*true\s*$/.test(t)) f.install = true;
    const v = /^\s*version:\s*'?([^'\s]+)'?\s*$/.exec(t);
    if (v) f.version = v[1];
    return Object.keys(f).length ? f : null;
  }
  return null;
}

// Grenzen eines Eintrags: npm schließt mit einer Zeile auf Kopfeinzug, YAML-artige mit jeder Zeile auf Kopfeinzug.
function lockSeite(format, zeilen) {
  const eintraege = [];
  let unklar = 0;
  let akt = null;
  let zustand = 'unbekannt';
  for (const z of zeilen) {
    if (leer(z.text)) continue;
    const e = einzug(z.text);
    if (akt && e <= akt.kopfEinzug) { akt = null; zustand = 'aussen'; }
    const k = kopf(format, z.text, akt);
    if (k) {
      const eintrag = { ...k, kopfEinzug: e, feldEinzug: null, neu: z.geaendert, geaendert: z.geaendert, zeile: z.zeile, felder: { ...(k.felder || {}) }, geaenderteFelder: new Set() };
      if (z.geaendert) for (const schl of Object.keys(eintrag.felder)) eintrag.geaenderteFelder.add(schl);
      eintraege.push(eintrag);
      akt = k.einzeilig ? null : eintrag;
      zustand = k.einzeilig ? 'aussen' : 'drin';
      continue;
    }
    if (format === 'yarn' && !akt && e === 0) zustand = 'aussen';
    if (format === 'pnpm' && !akt && e <= 2) zustand = 'aussen';
    if (format === 'npm' && !akt && zustand === 'unbekannt' && /[{[]\s*$/.test(z.text) && e <= 4) zustand = 'aussen';
    const f = felder(format, z.text);
    if (akt) {
      if (akt.feldEinzug == null) akt.feldEinzug = e;
      // pnpm schreibt resolution manchmal mehrzeilig; dort zählen auch tiefere Zeilen. Sonst nur die eigene Ebene.
      if (f && (e === akt.feldEinzug || format === 'pnpm')) {
        for (const [schl, wert] of Object.entries(f)) {
          if (akt.felder[schl] == null) akt.felder[schl] = wert;
          if (z.geaendert) akt.geaenderteFelder.add(schl);
        }
      }
      if (z.geaendert) akt.geaendert = true;
      continue;
    }
    // Nur sicherheitsrelevante Felder ohne Paketkopf zählen; eine Versionszeile allein (pnpm-importers) nicht.
    if (zustand === 'unbekannt' && z.geaendert && f && (f.resolved != null || f.integrity != null || f.install)) unklar++;
  }
  return { eintraege, unklar };
}

/**
 * Was ein Patch an einem Lockfile ändert, gruppiert nach Paket – über alle Hunks der Datei hinweg,
 * damit ein Eintrag, der an eine andere Stelle verschoben und dabei verändert wird, als Änderung erkannt wird.
 * → { paare: [{ schluessel, name, vorher, nachher }], unklar, hostsVorher: Set, formatWechsel, cacheWechsel }
 * vorher/nachher: { version, resolved, integrity, install, neu, geaenderteFelder } oder null.
 */
export function lockAenderung(patch, format) {
  const paare = [];
  let unklar = 0;
  const hostsVorher = new Set();
  const alleV = [];
  const alleN = [];
  let formatWechsel = false;
  let cacheWechsel = false;
  for (const h of hunks(patch)) {
    const v = lockSeite(format, seite(h, 'vorher'));
    const n = lockSeite(format, seite(h, 'nachher'));
    unklar += v.unklar + n.unklar;
    alleV.push(...v.eintraege);
    alleN.push(...n.eintraege);
    for (const z of h.zeilen) {
      if (z.art === ' ') continue;
      if (/^\s*"?lockfileVersion"?\s*:/.test(z.text)) formatWechsel = true;
      if (/^\s*cacheKey\s*:/.test(z.text)) cacheWechsel = true;
    }
  }
  for (const e of alleV) { const q = quelle(e.felder.resolved); if (q.host) hostsVorher.add(q.host); }
  const offen = alleV.filter((e) => e.geaendert);
  for (const e of alleN) {
    if (!e.geaendert) continue;
    // Gegenstück: gleicher Schlüssel, bei mehreren bevorzugt gleiche Version.
    let i = offen.findIndex((x) => x.schluessel === e.schluessel && x.felder.version && x.felder.version === (e.felder.version ?? e.version));
    if (i < 0) i = offen.findIndex((x) => x.schluessel === e.schluessel);
    let gegen = i >= 0 ? offen.splice(i, 1)[0] : null;
    // Kopf im Kontext, aber kein geänderter Vorher-Eintrag: die Vorher-Seite ist der Kontext selbst
    if (!gegen && !e.neu) gegen = alleV.find((x) => x.schluessel === e.schluessel) || null;
    paare.push({ schluessel: e.schluessel, name: e.name, vorher: gegen ? flach(gegen) : null, nachher: flach(e) });
  }
  for (const rest of offen) paare.push({ schluessel: rest.schluessel, name: rest.name, vorher: flach(rest), nachher: null });
  return { paare, unklar, hostsVorher, formatWechsel, cacheWechsel };
}

function flach(e) {
  return {
    version: e.felder.version ?? e.version ?? null, resolved: e.felder.resolved ?? null, integrity: e.felder.integrity ?? null,
    install: !!e.felder.install, neu: e.neu, geaenderteFelder: e.geaenderteFelder, zeile: e.zeile,
  };
}

// ---------------------------------------------------------------- Quellen

// Öffentliche npm-Registry unter ihren gleichwertigen Namen.
export const NPM_REGISTRY = new Set(['registry.npmjs.org', 'registry.yarnpkg.com', 'registry.npmjs.com']);

/**
 * Art einer Quelle (resolved-Adresse oder Versions-Angabe):
 * 'registry' (https-Host), 'git', 'http' (unverschlüsselt), 'datei' (file:/link:/Pfad), 'leer'; dazu host (normalisiert).
 */
export function quelle(adresse) {
  if (adresse == null || adresse === '') return { art: 'leer', host: null };
  const a = String(adresse).trim();
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:|ssh:)/i.test(a)) return { art: 'git', host: hostVon(a.replace(/^git\+/i, '')) };
  if (/^(?:file:|link:|\.{1,2}\/|\/)/i.test(a) || (!/^[a-z][a-z0-9+.-]*:/i.test(a) && !a.includes('://'))) return { art: 'datei', host: null };
  if (/^http:\/\//i.test(a)) return { art: 'http', host: hostVon(a) };
  if (/^https:\/\//i.test(a)) {
    const host = hostVon(a);
    return { art: 'registry', host: host && NPM_REGISTRY.has(host) ? 'npm' : host };
  }
  return { art: 'unbekannt', host: hostVon(a) };
}

function hostVon(a) {
  try { return new URL(a).hostname.toLowerCase() || null; } catch { return null; }
}

/** Algorithmus eines Integritätswerts ("sha512-…" → "sha512", Berry "10c0/…" → "berry-10c0", reiner Hex-Wert → "hex"). */
export function algorithmus(wert) {
  const w = String(wert || '');
  const sri = /^(sha\d+)-/i.exec(w);
  if (sri) return sri[1].toLowerCase();
  const berry = /^(\w+)\/[0-9a-f]+$/i.exec(w);
  if (berry) return `berry-${berry[1]}`;
  return /^[0-9a-f]+$/i.test(w) ? 'hex' : null;
}
