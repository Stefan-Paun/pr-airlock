// Leser für Manifeste und Lockfiles: je Format Normalfall, Teil-Sicht aus dem Diff und kaputte Eingaben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hunks, rueckwaerts, leseManifest, manifestAenderung, lockAenderung, lockFormat, pnpmSchluessel, quelle, algorithmus } from '../lib/lieferkette/leser.mjs';
import { einheitlicherDiff, json, npmLock, reg, integ } from './lieferkette-hilfen.mjs';

test('Diff-Hilfe und Rückwärts-Anwenden: Basis-Stand wird exakt rekonstruiert', () => {
  const alt = Array.from({ length: 30 }, (_, i) => `zeile ${i}`).join('\n');
  const neu = alt.replace('zeile 3\n', 'zeile 3\nneu A\n').replace('zeile 20', 'zeile 20 geändert').replace('zeile 27\n', '');
  const p = einheitlicherDiff(alt, neu);
  assert.equal(hunks(p).length, 2);
  assert.equal(rueckwaerts(neu, p), alt);
  assert.equal(rueckwaerts('a\nb', einheitlicherDiff('', 'a\nb')), '');
  assert.equal(rueckwaerts(neu.replace('zeile 20 geändert', 'anders'), p), null, 'Kontext passt nicht → null statt raten');
  assert.equal(rueckwaerts('kurz', p), null);
});

test('Manifest: ganzes JSON und kaputte Eingaben', () => {
  const m = leseManifest(json({ dependencies: { a: '^1.0.0' }, devDependencies: { b: '2.0.0', a: '9' }, scripts: { x: 'y' } }));
  assert.deepEqual([...m.values()].map((x) => `${x.abschnitt}:${x.name}`), ['dependencies:a', 'devDependencies:b', 'devDependencies:a'], 'jeder Abschnitt zählt für sich');
  const ueber = leseManifest(json({ overrides: { a: { b: 'git+https://code.example/b.git' } }, resolutions: { '**/c': '1.0.0' }, pnpm: { overrides: { d: 'file:../d' } } }));
  assert.deepEqual([...ueber.values()].map((x) => `${x.abschnitt}:${x.name}`), ['overrides:b', 'resolutions:**/c', 'overrides:d']);
  for (const kaputt of ['{', '', '[]', 'null', '"text"', '{"dependencies": [1]}']) {
    const r = leseManifest(kaputt);
    assert.ok(r === null || r.size === 0, kaputt);
  }
});

test('Manifest-Änderung: mit Kopf-Stand exakt, ohne nur aus den Hunks', () => {
  const vorher = { name: 'x', version: '1.0.0', scripts: { test: 'node --test' }, dependencies: { 'alpha-lib': '^1.0.0', 'beta-lib': '^2.0.0', 'eps-lib': '^5.0.0' }, devDependencies: { 'test-kit': '^1.0.0' } };
  const nachher = structuredClone(vorher);
  nachher.dependencies['eps-lib'] = '^5.1.0';
  nachher.dependencies['zeta-lib'] = '^1.0.0';
  const a = json(vorher);
  const b = json(nachher);
  const p = einheitlicherDiff(a, b);
  const voll = manifestAenderung(p, { kopfText: b });
  assert.equal(voll.vollstaendig, true);
  assert.deepEqual(voll.neu.map((x) => x.name), ['zeta-lib']);
  assert.deepEqual(voll.geaendert.map((x) => [x.name, x.vorher, x.spec]), [['eps-lib', '^5.0.0', '^5.1.0']]);
  assert.ok([...voll.vorher.values()].some((x) => x.name === 'alpha-lib'));
  const teil = manifestAenderung(p);
  assert.equal(teil.vollstaendig, false);
  assert.deepEqual(teil.neu.map((x) => [x.name, x.abschnitt]), [['zeta-lib', 'dependencies']]);
  assert.deepEqual(teil.geaendert.map((x) => x.name), ['eps-lib']);
  // Kopf-Stand passt nicht zum Patch → Rückfall auf die Hunks
  const falsch = manifestAenderung(p, { kopfText: json({ ganz: 'anders' }) });
  assert.equal(falsch.vollstaendig, false);
  assert.deepEqual(falsch.neu.map((x) => x.name), ['zeta-lib']);
});

test('Manifest-Änderung aus Hunks: Abschnitt außerhalb des Kontexts → unklar, nicht geraten', () => {
  const deps = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`paket-${String.fromCharCode(97 + i)}`, '^1.0.0']));
  const vorher = { name: 'x', dependencies: deps };
  const nachher = { name: 'x', dependencies: { ...deps, 'paket-f': '^1.1.0' } };
  const p = einheitlicherDiff(json(vorher), json(nachher));
  const r = manifestAenderung(p);
  assert.equal(r.neu.length + r.geaendert.length, 0);
  assert.ok(r.unklar > 0);
  // scripts-Abschnitt: kein Abhängigkeitswechsel
  const s = manifestAenderung(einheitlicherDiff(json({ scripts: { a: 'x' } }), json({ scripts: { a: 'y' } })));
  assert.equal(s.neu.length + s.geaendert.length + s.unklar, 0);
  // leerer Abschnitt in einer Zeile
  const leerAbschnitt = manifestAenderung(einheitlicherDiff('{\n  "dependencies": {},\n  "name": "a"\n}', '{\n  "dependencies": {},\n  "name": "b"\n}'));
  assert.equal(leerAbschnitt.unklar, 0);
});

test('npm-Lock v3: Versionssprung, neues Paket, Install-Skript, Unklares', () => {
  const vorher = npmLock({
    'node_modules/alpha-lib': { version: '1.0.0', resolved: reg('alpha-lib', '1.0.0'), integrity: integ('A') },
    'node_modules/beta-lib': { version: '2.0.0', resolved: reg('beta-lib', '2.0.0'), integrity: integ('B') },
  });
  const nachher = npmLock({
    'node_modules/alpha-lib': { version: '1.1.0', resolved: reg('alpha-lib', '1.1.0'), integrity: integ('C') },
    'node_modules/beta-lib': { version: '2.0.0', resolved: reg('beta-lib', '2.0.0'), integrity: integ('B') },
    'node_modules/@neu/bau': { version: '0.1.0', resolved: reg('@neu/bau', '0.1.0'), integrity: integ('D'), hasInstallScript: true },
  });
  const r = lockAenderung(einheitlicherDiff(vorher, nachher), 'npm');
  const nach = Object.fromEntries(r.paare.map((p) => [p.schluessel, p]));
  assert.equal(nach['node_modules/alpha-lib'].vorher.version, '1.0.0');
  assert.equal(nach['node_modules/alpha-lib'].nachher.version, '1.1.0');
  assert.equal(nach['node_modules/@neu/bau'].vorher, null);
  assert.equal(nach['node_modules/@neu/bau'].nachher.install, true);
  assert.equal(nach['node_modules/@neu/bau'].name, '@neu/bau');
  assert.equal(r.unklar, 0);
  assert.ok(r.hostsVorher.has('npm'));
  // Hunk ohne Paketkopf im Kontext (Kontext 0) → unklar
  const nur = lockAenderung(einheitlicherDiff(vorher, nachher, 0), 'npm');
  assert.ok(nur.unklar > 0);
});

test('npm-Lock: verschachtelte node_modules, Workspace-Link, Legacy-dependencies-Abschnitt', () => {
  const alt = json({ lockfileVersion: 2, packages: { 'node_modules/a/node_modules/b': { version: '1.0.0', resolved: reg('b', '1.0.0') }, 'node_modules/ws-a': { resolved: 'packages/ws-a', link: true } }, dependencies: { b: { version: '1.0.0', resolved: reg('b', '1.0.0') } } });
  const neu = alt.replaceAll('1.0.0', '1.0.1');
  const r = lockAenderung(einheitlicherDiff(alt, neu), 'npm');
  assert.deepEqual(r.paare.map((p) => [p.schluessel, p.name]), [['node_modules/a/node_modules/b', 'b'], ['b', 'b']], 'Legacy-Abschnitt wird wie v1 gelesen');
  assert.equal(r.unklar, 0);
  assert.equal(r.paare.some((p) => p.name === 'ws-a'), false, 'Workspace-Link ohne Änderung');
});

test('yarn.lock v1 und Berry', () => {
  const v1 = (ver, url, i) => `# yarn lockfile v1\n\n\n"@bsp/kern@^1.0.0", "@bsp/kern@^1.1.0":\n  version "${ver}"\n  resolved "${url}#${'a'.repeat(40)}"\n  integrity ${i}\n  dependencies:\n    hilfs-lib "^1.0.0"\n\nhilfs-lib@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/hilfs-lib/-/hilfs-lib-1.0.0.tgz"\n  integrity ${integ('H')}\n`;
  const r = lockAenderung(einheitlicherDiff(v1('1.1.0', 'https://registry.yarnpkg.com/@bsp/kern/-/kern-1.1.0.tgz', integ('A')), v1('1.1.0', 'https://pakete.boese.example/@bsp/kern/-/kern-1.1.0.tgz', integ('Z'))), 'yarn');
  assert.equal(r.paare.length, 1);
  assert.equal(r.paare[0].name, '@bsp/kern');
  assert.equal(quelle(r.paare[0].vorher.resolved).host, 'npm');
  assert.equal(quelle(r.paare[0].nachher.resolved).host, 'pakete.boese.example');
  const berry = (res, sum) => `__metadata:\n  version: 8\n  cacheKey: 10c0\n\n"kern-lib@npm:^1.0.0":\n  version: 1.0.0\n  resolution: "${res}"\n  checksum: ${sum}\n  languageName: node\n  linkType: hard\n`;
  const b = lockAenderung(einheitlicherDiff(berry('kern-lib@npm:1.0.0', '10c0/aaaa'), berry('kern-lib@https://pakete.boese.example/kern.tgz', '10c0/bbbb')), 'yarn');
  assert.equal(b.paare[0].vorher.resolved, null, 'npm:-Auflösung ist die Registry');
  assert.equal(b.paare[0].nachher.resolved, 'https://pakete.boese.example/kern.tgz');
  assert.equal(b.unklar, 0);
  const meta = lockAenderung(einheitlicherDiff(berry('kern-lib@npm:1.0.0', '10c0/aaaa').replace('version: 8', 'version: 6'), berry('kern-lib@npm:1.0.0', '10c0/aaaa')), 'yarn');
  assert.equal(meta.paare.length + meta.unklar, 0, '__metadata ist kein Paket');
});

test('pnpm-lock: Schlüssel v5/v6/v9, Inline-Resolution, requiresBuild, importers', () => {
  assert.deepEqual(pnpmSchluessel('/foo/1.0.0'), { name: 'foo', version: '1.0.0' });
  assert.deepEqual(pnpmSchluessel('/foo@1.0.0(peer@2.0.0)'), { name: 'foo', version: '1.0.0' });
  assert.deepEqual(pnpmSchluessel("'@sc/foo@1.0.0'"), { name: '@sc/foo', version: '1.0.0' });
  assert.equal(pnpmSchluessel('packages/a'), null);
  assert.equal(pnpmSchluessel('.'), null);
  const lock = (ver, extra) => `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      kern-lib:\n        specifier: ^${ver}\n        version: ${ver}\n\npackages:\n\n  kern-lib@${ver}:\n    resolution: {integrity: ${integ('K')}${extra}}\n    engines: {node: '>=18'}\n${extra ? '    requiresBuild: true\n' : ''}\nsnapshots:\n\n  kern-lib@${ver}: {}\n`;
  const r = lockAenderung(einheitlicherDiff(lock('1.0.0', ''), lock('1.0.0', ', tarball: https://pakete.boese.example/k.tgz')), 'pnpm');
  const p = r.paare.find((x) => x.nachher?.resolved);
  assert.equal(p.name, 'kern-lib');
  assert.equal(p.nachher.install, true);
  assert.equal(p.vorher.resolved, null);
  assert.equal(r.unklar, 0);
});

test('Kaputte Lockfiles: kein Absturz, nichts erfunden', () => {
  for (const format of ['npm', 'yarn', 'pnpm']) {
    for (const p of ['', 'kein diff', '@@ -1 +1 @@\n-{\n+}', '@@ -x +y @@\n+"resolved": "http://a.example"', '@@ -1,2 +1,2 @@\n   "resolved": "https://registry.npmjs.org/x"\n-  "integrity": "sha512-a"\n+  "integrity": "sha512-b"', '\u0000\u0001'.repeat(50)]) {
      const r = lockAenderung(p, format);
      assert.ok(Array.isArray(r.paare), `${format}: ${p.slice(0, 20)}`);
      for (const x of r.paare) assert.ok(x.name, 'jedes Paar hat einen Namen');
    }
  }
  const ohneKopf = lockAenderung('@@ -10,2 +10,2 @@\n     "version": "1.0.0",\n-    "resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz",\n+    "resolved": "https://boese.example/a-1.0.0.tgz",', 'npm');
  assert.equal(ohneKopf.paare.length, 0);
  assert.equal(ohneKopf.unklar, 2);
});

test('Format, Quelle und Algorithmus', () => {
  assert.equal(lockFormat('a/b/package-lock.json'), 'npm');
  assert.equal(lockFormat('npm-shrinkwrap.json'), 'npm');
  assert.equal(lockFormat('yarn.lock'), 'yarn');
  assert.equal(lockFormat('pnpm-lock.yaml'), 'pnpm');
  assert.equal(lockFormat('bun.lockb'), null);
  assert.deepEqual(quelle('https://registry.yarnpkg.com/a/-/a-1.tgz'), { art: 'registry', host: 'npm' });
  assert.equal(quelle('git+ssh://git@code.example/a/b.git').art, 'git');
  assert.equal(quelle('github:nutzer/repo').art, 'git');
  assert.equal(quelle('http://pakete.example/a.tgz').art, 'http');
  assert.equal(quelle('file:../x').art, 'datei');
  assert.equal(quelle('packages/a').art, 'datei');
  assert.equal(quelle('').art, 'leer');
  assert.equal(quelle('https://').host, null);
  assert.equal(algorithmus(integ('a', 'sha1')), 'sha1');
  assert.equal(algorithmus('10c0/abcdef'), 'berry-10c0');
  assert.equal(algorithmus('abcdef0123'), 'hex');
  assert.equal(algorithmus(null), null);
});

test('Review: npm-Feld-Regex ohne Backtracking-Fraß, einzeilige Einträge, Lockfile v1', () => {
  const t0 = Date.now();
  lockAenderung('@@ -1,1 +1,3 @@\n "node_modules/a": {\n+    "version": "' + ' '.repeat(50000) + 'x\n+    "resolved": "' + '"'.repeat(50000), 'npm');
  assert.ok(Date.now() - t0 < 500, `zu langsam: ${Date.now() - t0} ms`);
  const ein = (url) => `{\n  "packages": {\n    "node_modules/kern-lib": {"version":"1.0.0","resolved":"${url}","integrity":"sha512-a"},\n    "node_modules/x": {"version":"2.0.0"}\n  }\n}`;
  const r = lockAenderung(einheitlicherDiff(ein('https://registry.npmjs.org/kern-lib/-/kern-lib-1.0.0.tgz'), ein('https://pakete.boese.example/k.tgz')), 'npm');
  assert.equal(r.paare.length, 1);
  assert.equal(r.paare[0].vorher.resolved, 'https://registry.npmjs.org/kern-lib/-/kern-lib-1.0.0.tgz');
  assert.equal(r.paare[0].nachher.resolved, 'https://pakete.boese.example/k.tgz');
  const v1 = (url) => json({ lockfileVersion: 1, requires: true, dependencies: { 'kern-lib': { version: '1.0.0', resolved: url, integrity: integ('A'), requires: { hilfe: '^1.0.0' }, dependencies: { hilfe: { version: '1.0.0', resolved: reg('hilfe', '1.0.0') } } } } });
  const r1 = lockAenderung(einheitlicherDiff(v1(reg('kern-lib', '1.0.0')), v1('https://pakete.boese.example/k.tgz')), 'npm');
  assert.deepEqual(r1.paare.map((p) => [p.name, quelle(p.nachher.resolved).host]), [['kern-lib', 'pakete.boese.example']]);
});

test('Review: pnpm-Schlüssel mit Tarball/git, verschobene Einträge, Format- und cacheKey-Wechsel', () => {
  const p = (key, res) => `lockfileVersion: '9.0'\n\npackages:\n\n  ${key}:\n    resolution: ${res}\n    version: 1.0.0\n`;
  const r = lockAenderung(einheitlicherDiff(p('foo@1.0.0', `{integrity: ${integ('A')}}`), p('foo@https://pakete.boese.example/foo.tgz', '{tarball: https://pakete.boese.example/foo.tgz}')), 'pnpm');
  assert.equal(r.paare[0].name, 'foo');
  assert.equal(quelle(r.paare[0].nachher.resolved).host, 'pakete.boese.example');
  assert.ok(r.paare[0].vorher, 'Gegenstück gefunden');
  const g = lockAenderung(einheitlicherDiff(p('/foo@1.0.0', '{integrity: x}'), p('code.example/nutzer/foo/0123abcd', '{commit: 0123abcd, repo: https://code.example/nutzer/foo.git, type: git}')), 'pnpm');
  assert.equal(quelle(g.paare[0].nachher.resolved).art, 'git');
  // yarn: Eintrag oben gelöscht, unten mit fremder Quelle wieder eingefügt → als Paar erkannt
  const fueller = Array.from({ length: 6 }, (_, i) => `f${i}@^1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/f${i}/-/f${i}-1.0.0.tgz"\n`).join('\n');
  const kern = (url) => `kern-lib@^1.0.0:\n  version "1.0.0"\n  resolved "${url}"\n`;
  const y = lockAenderung(einheitlicherDiff(kern('https://registry.yarnpkg.com/kern-lib/-/kern-lib-1.0.0.tgz') + '\n' + fueller, fueller + '\n' + kern('https://pakete.boese.example/k.tgz')), 'yarn');
  const kp = y.paare.find((x) => x.name === 'kern-lib' && x.nachher);
  assert.ok(kp.vorher, 'verschobener Eintrag hat sein Gegenstück');
  // yarn v1 mit Schlüssel in Anführungszeichen
  const q = lockAenderung('@@ -1,3 +1,3 @@\n kern-lib@^1.0.0:\n   version "1.0.0"\n-  "resolved" "https://registry.yarnpkg.com/kern-lib/-/kern-lib-1.0.0.tgz"\n+  "resolved" "https://pakete.boese.example/k.tgz"', 'yarn');
  assert.equal(quelle(q.paare[0].nachher.resolved).host, 'pakete.boese.example');
  assert.equal(lockAenderung('@@ -1,2 +1,2 @@\n {\n-  "lockfileVersion": 1,\n+  "lockfileVersion": 3,', 'npm').formatWechsel, true);
  assert.equal(lockAenderung('@@ -1,3 +1,3 @@\n __metadata:\n   version: 8\n-  cacheKey: 10\n+  cacheKey: 10c0', 'yarn').cacheWechsel, true);
});
