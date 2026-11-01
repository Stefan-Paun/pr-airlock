// Regressionen aus Review-Runde 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeDateien, risiko, BLOB_CODE } from '../lib/regeln/index.mjs';
import { pruefeAnhang } from '../lib/regeln/anhang.mjs';
import { pruefeMarker } from '../lib/regeln/marker.mjs';
import { pruefeTarnung } from '../lib/regeln/tarnung.mjs';
import { pruefeLokal } from '../lib/pruefung.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { parsePatch } from '../lib/diff.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const added = (d) => parsePatch(d.patch).added;
const boeseZeile = 'export default {};' + fuellung(507) + pseudoBlob(3000) + 'fromCharCode(';

test('Code-Datei ohne Patch und additions 0 (NUL-Byte → „binär“) wird trotzdem aus dem Blob geprüft', async () => {
  const d = { filename: 'postcss.config.mjs', status: 'modified', additions: 0, deletions: 0, changes: 0, sha: 'a'.repeat(40) };
  const r = await pruefeDateien([d], { ladeBytes: async () => Buffer.from('// \0\n' + boeseZeile + '\n') });
  assert.ok(r.befunde.some((b) => b.regel === 'anhang/fuellung' && b.stufe === 'block'));
  const rename = { filename: 'b.js', previous_filename: 'a.js', status: 'renamed', additions: 0, deletions: 0, changes: 0, sha: 'a'.repeat(40) };
  let geladen = 0;
  await pruefeDateien([rename], { ladeBytes: async () => { geladen++; return Buffer.from(''); } });
  assert.equal(geladen, 0, 'reiner Rename lädt nichts');
});

test('Code-Datei am Größenlimit → block, weil das Ende ungeprüft bleibt; Binärkopf am Limit ist normal', async () => {
  const gross = { filename: 'eslint.config.mjs', status: 'modified', additions: 0, sha: 'a'.repeat(40) };
  const r = await pruefeDateien([gross], { ladeBytes: async (d, max) => { assert.equal(max, BLOB_CODE); return Buffer.alloc(max, 0x20); } });
  const u = r.befunde.find((b) => b.regel === 'pruefung/unvollstaendig');
  assert.equal(u?.stufe, 'block');
  assert.match(u.warum, /Ende wurde nicht geprüft/);
  const font = { filename: 'a.woff2', status: 'added', additions: 0, sha: 'b'.repeat(40) };
  const r2 = await pruefeDateien([font], { ladeBytes: async (d, max) => Buffer.concat([Buffer.from('774f4632', 'hex'), Buffer.alloc(max, 1)]).subarray(0, max) });
  assert.deepEqual(r2.befunde, []);
});

test('Weißraum: \\v, \\f, U+2028, U+2029 zählen als Füllung', () => {
  for (const ws of ['\u000b', '\u000c', ' ', ' ']) {
    const d = datei('postcss.config.mjs', ['export default x;' + ws.repeat(2000) + pseudoBlob(3000) + 'fromCharCode(']);
    assert.equal(pruefeAnhang(d, added(d))[0]?.stufe, 'block', JSON.stringify(ws));
  }
});

test('Blob-Deckel: Fonts und Code vor Bildern, ungeprüfter Font ist block', async () => {
  const bilder = Array.from({ length: 5 }, (_, i) => ({ filename: `a${i}.png`, status: 'added', additions: 0, sha: 'c'.repeat(40) }));
  const font = { filename: 'zzz/fa-solid-400.woff2', status: 'added', additions: 0, sha: 'd'.repeat(40) };
  const reihenfolge = [];
  const r = await pruefeDateien([...bilder, font], { maxBlobs: 3, ladeBytes: async (d) => { reihenfolge.push(d.filename); return Buffer.from(d.filename.endsWith('.png') ? '89504e470d0a1a0a' : '774f4632', 'hex'); } });
  assert.equal(reihenfolge[0], 'zzz/fa-solid-400.woff2', 'Font zuerst');
  assert.ok(r.befunde.every((b) => b.regel === 'pruefung/unvollstaendig' && b.stufe === 'warn'), 'nur Bilder blieben ungeprüft → warn');
  const r2 = await pruefeDateien([font, { ...font, filename: 'b.ttf' }], { maxBlobs: 1, ladeBytes: async () => Buffer.from('774f4632', 'hex') });
  assert.equal(r2.befunde.find((b) => b.regel === 'pruefung/unvollstaendig')?.stufe, 'block');
  assert.equal(risiko({ filename: 'x.mjs' }), 0);
  assert.equal(risiko({ filename: 'x.woff2' }), 1);
  assert.equal(risiko({ filename: 'x.png' }), 2);
});

test('LFS-Zeiger und leere Binärdateien sind kein Befund', () => {
  const lfs = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1234\n');
  assert.deepEqual(pruefeTarnung({ filename: 'img/logo.png' }, lfs), []);
  assert.deepEqual(pruefeTarnung({ filename: 'a.woff2' }, Buffer.alloc(0)), []);
});

test('Blockchain-API-Abfrage ist warn, bekannte C2-Adresse bleibt block, -min.js gilt als generiert', () => {
  const doc = datei('docs/aptos.md', ['curl https://fullnode.mainnet.aptoslabs.com/v1/accounts/0x' + 'a'.repeat(64) + '/transactions']);
  const b = pruefeMarker(doc, added(doc));
  assert.equal(b[0]?.stufe, 'warn');
  const c2 = datei('x.js', ['const a = "TMfKQEd7TJJa5xNZJZ2Lep838vrzrs7mAP";']);
  assert.equal(pruefeMarker(c2, added(c2))[0]?.stufe, 'block');
  const min = datei('underscore/underscore-min.js', [pseudoBlob(19000) + 'Function(']);
  assert.deepEqual(pruefeAnhang(min, added(min)), []);
});

test('Lokaler Modus hat keinen Blob-Deckel; Markdown-Hinweis steht im Code-Span', async () => {
  const viele = Array.from({ length: 120 }, (_, i) => ({ pfad: `f${i}.woff2`, bytes: Buffer.from('774f4632', 'hex') }));
  const r = await pruefeLokal(viele);
  assert.deepEqual(r.befunde, []);
  const m = toMarkdown({ befunde: [], meta: { ziel: 'x', dateien: 1, hinweise: ['x @user www.evil.tld: kein Diff'] } });
  assert.ok(m.includes('`x @user www.evil.tld: kein Diff`'));
});

test('Runde 3: Budget, Tempo bei 5 MB kurzer Zeilen, exakte C2-Hosts, generierte Riesen-Datei nur warn', async () => {
  const { pruefeDateien: pd, BLOB_CODE: max } = await import('../lib/regeln/index.mjs');
  const kurz = { filename: 'src/x.js', status: 'modified', additions: 0, sha: 'a'.repeat(40) };
  const t = Date.now();
  // 2,2 MB kurzer Zeilen mit Budget 2 MB: schneller Test, gleiche Logik wie beim 5-MB-Limit
  const buf = Buffer.from('a;\n'.repeat(750_000));
  const r = await pd([kurz], { budget: 2 * 1024 * 1024, ladeBytes: async (d, m) => buf.subarray(0, m) });
  assert.ok(Date.now() - t < 6000, `750k kurze Zeilen in ${Date.now() - t} ms (vor der Optimierung ~4 s)`);
  assert.equal(r.befunde.find((b) => b.regel === 'pruefung/unvollstaendig')?.stufe, 'block', 'am Limit → block');
  const lock = { filename: 'package-lock.json', status: 'modified', additions: 0, sha: 'a'.repeat(40) };
  const r2 = await pd([lock], { ladeBytes: async (d, m) => Buffer.alloc(m, 0x20) });
  assert.equal(r2.befunde.find((b) => b.regel === 'pruefung/unvollstaendig')?.stufe, 'warn', 'generierte Datei am Limit → warn');
  const drei = Array.from({ length: 3 }, (_, i) => ({ filename: `c${i}.mjs`, status: 'modified', additions: 0, sha: 'a'.repeat(40) }));
  const r3 = await pd(drei, { budget: 1000, ladeBytes: async (d, m) => Buffer.alloc(Math.min(m, 600), 0x20) });
  assert.ok(r3.befunde.some((b) => /Budget/.test(b.warum) && b.stufe === 'block'));
  const fp = datei('README.md', ['https://my-260120.vercel.app and default-configuration.vercel.app.evil.com']);
  assert.deepEqual(pruefeMarker(fp, added(fp)), []);
  const echt = datei('x.js', ['fetch("https://260120.vercel.app/x")']);
  assert.equal(pruefeMarker(echt, added(echt))[0]?.regel, 'marker/polinrider-c2-host');
});
