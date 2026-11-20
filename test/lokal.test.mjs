import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruefeDiff, pruefeScan, zerlegeBereich, leseAenderungen } from '../lib/lokal.mjs';
import { pruefeDateien } from '../lib/regeln/index.mjs';
import { git, gitUmgebung, loeseRev } from '../lib/git.mjs';
import { parseArgs } from '../bin/schleuse.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

// Test-Repos nutzen eine eigene, saubere git-Umgebung (nie Stefans Konfiguration).
const ENV = { ...gitUmgebung(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: os.devNull };
const g = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

export function neuesRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'schleuse-t-'));
  g(dir, 'init', '-q', '-b', 'main');
  return dir;
}
const schreibe = (dir, rel, inhalt) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), inhalt); };
const commit = (dir, msg) => { g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); };
const schluessel = (r) => r.befunde.map((b) => `${b.regel}|${b.stufe}|${b.datei}`).sort();
const mitRepo = async (fn) => { const d = neuesRepo(); try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

const boese = 'export default {};' + fuellung(507) + pseudoBlob(3000) + 'fromCharCode(';
const woff2 = Buffer.from('774f46320001000000015ff000130000', 'hex');

test('zerlegeBereich', () => {
  assert.deepEqual(zerlegeBereich('main..x'), { art: 'direkt', a: 'main', b: 'x' });
  assert.deepEqual(zerlegeBereich('main...x'), { art: 'merge-base', a: 'main', b: 'x' });
  assert.deepEqual(zerlegeBereich('x'), { art: 'gegen-hauptzweig', a: null, b: 'x' });
  assert.deepEqual(zerlegeBereich(undefined), { art: 'gegen-hauptzweig', a: null, b: 'HEAD' });
});

test('diff: gleiche Befunde wie der API-Weg für denselben Inhalt', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'README.md', 'hallo\n');
    commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'fremd');
    schreibe(d, 'postcss.config.mjs', boese + '\n');
    schreibe(d, 'package.json', '{\n  "scripts": {\n    "postinstall": "node x.js"\n  }\n}\n');
    schreibe(d, 'sauber.txt', 'nichts\n');
    commit(d, 'pr');
    const lokal = await pruefeDiff(d, 'main..fremd');
    const api = await pruefeDateien([
      datei('postcss.config.mjs', [boese], { status: 'added' }),
      datei('package.json', ['{', '  "scripts": {', '    "postinstall": "node x.js"', '  }', '}'], { status: 'added' }),
      datei('sauber.txt', ['nichts'], { status: 'added' }),
    ]);
    assert.ok(lokal.befunde.some((b) => b.stufe === 'block'));
    assert.deepEqual(schluessel(lokal), schluessel(api));
    assert.equal(lokal.meta.dateien, 3);
  });
});

test('diff: Standard = HEAD gegen Merge-Base mit main; ...-Form und Einzel-Revision', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'eslint.config.mjs', boese + '\n'); commit(d, 'pr');
    g(d, 'checkout', '-q', 'main');
    schreibe(d, 'nur-main.txt', 'x\n'); commit(d, 'main weiter');
    g(d, 'checkout', '-q', 'f');
    const std = await pruefeDiff(d, undefined);
    assert.equal(std.meta.dateien, 1, 'nur die Änderung des Zweigs, nicht nur-main.txt');
    assert.ok(std.befunde.some((b) => b.datei === 'eslint.config.mjs' && b.stufe === 'block'));
    assert.deepEqual(schluessel(await pruefeDiff(d, 'main...f')), schluessel(std));
    assert.deepEqual(schluessel(await pruefeDiff(d, 'f')), schluessel(std));
    assert.equal((await pruefeDiff(d, 'main..f')).meta.dateien, 2, 'zweipunktig vergleicht direkt');
  });
});

test('diff: Umbenennung ohne Änderung ist unauffällig, Umbenennung mit Payload wird gefunden', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'alt.config.mjs', 'export default {};\n'.repeat(20)); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    g(d, 'mv', 'alt.config.mjs', 'neu.config.mjs'); commit(d, 'rename');
    const r1 = await leseAenderungen(d, 'main..f');
    assert.equal(r1.dateien[0].status, 'renamed');
    assert.equal(r1.dateien[0].previous_filename, 'alt.config.mjs');
    assert.equal((await pruefeDiff(d, 'main..f')).befunde.length, 0);
    schreibe(d, 'neu.config.mjs', 'export default {};\n'.repeat(20) + boese + '\n'); commit(d, 'edit');
    const r2 = await pruefeDiff(d, 'main..f');
    assert.ok(r2.befunde.some((b) => b.datei === 'neu.config.mjs' && b.stufe === 'block'));
  });
});

test('diff: Binärdatei – echte Schrift ok, Text als .woff2 getarnt wird geblockt', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    writeFileSync(path.join(d, 'ok.woff2'), Buffer.concat([woff2, Buffer.alloc(64, 1)]));
    schreibe(d, 'fa-solid-400.woff2', 'global["!"]="8-270-2";' + pseudoBlob(2000) + 'eval(');
    commit(d, 'fonts');
    const r = await pruefeDiff(d, 'main..f');
    const t = r.befunde.filter((b) => b.regel === 'tarnung/magic-bytes');
    assert.deepEqual(t.map((b) => b.datei), ['fa-solid-400.woff2']);
    assert.equal(t[0].stufe, 'block');
  });
});

test('diff: Größenlimit je Datei – Code ohne Patch wird trotzdem ganz geprüft, Rest meldet sich', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'next.config.mjs', 'export default {};\n' + 'x'.repeat(5000) + '\n' + boese + '\n');
    schreibe(d, 'daten.csv', 'a,b\n'.repeat(5000));
    commit(d, 'gross');
    const r = await pruefeDiff(d, 'main..f', { patchDatei: 1000 });
    const l = await leseAenderungen(d, 'main..f', { patchDatei: 1000 });
    assert.ok(l.dateien.every((x) => !x.patch), 'kein Patch über dem Limit');
    assert.ok(r.befunde.some((b) => b.datei === 'next.config.mjs' && b.regel === 'anhang/fuellung'), 'Code per Blob geprüft');
    assert.ok(r.meta.hinweise.some((h) => /daten\.csv/.test(h)), 'Nicht-Code ohne Diff wird gemeldet');
    // Gesamtlimit
    const l2 = await leseAenderungen(d, 'main..f', { patchGesamt: 100 });
    assert.ok(l2.dateien.every((x) => !x.patch));
  });
});

test('diff: Dateinamen mit Leerzeichen, Sonderzeichen, Umlaut und führendem Bindestrich', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    const namen = ['-postcss.config.mjs', 'mit leer zeichen.config.mjs', 'ümläut"quote\'.config.mjs', 'tab\there.config.mjs', 'sub dir/--x.config.mjs'];
    for (const n of namen) schreibe(d, n, boese + '\n');
    commit(d, 'namen');
    const r = await pruefeDiff(d, 'main..f');
    assert.equal(r.meta.dateien, namen.length);
    assert.deepEqual(r.befunde.filter((b) => b.regel === 'anhang/fuellung').map((b) => b.datei).sort(), [...namen].sort());
    const s = await pruefeScan(d);
    assert.equal(s.befunde.filter((b) => b.regel === 'anhang/fuellung').length, namen.length);
  });
});

test('diff: Revisionen sind nie Optionen', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    await assert.rejects(pruefeDiff(d, '--output=/tmp/schleuse-boese..HEAD'), /Ungültige Revision/);
    await assert.rejects(pruefeDiff(d, '..-x'), /Ungültige Revision/);
    await assert.rejects(pruefeDiff(d, 'gibtsnicht..HEAD'), /nicht gefunden/);
    await assert.rejects(loeseRev(d, 'HEAD --version'), /Ungültige Revision/);
    assert.equal((await pruefeDiff(d, 'main')).meta.dateien, 0, 'HEAD gegen sich selbst: keine Änderung');
  });
});

test('scan: findet dieselben Befunde wie der API-Weg, ohne node_modules und ohne Ignoriertes', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.gitignore', 'ignoriert.config.mjs\n');
    schreibe(d, 'postcss.config.mjs', boese + '\n');
    schreibe(d, 'sauber.js', 'console.log(1);\n');
    schreibe(d, 'ignoriert.config.mjs', boese + '\n');
    schreibe(d, 'node_modules/pkg/x.config.mjs', boese + '\n');
    schreibe(d, 'start.sh', '#!/bin/sh\necho hi\n'); // „neues Skript im Root“ wäre im Scan ein Fehlalarm
    writeFileSync(path.join(d, 'font.woff2'), Buffer.from('global["!"]="8-270-2";eval(' + pseudoBlob(500)));
    g(d, 'add', '-f', 'node_modules/pkg/x.config.mjs');
    g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'alles');
    const r = await pruefeScan(d);
    const api = await pruefeDateien([datei('postcss.config.mjs', [boese, ''], { status: 'added' })]);
    assert.ok(schluessel(api).every((k) => schluessel(r).includes(k)));
    assert.ok(r.befunde.some((b) => b.regel === 'tarnung/magic-bytes' && b.datei === 'font.woff2'));
    assert.ok(!r.befunde.some((b) => /node_modules|ignoriert/.test(b.datei)));
    assert.ok(!r.befunde.some((b) => b.regel === 'projekt/neues-skript-im-root'));
    assert.deepEqual(r.meta.nichtAnwendbar.map((x) => x.id), ['projekt/workflow-aus-fork', 'projekt/neues-skript-im-root', 'lieferkette/lock-ohne-manifest', 'lieferkette/quelle-gewechselt', 'lieferkette/direkt-von-git-oder-url', 'lieferkette/install-skript', 'lieferkette/namensnaehe']);
    assert.ok(r.meta.hinweise.some((h) => /node_modules/.test(h)));
    assert.match(toConsole(r, { farben: false }), /nicht anwendbar im Scan: projekt\/workflow-aus-fork/);
    assert.match(toMarkdown(r), /Nicht anwendbar im Scan/);
    assert.match(toMarkdown(r), /verfolgten Dateien/);
    // Gegenprobe: dasselbe Skript als Änderung (diff) wird gemeldet
    g(d, 'checkout', '-q', '-b', 'f'); schreibe(d, 'neu.sh', 'echo\n'); commit(d, 'neu');
    assert.ok((await pruefeDiff(d, 'main..f')).befunde.some((b) => b.regel === 'projekt/neues-skript-im-root'));
  });
});

test('scan: liest HEAD aus der Objektdatenbank, nicht das Arbeitsverzeichnis; Symlinks werden nie verfolgt', async () => {
  await mitRepo(async (d) => {
    const draussen = mkdtempSync(path.join(os.tmpdir(), 'schleuse-aussen-'));
    try {
      writeFileSync(path.join(draussen, 'ziel.mjs'), boese + '\n');
      symlinkSync(path.join(draussen, 'ziel.mjs'), path.join(d, 'link.config.mjs'));
      schreibe(d, 'ok.js', 'x\n');
      commit(d, 'mit link');
      schreibe(d, 'ok.js', boese + '\n'); // nicht committet → nicht Teil von HEAD
      const r = await pruefeScan(d);
      assert.equal(r.befunde.length, 0);
      assert.ok(r.meta.hinweise.some((h) => /Symlink/.test(h)));
      // auch im diff
      g(d, 'checkout', '-q', '-b', 'f'); g(d, 'checkout', '-q', '--', 'ok.js');
      rmSync(path.join(d, 'link.config.mjs')); symlinkSync(path.join(draussen, 'ziel.mjs'), path.join(d, 'zwei.config.mjs'));
      commit(d, 'noch ein link');
      const rd = await pruefeDiff(d, 'main..f');
      assert.ok(!rd.befunde.some((b) => b.datei === 'zwei.config.mjs'));
      assert.ok(rd.meta.hinweise.some((h) => /Symlink/.test(h)));
    } finally { rmSync(draussen, { recursive: true, force: true }); }
  });
});

test('scan: Dateilimit meldet sich, kein stilles Abschneiden', async () => {
  await mitRepo(async (d) => {
    for (let i = 0; i < 6; i++) schreibe(d, `f${i}.txt`, 'x\n');
    commit(d, 'viele');
    const r = await pruefeScan(d, { maxDateien: 4 });
    assert.ok(r.befunde.some((b) => b.regel === 'pruefung/unvollstaendig' && b.stufe === 'block'));
  });
});

test('CLI-Argumente: diff und scan, -- und Fehler', () => {
  assert.deepEqual(parseArgs(['diff']).ziel, []);
  assert.equal(parseArgs(['diff', 'a..b', '--repo', 'x', '--base', 'main']).base, 'main');
  assert.equal(parseArgs(['scan', '--', '-merkwuerdig']).ziel[0], '-merkwuerdig');
  assert.throws(() => parseArgs(['scan', 'a', 'b']), /at most one/);
  assert.throws(() => parseArgs(['diff', '--nope']), /Unknown option/);
});

test('CLI: Exit-Codes 0/1/2 und Berichte für diff und scan', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFileSync } = await import('node:fs');
  const lauf = (cwd, ...a) => promisify(execFile)(process.execPath, [new URL('../bin/schleuse.mjs', import.meta.url).pathname, ...a], { cwd, env: { PATH: process.env.PATH } }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    assert.equal((await lauf(d, 'scan')).code, 0);
    g(d, 'checkout', '-q', '-b', 'f'); schreibe(d, 'postcss.config.mjs', boese + '\n'); commit(d, 'pr');
    const json = path.join(d, '..', `bericht-${path.basename(d)}.json`);
    const r = await lauf(d, 'diff', 'main..f', '--json', json);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /anhang\/fuellung/);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).meta.modus, 'diff');
    rmSync(json);
    assert.equal((await lauf(d, 'diff', '--fail-on', 'block')).code, 1, 'Standard: HEAD gegen Merge-Base mit main');
    assert.equal((await lauf(d, 'scan')).code, 1);
    assert.equal((await lauf(d, 'diff', 'gibtsnicht..HEAD')).code, 2);
    assert.equal((await lauf(os.tmpdir(), 'scan', path.join(d, 'a.txt'))).code, 2, 'kein Verzeichnis');
    assert.equal((await lauf(d, 'diff', '--', '--output=x')).code, 2);
  });
});
