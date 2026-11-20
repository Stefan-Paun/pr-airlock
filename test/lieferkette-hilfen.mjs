// Testhilfen für die Lieferketten-Regeln: aus Vorher/Nachher-Text einen Unified Diff bauen, wie GitHub ihn liefert.
// Alle Paketnamen und Adressen in den Tests sind erfunden (Beispiel-Domains unter .example).

/** Unified Diff mit `kontext` Zeilen Kontext (LCS, für kleine Testdateien). */
export function einheitlicherDiff(altText, neuText, kontext = 3) {
  const a = altText === '' ? [] : altText.split('\n');
  const b = neuText === '' ? [] : neuText.split('\n');
  const n = a.length;
  const m = b.length;
  const l = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) l[i][j] = a[i] === b[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ art: ' ', text: a[i], ai: i++, bj: j++ }); continue; }
    if (j < m && (i >= n || l[i][j + 1] >= l[i + 1][j])) { ops.push({ art: '+', text: b[j], ai: i, bj: j++ }); continue; }
    ops.push({ art: '-', text: a[i], ai: i++, bj: j });
  }
  const aenderungen = ops.map((o, k) => (o.art !== ' ' ? k : -1)).filter((k) => k >= 0);
  if (!aenderungen.length) return '';
  // Bereiche zusammenfassen, die sich mit Kontext überlappen
  const bereiche = [];
  for (const k of aenderungen) {
    const von = Math.max(0, k - kontext);
    const bis = Math.min(ops.length - 1, k + kontext);
    const letzter = bereiche[bereiche.length - 1];
    if (letzter && von <= letzter.bis + 1) letzter.bis = Math.max(letzter.bis, bis);
    else bereiche.push({ von, bis });
  }
  const out = [];
  for (const { von, bis } of bereiche) {
    const teil = ops.slice(von, bis + 1);
    const altAnz = teil.filter((o) => o.art !== '+').length;
    const neuAnz = teil.filter((o) => o.art !== '-').length;
    const altStart = altAnz ? teil.find((o) => o.art !== '+').ai + 1 : teil[0].ai;
    const neuStart = neuAnz ? teil.find((o) => o.art !== '-').bj + 1 : teil[0].bj;
    out.push(`@@ -${altStart},${altAnz} +${neuStart},${neuAnz} @@`);
    for (const o of teil) out.push(o.art + o.text);
  }
  return out.join('\n');
}

/** Datei im API-Format aus Vorher/Nachher; `alt === null` heißt neu hinzugefügt. */
export function aenderung(filename, alt, neu, extra = {}) {
  const patch = einheitlicherDiff(alt ?? '', neu);
  const add = patch.split('\n').filter((z) => z.startsWith('+')).length;
  const del = patch.split('\n').filter((z) => z.startsWith('-')).length;
  return { filename, status: alt == null ? 'added' : 'modified', additions: add, deletions: del, changes: add + del, patch, sha: 'c'.repeat(40), ...extra };
}

export const json = (o) => JSON.stringify(o, null, 2);

/** package-lock.json v3 aus { 'node_modules/x': { version, resolved, integrity, hasInstallScript? } }. */
export function npmLock(pakete, { name = 'beispiel-app', lockfileVersion = 3, abhaengig = {} } = {}) {
  return json({ name, version: '1.0.0', lockfileVersion, requires: true, packages: { '': { name, version: '1.0.0', dependencies: abhaengig }, ...pakete } });
}

export const reg = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
export const integ = (zeichen, alg = 'sha512') => `${alg}-${zeichen.repeat(alg === 'sha1' ? 27 : 86)}==`;
