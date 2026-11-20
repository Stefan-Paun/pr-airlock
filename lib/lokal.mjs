// Lokaler Modus: dieselben Regeln wie beim API-Weg, aber die Dateien kommen aus git (nur lesend, nie ausführend).
// Erzeugt die Form { filename, status, additions, deletions, changes, patch?, sha, previous_filename? } wie /pulls/{n}/files.
import { realpathSync } from 'node:fs';
import { git, loeseRev, blobBytes, GitFehler } from './git.mjs';
import { pruefeDateien, BINAER_ENDUNGEN } from './regeln/index.mjs';
import { alsHinzugefuegt, abschluss, basisKonfig } from './pruefung.mjs';
import { wirksameKonfig } from './konfig/anwenden.mjs';
import { aenderungsBefund, ungueltigBefund, KONFIG_DATEI } from './konfig/aenderung.mjs';
import { MAX_BYTES } from './konfig/schema.mjs';
import { endung, saeuberePfad } from './diff.mjs';

export const MAX_DATEIEN_DIFF = 3000;          // wie GitHub: darüber meldet pruefeDateien „unvollständig“
export const MAX_DATEIEN_SCAN = 20000;
export const PATCH_DATEI = 1024 * 1024;        // größere Diffs werden nicht als Patch gelesen (Code wird dann ganz geprüft)
export const PATCH_GESAMT = 50 * 1024 * 1024;  // Summe aller gelesenen Patches/Texte
// Lokal kostet das Laden keine API-Anfragen: mehr Blobs und ein größeres Budget als beim API-Weg, aber weiter begrenzt.
export const LOKAL_GRENZEN = { maxBlobs: 5000, budget: 200 * 1024 * 1024 };
const STATUS = { A: 'added', M: 'modified', D: 'removed', R: 'renamed', C: 'copied', T: 'changed' };
const SHA = /^[0-9a-f]{40,64}$/;
const DIFF_OPT = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--ignore-submodules=all'];

/** Teilt NUL-getrennte Ausgabe (git -z) in Felder. */
const felder = (buf) => buf.toString('utf8').split('\0');

/** `a..b`, `a...b` oder eine Revision (= Kopf; Basis ist der Merge-Base mit dem Hauptzweig). */
export function zerlegeBereich(bereich) {
  const s = String(bereich ?? '');
  const drei = s.indexOf('...');
  if (drei >= 0) return { art: 'merge-base', a: s.slice(0, drei) || 'HEAD', b: s.slice(drei + 3) || 'HEAD' };
  const zwei = s.indexOf('..');
  if (zwei >= 0) return { art: 'direkt', a: s.slice(0, zwei) || 'HEAD', b: s.slice(zwei + 2) || 'HEAD' };
  return { art: 'gegen-hauptzweig', a: null, b: s || 'HEAD' };
}

async function mergeBase(repo, a, b) {
  const { bytes } = await git(repo, ['merge-base', a, b], { max: 1024 });
  const sha = bytes.toString('utf8').trim();
  if (!SHA.test(sha)) throw new GitFehler('Kein gemeinsamer Vorfahre gefunden.');
  return sha;
}

async function hauptzweig(repo, vorgabe) {
  const kandidaten = vorgabe ? [vorgabe] : ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master'];
  for (const k of kandidaten) {
    try { return await loeseRev(repo, k); } catch (e) { if (vorgabe) throw e; }
  }
  throw new GitFehler('Hauptzweig nicht gefunden (main/master). Mit --base <Revision> angeben.');
}

async function aufloesen(repo, bereich, basis) {
  const z = zerlegeBereich(bereich);
  if (z.art === 'gegen-hauptzweig') {
    const kopf = await loeseRev(repo, z.b);
    const haupt = await hauptzweig(repo, basis);
    return { basis: await mergeBase(repo, haupt, kopf), kopf, haupt };
  }
  const a = await loeseRev(repo, z.a);
  const b = await loeseRev(repo, z.b);
  return { basis: z.art === 'merge-base' ? await mergeBase(repo, a, b) : a, kopf: b };
}

/** Dateiliste wie die API: Status, Umbenennung, Zeilenzahlen, Binärdateien ohne Patch. */
export async function leseAenderungen(repo, bereich, { basis: basisRef = null, maxDateien = MAX_DATEIEN_DIFF, patchDatei = PATCH_DATEI, patchGesamt = PATCH_GESAMT } = {}) {
  const { basis, kopf, haupt } = await aufloesen(repo, bereich, basisRef);
  const art = zerlegeBereich(bereich).art;
  const bereichArgs = [...DIFF_OPT, basis, kopf, '--'];
  const raw = felder((await git(repo, ['diff', '--raw', '-z', '--no-abbrev', ...bereichArgs])).bytes);
  const num = felder((await git(repo, ['diff', '--numstat', '-z', ...bereichArgs])).bytes);

  // raw: ":altmodus neumodus altsha neusha STATUS" NUL pfad [NUL neuerpfad] NUL
  const eintraege = [];
  for (let i = 0; i < raw.length && raw[i].startsWith(':');) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(raw[i]);
    if (!m) throw new GitFehler('Unerwartete git-Ausgabe (raw).');
    const zweiPfade = m[5] === 'R' || m[5] === 'C';
    eintraege.push({ neuModus: m[2], sha: m[4], status: STATUS[m[5]] || 'changed', alt: zweiPfade ? raw[i + 1] : null, pfad: zweiPfade ? raw[i + 2] : raw[i + 1] });
    i += zweiPfade ? 3 : 2;
  }
  // numstat: "add\tdel\tpfad" NUL, bei Umbenennung "add\tdel\t" NUL alt NUL neu NUL
  const zahlen = [];
  for (let i = 0; i < num.length && /^(\d+|-)\t(\d+|-)\t/.test(num[i]);) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(num[i]);
    const binaer = m[1] === '-';
    zahlen.push({ add: binaer ? 0 : Number(m[1]), del: binaer ? 0 : Number(m[2]), binaer });
    i += m[3] === '' ? 3 : 1;
  }
  if (zahlen.length !== eintraege.length) throw new GitFehler('Unerwartete git-Ausgabe (numstat).');

  const hinweise = [];
  const dateien = [];
  let patchBytes = 0;
  let uebersprungen = 0;
  for (let i = 0; i < eintraege.length; i++) {
    const e = eintraege[i]; const z = zahlen[i];
    if (e.status !== 'removed' && (e.neuModus === '120000' || e.neuModus === '160000')) { uebersprungen++; continue; }
    if (dateien.length >= maxDateien) break;
    const d = { filename: e.pfad, status: e.status, additions: z.add, deletions: z.del, changes: z.add + z.del, sha: e.sha };
    if (e.alt != null) d.previous_filename = e.alt;
    const braucht = e.status !== 'removed' && !z.binaer && (z.add + z.del > 0);
    if (braucht && patchBytes < patchGesamt) {
      const pfade = e.alt != null ? [e.alt, e.pfad] : [e.pfad];
      const grenze = Math.min(patchDatei, patchGesamt - patchBytes);
      const { bytes, abgeschnitten } = await git(repo, ['diff', '--unified=3', ...bereichArgs, ...pfade], { max: grenze });
      if (!abgeschnitten) {
        const text = bytes.toString('utf8');
        const ab = text.search(/^@@ /m); // git-Kopfzeilen (diff, index, ---, +++) gehören nicht zum Patch
        if (ab >= 0) { d.patch = text.slice(ab).replace(/\n$/, ''); patchBytes += bytes.length; }
      }
    }
    dateien.push(d);
  }
  if (uebersprungen) hinweise.push(`${uebersprungen} Symlink(s)/Submodul(e) wurden nicht gelesen (nie verfolgt).`);
  return { dateien, basis, kopf, hinweise, gesamt: eintraege.length, art, haupt };
}


/** SHA des Blobs von .schleuse.json in `rev` (null = gibt es dort nicht). */
async function konfigBlob(repo, rev) {
  try {
    const sha = (await git(repo, ['rev-parse', '--verify', '--quiet', `${rev}:${KONFIG_DATEI}`], { max: 1024 })).bytes.toString('utf8').trim();
    return SHA.test(sha) ? sha : null;
  } catch { return null; }
}

/**
 * Konfiguration wie bei `pr`: gilt nur die .schleuse.json vom Basis-Stand (Merge-Base), nie die des geprüften Kopfs.
 * Unterscheidet sich die Datei im Kopf von der der Basis (geändert, neu, gelöscht, auch als Symlink), meldet das ein
 * Befund `konfig/aenderung`, und die Änderung wirkt nicht. `basis` = null: keine Basis bekannt, dann keine Konfiguration.
 */
async function leseKonfig(repo, basis, kopf) {
  if (!basis) return { basis: { konfig: null, befunde: [], hinweise: [] }, konfigBefunde: [] };
  const lies = async (sha) => {
    if (!sha) return null;
    const bytes = await blobBytes(repo, sha, MAX_BYTES + 1);
    return bytes ? bytes.toString('utf8') : null;
  };
  const basisSha = await konfigBlob(repo, basis);
  let b;
  try { b = basisKonfig(await lies(basisSha)); } catch (e) { b = { konfig: null, befunde: [ungueltigBefund(`nicht lesbar: ${e.message}`)], hinweise: [] }; }
  const konfigBefunde = [...b.befunde];
  const kopfSha = basis === kopf ? basisSha : await konfigBlob(repo, kopf);
  if (kopfSha !== basisSha) {
    let kopfText = null;
    try { kopfText = await lies(kopfSha); } catch { kopfText = null; }
    konfigBefunde.push(aenderungsBefund({ basisKonfig: b.konfig, kopfText, geloescht: kopfSha === null }));
  }
  return { basis: b, konfigBefunde };
}

/** Prüft einen Commit-Bereich. */
export async function pruefeDiff(repo, bereich, opts = {}) {
  const { log = () => {}, eingaben = {}, ...leseOpts } = opts;
  const { dateien, basis, kopf, hinweise, art, haupt } = await leseAenderungen(repo, bereich, leseOpts);
  log(`diff ${basis.slice(0, 7)}..${kopf.slice(0, 7)}: ${dateien.length} Dateien`);
  if (art === 'gegen-hauptzweig' && basis === kopf) {
    hinweise.push(`Keine Änderungen zu prüfen: ${bereich ? `„${bereich}“` : 'HEAD'} liegt im Hauptzweig (${haupt.slice(0, 7)}) oder ist er selbst, 0 Dateien. Für den letzten Commit: schleuse diff HEAD~1..HEAD. Für den ganzen Stand: schleuse scan.`);
  }
  const { basis: bk, konfigBefunde } = await leseKonfig(repo, basis, kopf);
  const schwellen = wirksameKonfig(bk.konfig, eingaben).schwellen;
  const ladeBytes = (d, maxBytes) => blobBytes(repo, d.sha, maxBytes);
  const ergebnis = await pruefeDateien(dateien, { ladeBytes, kontext: { ausFork: false, schwellen }, ...LOKAL_GRENZEN });
  return abschluss({ ...ergebnis, hinweise: [...hinweise, ...ergebnis.hinweise] }, {
    konfig: bk.konfig, konfigBefunde, konfigHinweise: bk.hinweise.map((h) => `Konfiguration: ${h}`), eingaben,
    meta: { ziel: `${basis.slice(0, 7)}..${kopf.slice(0, 7)}`, modus: 'diff', dateien: dateien.length },
  });
}

// Regeln, die nur für Änderungen etwas aussagen: im Scan ausgeschaltet und als „nicht anwendbar“ ausgewiesen.
export const NUR_AENDERUNG = [
  { id: 'projekt/workflow-aus-fork', grund: 'braucht einen Fork als Herkunft der Änderung' },
  { id: 'projekt/neues-skript-im-root', grund: 'braucht „neu hinzugefügt“ im Vergleich zu einem früheren Stand' },
  ...['lock-ohne-manifest', 'quelle-gewechselt', 'direkt-von-git-oder-url', 'install-skript', 'namensnaehe']
    .map((r) => ({ id: `lieferkette/${r}`, grund: 'vergleicht Abhängigkeiten mit dem Stand vor der Änderung' })),
];

async function ausfuehren(liste, parallel, fn) {
  const ergebnis = new Array(liste.length);
  let naechste = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, liste.length) }, async () => {
    while (naechste < liste.length) { const i = naechste++; ergebnis[i] = await fn(liste[i], i); }
  }));
  return ergebnis;
}

/** Liest alle von git verfolgten Dateien aus HEAD (Objektdatenbank, nicht aus dem Arbeitsverzeichnis). */
export async function leseVerfolgte(repo, { maxDateien = MAX_DATEIEN_SCAN, patchDatei = PATCH_DATEI, patchGesamt = PATCH_GESAMT } = {}) {
  const kopf = await loeseRev(repo, 'HEAD');
  const baum = (await git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', kopf])).bytes.toString('utf8').split('\0').filter(Boolean);
  const hinweise = [];
  let symlinks = 0; let nodeModules = 0;
  const kandidaten = [];
  for (const zeile of baum) {
    const t = zeile.indexOf('\t');
    const m = /^(\d+) (\w+) ([0-9a-f]+)\s+(-|\d+)$/.exec(zeile.slice(0, t));
    if (!m) throw new GitFehler('Unerwartete git-Ausgabe (ls-tree).');
    const pfad = zeile.slice(t + 1);
    if (m[2] !== 'blob') continue; // Submodule (commit) betreten wir nie
    if (m[1] === '120000') { symlinks++; continue; }
    if (pfad.split('/').includes('node_modules')) { nodeModules++; continue; }
    kandidaten.push({ pfad, sha: m[3], groesse: Number(m[4]) });
  }
  if (symlinks) hinweise.push(`${symlinks} Symlink(s) wurden nicht gelesen (nie verfolgt).`);
  if (nodeModules) hinweise.push(`${nodeModules} Datei(en) unter node_modules übersprungen.`);
  const liste = kandidaten.slice(0, maxDateien);
  let gelesen = 0;
  const dateien = await ausfuehren(liste, 8, async (k) => {
    const d = { filename: k.pfad, status: 'added', additions: 0, deletions: 0, sha: k.sha };
    if (BINAER_ENDUNGEN.has(endung(k.pfad)) || k.groesse > patchDatei || gelesen + k.groesse > patchGesamt) return d;
    gelesen += k.groesse; // vor dem await reservieren, damit parallele Leser das Gesamtlimit nicht überschreiten
    const bytes = await blobBytes(repo, k.sha, patchDatei);
    if (!bytes || bytes.subarray(0, 512).includes(0)) return d;
    return { ...d, ...alsHinzugefuegt(k.pfad, bytes) };
  });
  return { dateien, kopf, hinweise, gesamt: kandidaten.length };
}

/**
 * Prüft den Stand von HEAD aller verfolgten Dateien. `pfad` ist das Repo (oder ein Ordner darin).
 * Konfiguration: .schleuse.json vom Merge-Base von HEAD mit dem Hauptzweig (`opts.basis` oder origin/HEAD, main, master);
 * auf dem Hauptzweig selbst ist das HEAD. Ist kein Hauptzweig zu finden, gilt der Standard und ein Hinweis sagt es.
 */
export async function pruefeScan(repo, opts = {}) {
  const { log = () => {}, eingaben = {}, basis: basisRef = null, ...leseOpts } = opts;
  const { dateien, kopf, hinweise } = await leseVerfolgte(repo, leseOpts);
  log(`scan ${kopf.slice(0, 7)}: ${dateien.length} verfolgte Dateien`);
  let basis = null;
  try { basis = await mergeBase(repo, await hauptzweig(repo, basisRef), kopf); } catch (e) {
    hinweise.push(`Keine Basis für .schleuse.json gefunden (${e.message}); es gilt die Standard-Konfiguration. Mit --base <Revision> angeben.`);
  }
  const { basis: bk, konfigBefunde } = await leseKonfig(repo, basis, kopf);
  const schwellen = wirksameKonfig(bk.konfig, eingaben).schwellen;
  const ladeBytes = (d, maxBytes) => blobBytes(repo, d.sha, maxBytes);
  const ergebnis = await pruefeDateien(dateien, { ladeBytes, kontext: { ausFork: false, scan: true, schwellen }, ...LOKAL_GRENZEN, dateiLimit: (opts.maxDateien ?? MAX_DATEIEN_SCAN) });
  return abschluss({ ...ergebnis, hinweise: [...hinweise, ...ergebnis.hinweise] }, {
    konfig: bk.konfig, konfigBefunde, konfigHinweise: bk.hinweise.map((h) => `Konfiguration: ${h}`), eingaben,
    meta: { ziel: `scan ${kopf.slice(0, 7)}`, modus: 'scan', dateien: dateien.length, nichtAnwendbar: NUR_AENDERUNG },
  });
}

export const repoPfad = (p) => realpathSync(p || '.');
export { saeuberePfad };
