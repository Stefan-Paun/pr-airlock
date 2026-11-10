import { pruefeDateien, BINAER_ENDUNGEN } from './regeln/index.mjs';
import { endung } from './diff.mjs';
import { hoechsteStufe } from './befund.mjs';
import { ladeKonfig } from './konfig/schema.mjs';
import { wirksameKonfig, wendeKonfigAn } from './konfig/anwenden.mjs';
import { aenderungsBefund, ungueltigBefund, KONFIG_DATEI } from './konfig/aenderung.mjs';
import { MAX_BYTES } from './konfig/schema.mjs';

/**
 * Konfiguration des Basis-Stands: Text (oder null = es gibt keine) → geprüfte Konfiguration.
 * Kaputt oder nicht lesbar heißt: Standard gilt und ein Befund `konfig/ungueltig` (fail-closed).
 */
export function basisKonfig(text) {
  if (text == null) return { konfig: null, befunde: [], hinweise: [] };
  const r = ladeKonfig(Buffer.from(text).toString('utf8'));
  if (!r.konfig) return { konfig: null, befunde: [ungueltigBefund('Schema-Fehler', r.fehler)], hinweise: [] };
  return { konfig: r.konfig, befunde: [], hinweise: r.hinweise };
}

/** Gemeinsamer Schluss: Konfiguration anwenden, Konfig-Befunde anhängen, Meta bauen. */
function abschluss(ergebnis, { konfig, konfigBefunde, konfigHinweise = [], eingaben = {}, meta }) {
  const wirksam = wirksameKonfig(konfig, eingaben);
  const { befunde, unterdrueckt } = wendeKonfigAn(ergebnis.befunde, wirksam);
  const alle = [...befunde, ...konfigBefunde];
  const hinweise = [...ergebnis.hinweise, ...konfigHinweise];
  return {
    ...ergebnis, befunde: alle, hinweise, unterdrueckt,
    konfig: { quelle: wirksam.quelle, failOn: wirksam.failOn, failOnQuelle: wirksam.failOnQuelle },
    meta: { ...meta, hinweise, stufe: hoechsteStufe(alle) },
  };
}

/**
 * Prüft einen PR über die API: nie auschecken, nie ausführen, nur lesen.
 * Konfiguration kommt vom Ziel-Commit (base.sha), nie aus dem PR; ändert der PR die Datei, ist das ein Befund und die Änderung wirkt nicht.
 */
export async function pruefePr(gh, { owner, repo, nummer }, { log = () => {}, eingaben = {} } = {}) {
  const pr = await gh.pr(owner, repo, nummer);
  const dateien = await gh.prDateien(owner, repo, nummer);
  log(`${owner}/${repo}#${nummer}: ${dateien.length} Dateien, Head ${pr.head?.repo?.full_name || '?'}@${(pr.head?.sha || '').slice(0, 7)}`);

  let basis = { konfig: null, befunde: [], hinweise: [] };
  if (pr.base?.sha) {
    try { basis = basisKonfig(await gh.dateiAn(owner, repo, KONFIG_DATEI, pr.base.sha)); } catch (e) {
      basis = { konfig: null, befunde: [ungueltigBefund(`nicht lesbar: ${e.message}`)], hinweise: [] };
    }
  } else log('base.sha fehlt in der PR-Antwort – keine Konfiguration geladen');
  const konfigBefunde = [...basis.befunde];

  const angefasst = dateien.find((d) => d.filename === KONFIG_DATEI || d.previous_filename === KONFIG_DATEI);
  if (angefasst) {
    const weg = angefasst.status === 'removed' || angefasst.filename !== KONFIG_DATEI;
    let kopfText = null;
    if (!weg) { try { const b = await gh.blobBytes(owner, repo, angefasst.sha, MAX_BYTES + 1); kopfText = b ? Buffer.from(b).toString('utf8') : null; } catch { kopfText = null; } }
    konfigBefunde.push(aenderungsBefund({ basisKonfig: basis.konfig, kopfText, geloescht: weg }));
  }

  // head.repo ist null, wenn der Fork gelöscht wurde – das ist erst recht fremd.
  const ausFork = !pr.head?.repo || !pr.base?.repo || pr.head.repo.full_name !== pr.base.repo.full_name;
  const ladeBytes = (d, maxBytes) => gh.blobBytes(owner, repo, d.sha, maxBytes);
  const schwellen = wirksameKonfig(basis.konfig, eingaben).schwellen;
  const ergebnis = await pruefeDateien(dateien, { ladeBytes, kontext: { ausFork, erwarteteDateien: pr.changed_files, schwellen } });
  return abschluss(ergebnis, {
    konfig: basis.konfig, konfigBefunde, konfigHinweise: basis.hinweise.map((h) => `Konfiguration: ${h}`), eingaben,
    meta: { ziel: `${owner}/${repo}#${nummer}`, titel: pr.title, autor: pr.user?.login, ausFork, headSha: pr.head?.sha, dateien: dateien.length },
  });
}

/**
 * Prüft lokale Dateien: Textdateien zählen als komplett „hinzugefügt“, Binärdateien gehen nur durch die Magic-Byte-Prüfung.
 * `basisText`: Inhalt von .schleuse.json am Merge-Base (null = dort gibt es keine, undefined = nicht nachgeschlagen → keine Konfiguration).
 */
export async function pruefeLokal(dateien, { basisText, eingaben = {} } = {}) {
  const liste = dateien.map(({ pfad, bytes }) => {
    const binaer = BINAER_ENDUNGEN.has(endung(pfad)) || bytes.subarray(0, 512).includes(0);
    if (binaer) return { filename: pfad, status: 'added', additions: 0, deletions: 0, sha: null, _bytes: bytes };
    const zeilen = bytes.toString('utf8').split('\n');
    return { filename: pfad, status: 'added', additions: zeilen.length, deletions: 0, sha: null,
      patch: ['@@ -0,0 +1,' + zeilen.length + ' @@', ...zeilen.map((z) => '+' + z)].join('\n'), _bytes: bytes };
  });
  const basis = basisText === undefined ? { konfig: null, befunde: [], hinweise: [] } : basisKonfig(basisText);
  const konfigBefunde = [...basis.befunde];
  const angefasst = basisText === undefined ? null : liste.find((d) => d.filename === KONFIG_DATEI);
  if (angefasst && Buffer.compare(angefasst._bytes, basisText == null ? Buffer.alloc(0) : Buffer.from(basisText)) !== 0) {
    konfigBefunde.push(aenderungsBefund({ basisKonfig: basis.konfig, kopfText: angefasst._bytes.toString('utf8') }));
  }
  const schwellen = wirksameKonfig(basis.konfig, eingaben).schwellen;
  const ergebnis = await pruefeDateien(liste, { ladeBytes: async (d, maxBytes) => d._bytes.subarray(0, maxBytes), maxBlobs: Infinity, kontext: { schwellen } });
  return abschluss(ergebnis, { konfig: basis.konfig, konfigBefunde, konfigHinweise: basis.hinweise.map((h) => `Konfiguration: ${h}`), eingaben, meta: { ziel: 'local files', dateien: liste.length } });
}
