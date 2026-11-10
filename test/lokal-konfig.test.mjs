// diff/scan wenden die Konfiguration vom Merge-Base an (wie `pr`) und melden Änderungen an .schleuse.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruefeDiff, pruefeScan } from '../lib/lokal.mjs';
import { gitUmgebung } from '../lib/git.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { pseudoBlob } from './hilfen.mjs';

const ENV = { ...gitUmgebung(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: os.devNull };
const g = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const schreibe = (dir, rel, inhalt) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), inhalt); };
const commit = (dir, msg) => { g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); };
const mitRepo = async (fn) => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'schleuse-k-'));
  g(d, 'init', '-q', '-b', 'main');
  try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};
const konfig = (regeln, extra = {}) => JSON.stringify({ version: 1, regeln, ...extra });
const RIESIG = 'const x = "' + pseudoBlob(3000) + '"; eval(String.fromCharCode(1)); atob(1);\n';
const stufeVon = (r, regel) => r.befunde.find((b) => b.regel === regel)?.stufe;

test('diff: .schleuse.json vom Merge-Base wirkt (Regel auf hinweis herabgestuft)', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'hinweis' }));
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'pr');
    const r = await pruefeDiff(d, undefined);
    assert.equal(r.konfig.quelle, 'datei');
    assert.equal(stufeVon(r, 'anhang/riesenzeile'), 'info');
    assert.ok(!r.befunde.some((b) => b.regel === 'konfig/aenderung'));
  });
});

test('diff: ohne Konfiguration gilt der Standard (gleiche Datei, härterer Befund)', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'pr');
    const r = await pruefeDiff(d, undefined);
    assert.equal(r.konfig.quelle, 'standard');
    assert.notEqual(stufeVon(r, 'anhang/riesenzeile'), 'info');
    assert.ok(stufeVon(r, 'anhang/riesenzeile'));
  });
});

test('diff: Änderung an .schleuse.json im Kopf ist ein Befund und wirkt nicht', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'fehler' }));
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'aus' }, { ausnahmen: [{ pfad: 'test/fixtures/**', grund: 'Fixtures sind harmlos' }] }));
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'pr lockert');
    const r = await pruefeDiff(d, 'main..f');
    const kb = r.befunde.find((b) => b.regel === 'konfig/aenderung');
    assert.equal(kb?.stufe, 'block');
    assert.ok(kb.details.some((x) => /Regel anhang\/riesenzeile: fehler → aus/.test(x)));
    assert.equal(stufeVon(r, 'anhang/riesenzeile'), 'block', 'die Lockerung des Kopfs wirkt nicht');
    assert.match(toConsole(r, { farbe: false }), /konfig\/aenderung/);
  });
});

test('diff: neue und gelöschte .schleuse.json werden gemeldet', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'neu');
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'aus' })); commit(d, 'legt an');
    const neu = await pruefeDiff(d, 'main..neu');
    assert.equal(stufeVon(neu, 'konfig/aenderung'), 'block');
    assert.equal(neu.konfig.quelle, 'standard');

    g(d, 'checkout', '-q', 'main');
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'fehler' })); commit(d, 'main mit Konfiguration');
    g(d, 'checkout', '-q', '-b', 'weg');
    unlinkSync(path.join(d, '.schleuse.json')); commit(d, 'loescht');
    const weg = await pruefeDiff(d, 'main..weg');
    const kb = weg.befunde.find((b) => b.regel === 'konfig/aenderung');
    assert.ok(kb);
    assert.match(kb.warum, /löscht/);
    assert.equal(weg.konfig.quelle, 'datei');
  });
});

test('diff: kaputte Konfiguration im Basis-Stand ist ein Befund (fail-closed, Standard gilt)', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', '{kaputt'); schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'pr');
    const r = await pruefeDiff(d, undefined);
    assert.ok(r.befunde.some((b) => b.regel === 'konfig/ungueltig'));
    assert.equal(r.konfig.quelle, 'standard');
  });
});

test('diff: --fail-on aus den Eingaben schlägt die Datei', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', konfig({}, { failOn: 'warnung' })); schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, 'b.txt', '2\n'); commit(d, 'pr');
    assert.equal((await pruefeDiff(d, undefined)).konfig.failOn, 'warn');
    assert.equal((await pruefeDiff(d, undefined, { eingaben: { failOn: 'info' } })).konfig.failOn, 'info');
  });
});

test('diff ohne Argument auf dem Hauptzweig selbst: klare Warnung statt stiller „0 Dateien“', async () => {
  await mitRepo(async (d) => {
    schreibe(d, 'a.txt', '1\n'); commit(d, 'start');
    const r = await pruefeDiff(d, undefined);
    assert.equal(r.meta.dateien, 0);
    assert.ok(r.hinweise.some((h) => /Keine Änderungen zu prüfen/.test(h) && /HEAD~1\.\.HEAD/.test(h)));
    assert.match(toConsole(r, { farbe: false }), /Keine Änderungen zu prüfen/);
    // ein Zweig mit Commits bekommt die Warnung nicht
    g(d, 'checkout', '-q', '-b', 'f'); schreibe(d, 'b.txt', '2\n'); commit(d, 'pr');
    assert.ok(!(await pruefeDiff(d, undefined)).hinweise.some((h) => /Keine Änderungen zu prüfen/.test(h)));
  });
});

test('scan: Konfiguration vom Merge-Base wirkt; auf dem Hauptzweig gibt es keinen Änderungsbefund', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'hinweis' }));
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'start');
    const r = await pruefeScan(d);
    assert.equal(r.konfig.quelle, 'datei');
    assert.equal(stufeVon(r, 'anhang/riesenzeile'), 'info');
    assert.ok(!r.befunde.some((b) => b.regel === 'konfig/aenderung'));
  });
});

test('scan auf einem Zweig: geänderte .schleuse.json ist ein Befund und wirkt nicht', async () => {
  await mitRepo(async (d) => {
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'fehler' }));
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'start');
    g(d, 'checkout', '-q', '-b', 'f');
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'aus' })); commit(d, 'lockert');
    const r = await pruefeScan(d);
    assert.equal(stufeVon(r, 'konfig/aenderung'), 'block');
    assert.equal(stufeVon(r, 'anhang/riesenzeile'), 'block');
  });
});

test('scan ohne auffindbaren Hauptzweig: Standard-Konfiguration und Hinweis', async () => {
  await mitRepo(async (d) => {
    g(d, 'checkout', '-q', '-b', 'trunk');
    schreibe(d, '.schleuse.json', konfig({ 'anhang/riesenzeile': 'hinweis' }));
    schreibe(d, 'test/fixtures/riesig.js', RIESIG); commit(d, 'start');
    const r = await pruefeScan(d);
    assert.equal(r.konfig.quelle, 'standard');
    assert.ok(r.hinweise.some((h) => /Keine Basis für \.schleuse\.json/.test(h)));
    const mitBase = await pruefeScan(d, { basis: 'trunk' });
    assert.equal(mitBase.konfig.quelle, 'datei');
  });
});
