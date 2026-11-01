import { pruefeDateien, BINAER_ENDUNGEN } from './regeln/index.mjs';
import { endung } from './diff.mjs';
import { hoechsteStufe } from './befund.mjs';

/** Prüft einen PR über die API: nie auschecken, nie ausführen, nur lesen. */
export async function pruefePr(gh, { owner, repo, nummer }, { log = () => {} } = {}) {
  const pr = await gh.pr(owner, repo, nummer);
  const dateien = await gh.prDateien(owner, repo, nummer);
  log(`${owner}/${repo}#${nummer}: ${dateien.length} Dateien, Head ${pr.head?.repo?.full_name || '?'}@${(pr.head?.sha || '').slice(0, 7)}`);
  const ausFork = Boolean(pr.head?.repo && pr.base?.repo && pr.head.repo.full_name !== pr.base.repo.full_name);
  const ladeBytes = (d) => gh.blobBytes(owner, repo, d.sha);
  const ergebnis = await pruefeDateien(dateien, { ladeBytes, kontext: { ausFork } });
  return {
    ...ergebnis,
    meta: { ziel: `${owner}/${repo}#${nummer}`, titel: pr.title, autor: pr.user?.login, ausFork, headSha: pr.head?.sha, dateien: dateien.length, hinweise: ergebnis.hinweise, stufe: hoechsteStufe(ergebnis.befunde) },
  };
}

/** Prüft lokale Dateien: Textdateien zählen als komplett „hinzugefügt“, Binärdateien gehen nur durch die Magic-Byte-Prüfung. */
export async function pruefeLokal(dateien) {
  const liste = dateien.map(({ pfad, bytes }) => {
    const binaer = BINAER_ENDUNGEN.has(endung(pfad)) || bytes.subarray(0, 512).includes(0);
    if (binaer) return { filename: pfad, status: 'added', additions: 0, deletions: 0, sha: null, _bytes: bytes };
    const zeilen = bytes.toString('utf8').split('\n');
    return { filename: pfad, status: 'added', additions: zeilen.length, deletions: 0, sha: null,
      patch: ['@@ -0,0 +1,' + zeilen.length + ' @@', ...zeilen.map((z) => '+' + z)].join('\n'), _bytes: bytes };
  });
  const ergebnis = await pruefeDateien(liste, { ladeBytes: async (d) => d._bytes });
  return { ...ergebnis, meta: { ziel: 'local files', dateien: liste.length, hinweise: ergebnis.hinweise, stufe: hoechsteStufe(ergebnis.befunde) } };
}
