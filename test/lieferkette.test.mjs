// Regelfamilie lieferkette/*: je Regel Positiv- und Negativfälle, Fehlalarm-Sammlung, Scan, Konfiguration.
// Alle Paketnamen und Adressen sind erfunden; nichts davon ist ein echtes Paket oder echter Schadcode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeDateien } from '../lib/regeln/index.mjs';
import { namensnaehe, direktArt, schwaerze } from '../lib/regeln/lieferkette.mjs';
import { REGEL_IDS } from '../lib/konfig/regelliste.mjs';
import { ladeKonfig } from '../lib/konfig/schema.mjs';
import { aenderung, json, npmLock, reg, integ } from './lieferkette-hilfen.mjs';
import { HARMLOS } from './fixtures/lieferkette/harmlos.mjs';
import { datei } from './hilfen.mjs';

const lk = (befunde) => befunde.filter((b) => b.regel.startsWith('lieferkette/'));
const finde = (r, regel) => r.befunde.find((b) => b.regel === regel);
const manifest = (deps, extra = {}) => json({ name: 'beispiel-app', version: '1.0.0', scripts: { test: 'node --test' }, dependencies: deps, ...extra });
const eintrag = (name, version, z, extra = {}) => ({ [`node_modules/${name}`]: { version, resolved: reg(name, version), integrity: integ(z), ...extra } });
const L0 = { ...eintrag('kern-lib', '1.2.0', 'A'), ...eintrag('hilfs-werk', '3.0.0', 'B') };

test('Regeln sind registriert und per .schleuse.json schaltbar', () => {
  for (const r of ['lock-ohne-manifest', 'quelle-gewechselt', 'direkt-von-git-oder-url', 'install-skript', 'registry-umgebogen', 'namensnaehe']) assert.ok(REGEL_IDS.includes(`lieferkette/${r}`), r);
  const k = ladeKonfig(JSON.stringify({ version: 1, regeln: { 'lieferkette/*': 'warnung', 'lieferkette/namensnaehe': 'aus' } }));
  assert.ok(k.konfig, JSON.stringify(k.fehler));
});

test('Fehlalarm-Sammlung: harmlose Updates erzeugen kein warn/block', async () => {
  assert.ok(HARMLOS.length >= 12);
  for (const fall of HARMLOS) {
    const r = await pruefeDateien(fall.dateien);
    const zuviel = r.befunde.filter((b) => !(fall.erlaubt || []).includes(b.regel) || b.stufe !== 'info');
    assert.deepEqual(zuviel.map((b) => `${b.regel} ${b.stufe}: ${b.details?.join('; ') || b.warum}`), [], fall.name);
    assert.deepEqual(r.hinweise, [], fall.name);
  }
});

test('Fehlalarm-Sammlung auch mit Kopf-Stand aus dem Blob (exakter Basis-Stand)', async () => {
  for (const fall of HARMLOS) {
    let geladen = 0;
    const ladeBytes = async (d) => { geladen++; return Buffer.from(d.kopf); };
    const r = await pruefeDateien(fall.dateien, { ladeBytes });
    assert.equal(lk(r.befunde).filter((b) => b.stufe !== 'info').length, 0, fall.name);
    assert.deepEqual(r.hinweise, [], fall.name);
    if (fall.dateien.some((d) => d.filename.endsWith('package.json'))) assert.ok(geladen > 0, fall.name);
  }
});

test('lock-ohne-manifest: Hinweis nur ohne passendes Manifest im Projektbaum', async () => {
  const lock = aenderung('package-lock.json', npmLock(L0), npmLock({ ...L0, ...eintrag('kern-lib', '1.2.1', 'C') }));
  const r = await pruefeDateien([lock]);
  assert.equal(finde(r, 'lieferkette/lock-ohne-manifest')?.stufe, 'info');
  const mitManifest = await pruefeDateien([lock, aenderung('packages/a/package.json', manifest({ x: '1' }), manifest({ x: '2' }))]);
  assert.equal(finde(mitManifest, 'lieferkette/lock-ohne-manifest'), undefined, 'Workspace-Manifest unterhalb des Lockfiles passt');
  const sub = aenderung('tools/package-lock.json', npmLock(L0), npmLock({ ...L0, ...eintrag('kern-lib', '1.2.1', 'C') }));
  const daneben = await pruefeDateien([sub, aenderung('web/package.json', manifest({ x: '1' }), manifest({ x: '2' }))]);
  assert.equal(finde(daneben, 'lieferkette/lock-ohne-manifest')?.stufe, 'info', 'Manifest in einem anderen Projekt passt nicht');
  const nurKopf = await pruefeDateien([aenderung('package-lock.json', npmLock(L0), npmLock(L0, { name: 'umbenannt' }))]);
  assert.equal(finde(nurKopf, 'lieferkette/lock-ohne-manifest'), undefined, 'nur Projektname geändert, kein Paket');
});

test('quelle-gewechselt: Host-Wechsel, git, Datei, Integrität bei gleicher Version → block', async () => {
  const faelle = [
    ['fremde Registry', { 'node_modules/kern-lib': { version: '1.2.0', resolved: 'https://pakete.boese.example/kern-lib/-/kern-lib-1.2.0.tgz', integrity: integ('A') } }, 'pakete.boese.example'],
    ['git', { 'node_modules/kern-lib': { version: '1.2.0', resolved: 'git+ssh://git@code.boese.example/x/kern-lib.git#abc', integrity: integ('A') } }, 'git'],
    ['Datei', { 'node_modules/kern-lib': { version: '1.2.0', resolved: 'file:../../kern-lib-1.2.0.tgz', integrity: integ('A') } }, 'lokaler Pfad'],
    ['http', { 'node_modules/kern-lib': { version: '1.2.0', resolved: 'http://registry.npmjs.org/kern-lib/-/kern-lib-1.2.0.tgz', integrity: integ('A') } }, 'http'],
    ['Integrität', { 'node_modules/kern-lib': { version: '1.2.0', resolved: reg('kern-lib', '1.2.0'), integrity: integ('Z') } }, 'Integrität geändert'],
  ];
  for (const [name, neu, erwartet] of faelle) {
    const r = await pruefeDateien([aenderung('package-lock.json', npmLock(L0), npmLock({ ...L0, ...neu }))]);
    const b = finde(r, 'lieferkette/quelle-gewechselt');
    assert.equal(b?.stufe, 'block', name);
    assert.ok(b.details.some((d) => d.includes(erwartet)), `${name}: ${b.details}`);
    assert.ok(!b.details.join(' ').includes('/-/'), 'nur Host, nie die ganze Adresse');
  }
});

test('quelle-gewechselt: neues Paket aus fremder Quelle → warn; aus der Registry → nichts', async () => {
  const fremd = await pruefeDateien([
    aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': '^1.2.0', 'neu-lib': '^1.0.0' })),
    aenderung('package-lock.json', npmLock(L0), npmLock({ ...L0, 'node_modules/neu-lib': { version: '1.0.0', resolved: 'https://spiegel.boese.example/neu-lib-1.0.0.tgz', integrity: integ('N') } })),
  ]);
  assert.equal(finde(fremd, 'lieferkette/quelle-gewechselt')?.stufe, 'warn');
  // Firmen-Mirror, der schon vorher im Lockfile steht, ist kein Wechsel
  const mirror = (n, v, z) => ({ [`node_modules/${n}`]: { version: v, resolved: `https://npm.firma.example/${n}/-/${n}-${v}.tgz`, integrity: integ(z) } });
  const M0 = { ...mirror('kern-lib', '1.2.0', 'A'), ...mirror('hilfs-werk', '3.0.0', 'B') };
  const firma = await pruefeDateien([
    aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': '^1.2.0', 'neu-lib': '^1.0.0' })),
    aenderung('package-lock.json', npmLock(M0), npmLock({ ...M0, ...mirror('neu-lib', '1.0.0', 'N'), ...mirror('kern-lib', '1.3.0', 'C') })),
  ]);
  assert.equal(lk(firma.befunde).length, 0, JSON.stringify(lk(firma.befunde)));
});

test('quelle-gewechselt in yarn.lock (Registry-Alias) und pnpm-lock.yaml (Tarball statt Registry)', async () => {
  const y = (url) => `# yarn lockfile v1\n\n\nkern-lib@^1.2.0:\n  version "1.2.0"\n  resolved "${url}"\n  integrity ${integ('A')}\n`;
  const alias = await pruefeDateien([aenderung('yarn.lock', y('https://registry.yarnpkg.com/kern-lib/-/kern-lib-1.2.0.tgz'), y('https://registry.npmjs.org/kern-lib/-/kern-lib-1.2.0.tgz'))]);
  assert.equal(finde(alias, 'lieferkette/quelle-gewechselt'), undefined, 'yarnpkg.com und npmjs.org sind dieselbe Registry');
  const boese = await pruefeDateien([aenderung('yarn.lock', y('https://registry.yarnpkg.com/kern-lib/-/kern-lib-1.2.0.tgz'), y('https://pakete.boese.example/kern-lib-1.2.0.tgz'))]);
  assert.equal(finde(boese, 'lieferkette/quelle-gewechselt')?.stufe, 'block');
  const p = (res) => `lockfileVersion: '9.0'\n\npackages:\n\n  kern-lib@1.2.0:\n    resolution: ${res}\n    engines: {node: '>=18'}\n`;
  const pn = await pruefeDateien([aenderung('pnpm-lock.yaml', p(`{integrity: ${integ('A')}}`), p(`{integrity: ${integ('A')}, tarball: https://pakete.boese.example/k.tgz}`))]);
  assert.equal(finde(pn, 'lieferkette/quelle-gewechselt')?.stufe, 'block');
});

test('direkt-von-git-oder-url: git, Kurzform, Tarball, Pfad außerhalb → warn; Registry, workspace, Pfad im Repo → nichts', async () => {
  for (const [spec, art] of [['git+https://code.example/x/y.git', 'git'], ['github:nutzer/werk', 'git'], ['nutzer/werk#v1', 'git'], ['https://dl.example/werk-1.0.0.tgz', 'url'], ['https://code.example/x/y.git#main', 'git'], ['file:../../anderswo', 'pfad'], ['link:/opt/werk', 'pfad'], ['~/werk', 'pfad']]) {
    assert.equal(direktArt(spec, 'package.json'), art, spec);
  }
  for (const spec of ['^1.0.0', '1.x', 'latest', '*', 'npm:kern-lib@^1', 'workspace:^', 'file:./packages/a', 'catalog:', '>=1 <2']) assert.equal(direktArt(spec, 'package.json'), null, spec);
  assert.equal(direktArt('file:../ui', 'packages/app/package.json'), null);
  assert.equal(direktArt('file:../../../x', 'packages/app/package.json'), 'pfad');

  const r = await pruefeDateien([aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': '^1.2.0', 'werk-git': 'github:nutzer/werk-git' }))]);
  const b = finde(r, 'lieferkette/direkt-von-git-oder-url');
  assert.equal(b?.stufe, 'warn');
  assert.ok(b.zeile > 0);
  assert.match(b.details[0], /werk-git \(dependencies\): per git-Adresse/);
  // Bestehende Abhängigkeit wechselt auf eine URL
  const wechsel = await pruefeDateien([aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': 'https://dl.example/kern-lib.tgz' }))]);
  assert.equal(finde(wechsel, 'lieferkette/direkt-von-git-oder-url')?.stufe, 'warn');
  // repository/homepage-Felder sind keine Abhängigkeiten
  const meta = await pruefeDateien([aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': '^1.2.0' }, { repository: 'github:nutzer/projekt', homepage: 'https://projekt.example' }))]);
  assert.equal(lk(meta.befunde).length, 0);
});

test('install-skript: neues Paket oder neue Version mit Install-Skript → warn; schon vorhanden → nichts', async () => {
  const neu = await pruefeDateien([aenderung('package-lock.json', npmLock(L0), npmLock({ ...L0, ...eintrag('bau-neu', '1.0.0', 'X', { hasInstallScript: true }) })), aenderung('package.json', manifest({}), manifest({ 'bau-neu': '^1.0.0' }))]);
  const b = finde(neu, 'lieferkette/install-skript');
  assert.equal(b?.stufe, 'warn');
  assert.match(b.details[0], /bau-neu@1.0.0: neues Paket mit Install-Skript/);
  const dazu = await pruefeDateien([aenderung('package-lock.json', npmLock(L0), npmLock({ ...L0, ...eintrag('hilfs-werk', '3.0.1', 'Y', { hasInstallScript: true }) })), aenderung('package.json', manifest({}), manifest({ x: '1' }))]);
  assert.match(finde(dazu, 'lieferkette/install-skript')?.details[0] || '', /hilfs-werk@3.0.1: Install-Skript neu/);
  const schon = { ...L0, ...eintrag('bau-alt', '1.0.0', 'X', { hasInstallScript: true }) };
  const da = await pruefeDateien([aenderung('package-lock.json', npmLock(schon), npmLock({ ...schon, ...eintrag('bau-alt', '1.1.0', 'W', { hasInstallScript: true }) })), aenderung('package.json', manifest({}), manifest({ x: '1' }))]);
  assert.equal(finde(da, 'lieferkette/install-skript'), undefined);
  // pnpm: requiresBuild bei einem neuen Paket
  const p = (extra) => `lockfileVersion: '6.0'\n\npackages:\n\n  /kern-lib@1.2.0:\n    resolution: {integrity: ${integ('A')}}\n    dev: false\n${extra}`;
  const pn = await pruefeDateien([aenderung('pnpm-lock.yaml', p(''), p(`\n  /bau-neu@1.0.0:\n    resolution: {integrity: ${integ('B')}}\n    requiresBuild: true\n    dev: false\n`)), aenderung('package.json', manifest({}), manifest({ x: '1' }))]);
  assert.equal(finde(pn, 'lieferkette/install-skript')?.stufe, 'warn');
  // Ganz neues Lockfile: Install-Skripte sind dann normal und kein Signal
  const frisch = await pruefeDateien([aenderung('package-lock.json', null, npmLock(schon))]);
  assert.equal(finde(frisch, 'lieferkette/install-skript'), undefined);
});

test('registry-umgebogen: fremde Registry, Scope, TLS, Prüfsummen → block; Token wird nie ausgegeben', async () => {
  const geheim = ['npm', 'TOKEN', 'beispiel', '0000'].join('_'); // erst zur Laufzeit zusammengesetzt
  const faelle = [
    ['.npmrc', `registry=https://pakete.boese.example/\n//pakete.boese.example/:_authToken=${geheim}\n`, 'block'],
    ['.npmrc', '@firma:registry=https://pakete.boese.example/npm/\n', 'block'],
    ['.npmrc', 'strict-ssl=false\n', 'block'],
    ['.npmrc', 'registry=http://spiegel.example/\n', 'block'],
    ['.npmrc', 'registry=https://registry.npmjs.org/\n', 'info'],
    ['.npmrc', '@firma:registry=https://npm.pkg.github.com\n', 'warn'],
    ['.npmrc', 'cafile=./zertifikat.pem\n', 'warn'],
    ['.yarnrc', 'registry "https://pakete.boese.example/"\n', 'block'],
    ['.yarnrc', 'strict-ssl false\n', 'block'],
    ['.yarnrc.yml', 'nodeLinker: node-modules\nnpmRegistryServer: "https://pakete.boese.example"\n', 'block'],
    ['.yarnrc.yml', 'npmScopes:\n  firma:\n    npmRegistryServer: "https://pakete.boese.example"\n', 'block'],
    ['.yarnrc.yml', 'enableStrictSsl: false\n', 'block'],
    ['.yarnrc.yml', 'checksumBehavior: ignore\n', 'block'],
    ['.yarnrc.yml', 'checksumBehavior: update\n', 'warn'],
    ['web/.npmrc', `registry=https://${geheim}@pakete.boese.example/?token=${geheim}\n`, 'block'],
  ];
  for (const [pfad, inhalt, stufe] of faelle) {
    const r = await pruefeDateien([datei(pfad, inhalt.trimEnd().split('\n'), { status: 'added' })]);
    const b = finde(r, 'lieferkette/registry-umgebogen');
    assert.equal(b?.stufe, stufe, `${pfad}: ${inhalt}`);
    assert.ok(!JSON.stringify(r).includes(geheim), `Token im Ergebnis: ${pfad}`);
    if (b.details.some((d) => d.includes('boese'))) assert.match(b.details.join(' '), /pakete\.boese\.example/);
  }
  assert.equal(schwaerze(`//host/:_authToken=${geheim}`), '//host/:_authToken=***');
  assert.equal(schwaerze('npmAuthToken: "abc"'), 'npmAuthToken: ***');
  for (const harmlos of ['engine-strict=true', '# registry=https://pakete.boese.example', 'save-exact=true', `//registry.npmjs.org/:_authToken=${geheim}`, 'npmPublishRegistry: "https://npm.firma.example"']) {
    const r = await pruefeDateien([datei('.npmrc', [harmlos])]);
    assert.equal(lk(r.befunde).length, 0, harmlos);
    assert.ok(!JSON.stringify(r).includes(geheim));
  }
});

test('namensnaehe: ein Zeichen, Dreher, Trenner, Scope → warn; nur gegen vorhandene eigene Pakete', async () => {
  for (const [neu, alt, art] of [['kern-lib', 'kern-lab', 'ein Zeichen'], ['kren-lib', 'kern-lib', 'vertauschte Zeichen'], ['kern_lib', 'kern-lib', 'Trennzeichen'], ['kernlib', 'kern-lib', 'Trennzeichen'], ['kern-llib', 'kern-lib', 'ein Zeichen mehr oder weniger'], ['@flrma/werk', '@firma/werk', 'anderer Scope'], ['Kern-Lib', 'kern-lib', 'Groß-/Kleinschreibung']]) {
    assert.equal(namensnaehe(neu, alt), art, `${neu} ~ ${alt}`);
  }
  for (const [neu, alt] of [['@types/kern-lib', 'kern-lib'], ['kern-libx', 'kern-lib'], ['akern-lib', 'kern-lib'], ['zern-lib', 'kern-lib'], ['abc', 'abd'], ['@babel/werk', '@firma/werk'], ['@firma/werk', 'werk'], ['kern-lib', 'kern-lib'], ['react-dom', 'react-dnd']]) {
    assert.equal(namensnaehe(neu, alt), null, `${neu} ~ ${alt}`);
  }
  const r = await pruefeDateien([aenderung('package.json', manifest({ 'kern-lib': '^1.2.0', 'hilfs-werk': '^3.0.0' }), manifest({ 'kern-lib': '^1.2.0', 'hilfs-werk': '^3.0.0', 'hilfs_werk': '^3.0.0' }))]);
  const b = finde(r, 'lieferkette/namensnaehe');
  assert.equal(b?.stufe, 'warn');
  assert.match(b.warum, /hilfs_werk ähnelt dem vorhandenen hilfs-werk \(Unterschied: Trennzeichen\)/);
  // Zwei neue Pakete, die einander ähneln, aber keins war vorher da: kein Befund
  const beide = await pruefeDateien([aenderung('package.json', manifest({ 'kern-lib': '^1.2.0' }), manifest({ 'kern-lib': '^1.2.0', 'farb-werk': '1', 'farb_werk': '1' }))]);
  assert.equal(finde(beide, 'lieferkette/namensnaehe'), undefined);
});

test('Nicht prüfbar: Lockfile ohne Diff oder ohne Paketkopf im Kontext → Hinweis statt Raten', async () => {
  const ohne = { filename: 'yarn.lock', status: 'modified', additions: 5000, deletions: 4000, sha: 'a'.repeat(40) };
  const r = await pruefeDateien([ohne]);
  assert.equal(lk(r.befunde).length, 0);
  assert.ok(r.hinweise.some((h) => /yarn\.lock nicht prüfbar – kein Diff/.test(h)));
  const kopflos = { filename: 'package-lock.json', status: 'modified', additions: 1, deletions: 1, sha: 'b'.repeat(40),
    patch: '@@ -40,3 +40,3 @@\n       "version": "1.2.0",\n-      "resolved": "https://registry.npmjs.org/kern-lib/-/kern-lib-1.2.0.tgz",\n+      "resolved": "https://pakete.boese.example/kern-lib-1.2.0.tgz",\n       "integrity": "sha512-x"' };
  const k = await pruefeDateien([kopflos]);
  assert.equal(finde(k, 'lieferkette/quelle-gewechselt'), undefined);
  assert.ok(k.hinweise.some((h) => /package-lock\.json nicht prüfbar – 2 geänderte Zeile/.test(h)));
});

test('Kopf-Stand aus dem Blob: Abschnitt außerhalb des Kontexts wird trotzdem erkannt', async () => {
  const deps = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`paket-${String.fromCharCode(97 + i)}`, '^1.0.0']));
  const alt = manifest(deps);
  const neu = manifest({ ...deps, 'paket-e': 'github:nutzer/paket-e' });
  const d = aenderung('package.json', alt, neu);
  const ohneBlob = await pruefeDateien([d]);
  assert.equal(finde(ohneBlob, 'lieferkette/direkt-von-git-oder-url'), undefined);
  assert.ok(ohneBlob.hinweise.some((h) => /package\.json nicht prüfbar/.test(h)));
  let geladen = 0;
  const mitBlob = await pruefeDateien([d], { ladeBytes: async () => { geladen++; return Buffer.from(neu); } });
  assert.equal(geladen, 1);
  assert.equal(finde(mitBlob, 'lieferkette/direkt-von-git-oder-url')?.stufe, 'warn');
  assert.deepEqual(mitBlob.hinweise, []);
  // Blob passt nicht zum Patch → Rückfall, kein Absturz
  const falsch = await pruefeDateien([d], { ladeBytes: async () => Buffer.from('{"kaputt": ') });
  assert.equal(finde(falsch, 'lieferkette/direkt-von-git-oder-url'), undefined);
  const wirft = await pruefeDateien([d], { ladeBytes: async () => { throw new Error('weg'); } });
  assert.ok(Array.isArray(wirft.befunde));
  assert.equal(wirft.befunde.filter((b) => b.regel === 'pruefung/unvollstaendig').length, 0, 'Manifest-Blob ist optional');
});

test('Scan: nur registry-umgebogen gilt; node_modules und gelöschte Dateien werden übersprungen', async () => {
  const dateien = [
    datei('.npmrc', ['strict-ssl=false'], { status: 'added' }),
    datei('package.json', manifest({ 'werk-git': 'github:nutzer/werk' }).split('\n'), { status: 'added' }),
    datei('package-lock.json', npmLock({ ...L0, ...eintrag('bau', '1.0.0', 'Q', { hasInstallScript: true }) }).split('\n'), { status: 'added' }),
  ];
  const r = await pruefeDateien(dateien, { kontext: { scan: true } });
  assert.deepEqual(lk(r.befunde).map((b) => b.regel), ['lieferkette/registry-umgebogen']);
  const nm = await pruefeDateien([datei('node_modules/x/.npmrc', ['strict-ssl=false'])]);
  assert.equal(lk(nm.befunde).length, 0);
  const weg = await pruefeDateien([{ ...datei('.npmrc', ['strict-ssl=false']), status: 'removed' }]);
  assert.equal(lk(weg.befunde).length, 0);
});
