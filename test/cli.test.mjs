import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, exitCode } from '../bin/schleuse.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { pseudoBlob, fuellung } from './hilfen.mjs';

const exec = promisify(execFile);
const BIN = new URL('../bin/schleuse.mjs', import.meta.url).pathname;

const ergebnisMitBefund = {
  befunde: [{ regel: 'anhang/fuellung', stufe: 'block', datei: 'a/postcss.config.mjs', zeile: 9, auszug: 'x](http://evil) <img> `tick` |pipe|', warum: 'Code hinter 507 Leerzeichen', quelle: 'q' },
    { regel: 'autostart/npm-lifecycle', stufe: 'warn', datei: 'package.json', zeile: 3, auszug: '"postinstall": "node x"', warum: 'läuft bei install', quelle: 'q' }],
  meta: { ziel: 'org/repo#1', dateien: 3, hinweise: ['Hinweis <b>'] },
};

test('parseArgs und exitCode', () => {
  assert.equal(parseArgs([]).befehl, 'help');
  assert.deepEqual(parseArgs(['pr', 'a/b#1', '--fail-on', 'warn']).ziel, ['a/b#1']);
  assert.throws(() => parseArgs(['tanzen']), /Unknown command/);
  assert.throws(() => parseArgs(['pr']), /Which PR/);
  assert.throws(() => parseArgs(['pr', 'a/b#1', '--fail-on', 'nie']), /fail-on/);
  assert.equal(exitCode(ergebnisMitBefund, 'block'), 1);
  assert.equal(exitCode({ befunde: ergebnisMitBefund.befunde.slice(1) }, 'block'), 0);
  assert.equal(exitCode({ befunde: ergebnisMitBefund.befunde.slice(1) }, 'warn'), 1);
});

test('Markdown: Sticky-Marker, Fremdtext escaped, kein roher Link/HTML', () => {
  const m = toMarkdown(ergebnisMitBefund);
  assert.ok(m.startsWith('<!-- schleuse -->'));
  assert.ok(!m.includes('<img>') && !m.includes('<b>') && !m.includes('|pipe|'));
  assert.ok(!/\]\(http:\/\/evil\)/.test(m.replace(/`[^`]*`/g, '')), 'kein Link außerhalb von Code-Spans');
  assert.ok(m.includes('1 block · 1 warn · 0 info'));
  assert.ok(toMarkdown({ befunde: [], meta: { ziel: 'x', dateien: 2 } }).includes('✅'));
});

test('SARIF 2.1.0 mit Regeln und Ergebnissen; Konsole ohne Farben', () => {
  const s = toSarif(ergebnisMitBefund);
  assert.equal(s.version, '2.1.0');
  assert.ok(s.runs[0].tool.driver.rules.length >= 13);
  assert.equal(s.runs[0].results.length, 2);
  assert.equal(s.runs[0].results[0].level, 'error');
  assert.equal(s.runs[0].results[0].locations[0].physicalLocation.region.startLine, 9);
  const k = toConsole(ergebnisMitBefund, { farben: false });
  assert.ok(k.includes('BLOCK') && k.includes('a/postcss.config.mjs:9') && !k.includes('\x1b'));
});

test('CLI files: vergiftete Konfig → Exit 1 mit Berichten, saubere → Exit 0, Fehler → Exit 2', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-'));
  try {
    const boese = path.join(dir, 'postcss.config.mjs');
    await writeFile(boese, 'export default {};' + fuellung(507) + "global['!']='8-270-2';" + pseudoBlob(5000) + '\n');
    const sauber = path.join(dir, 'ok.js');
    await writeFile(sauber, 'export const a = 1;\n');
    const md = path.join(dir, 'b.md'); const sarif = path.join(dir, 'b.sarif'); const json = path.join(dir, 'b.json');
    await assert.rejects(exec(process.execPath, [BIN, 'files', boese, '--md', md, '--sarif', sarif, '--json', json]), (e) => e.code === 1 && /BLOCK/.test(e.stdout));
    assert.match(await readFile(md, 'utf8'), /anhang\\\/fuellung|anhang\/fuellung/);
    assert.equal(JSON.parse(await readFile(sarif, 'utf8')).version, '2.1.0');
    assert.equal(JSON.parse(await readFile(json, 'utf8')).befunde.length, 2); // Marker + Füllung
    const { stdout } = await exec(process.execPath, [BIN, 'files', sauber]);
    assert.match(stdout, /Keine Auffälligkeit/);
    await assert.rejects(exec(process.execPath, [BIN, 'files', path.join(dir, 'fehlt.js')]), (e) => e.code === 2);
    const hilfe = await exec(process.execPath, [BIN, '--help']);
    assert.match(hilfe.stdout, /schleuse pr/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
