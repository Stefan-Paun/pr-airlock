import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../bin/schleuse.mjs';
import { selbsttest, heute } from '../lib/selbsttest/index.mjs';
import { quoteText, alsMarkdown } from '../lib/selbsttest/bericht.mjs';
import { werte } from '../lib/selbsttest/auswertung.mjs';

const exec = promisify(execFile);
const BIN = new URL('../bin/schleuse.mjs', import.meta.url).pathname;
const KENNZAHLEN = new URL('../docs/KENNZAHLEN.md', import.meta.url);

async function lauf(args) {
  try { const r = await exec(process.execPath, [BIN, ...args], { maxBuffer: 8 * 1024 * 1024 }); return { code: 0, ...r }; } catch (e) { return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
}

/** Kleiner Korpus im Temp-Ordner: { 'boese/name': { fall, dateien } }. */
async function miniKorpus(faelle) {
  const wurzel = await mkdtemp(path.join(os.tmpdir(), 'schleuse-mini-'));
  for (const [ort, { fall, dateien = {} }] of Object.entries(faelle)) {
    const ordner = path.join(wurzel, ort);
    await mkdir(ordner, { recursive: true });
    await writeFile(path.join(ordner, 'fall.json'), JSON.stringify(fall));
    for (const [n, t] of Object.entries(dateien)) await writeFile(path.join(ordner, n), t);
  }
  return wurzel;
}
const gitignoreFall = (kennung, zeile) => ({
  fall: { kennung, art: 'boese', warum: '.gitignore versteckt ein Skript', erwartet: [{ regel: 'projekt/gitignore-versteck', stufe: 'warn' }], dateien: [{ pfad: '.gitignore', diff: '1.diff' }] },
  dateien: { '1.diff': `@@ -1,1 +1,2 @@\n node_modules/\n+${zeile}\n` },
});
const guterFall = (kennung, zeile) => ({
  fall: { kennung, art: 'gut', warum: 'ein ganz normales Skript', dateien: [{ pfad: 'package.json', diff: '1.diff' }] },
  dateien: { '1.diff': `@@ -1,1 +1,2 @@\n   "scripts": {\n+${zeile}\n` },
});

test('parseArgs: selbsttest mit Optionen, falsche Kombinationen werden abgelehnt', () => {
  const o = parseArgs(['selbsttest', '--format', 'md', '--regel', 'anhang/*', '--regel', 'marker/*', '--datum', '2026-11-27']);
  assert.equal(o.befehl, 'selbsttest');
  assert.equal(o.format, 'md');
  assert.deepEqual(o.regel, ['anhang/*', 'marker/*']);
  assert.throws(() => parseArgs(['selbsttest', '--format', 'html']), /--format/);
  assert.throws(() => parseArgs(['selbsttest', '--datum', '27.11.2026']), /--datum/);
  assert.throws(() => parseArgs(['selbsttest', 'extra']), /no arguments/);
  assert.throws(() => parseArgs(['selbsttest', '--fail-on', 'warn']), /only --format/);
  assert.throws(() => parseArgs(['scan', '--format', 'md']), /only apply to selbsttest/);
});

test('quoteText: immer mit Zähler und Nenner, nie fälschlich 0 % oder 100 %', () => {
  assert.equal(quoteText({ zaehler: 57, nenner: 58 }), '98 % (57/58)');
  assert.equal(quoteText({ zaehler: 199, nenner: 200 }), '99 % (199/200)');
  assert.equal(quoteText({ zaehler: 1, nenner: 300 }), '1 % (1/300)');
  assert.equal(quoteText({ zaehler: 0, nenner: 63 }), '0 % (0/63)');
  assert.equal(quoteText({ zaehler: 0, nenner: 0 }), '– (0/0)');
});

test('selbsttest CLI auf dem mitgelieferten Korpus: bestanden, Exit 0, alle Formate', async () => {
  const text = await lauf(['selbsttest']);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /Ergebnis: bestanden/);
  assert.match(text.stdout, /anhang\/fuellung\s+\d+ % \(\d+\/\d+\)/);
  const json = await lauf(['selbsttest', '--format', 'json', '--regel', 'tarnung/*']);
  assert.equal(json.code, 0);
  const j = JSON.parse(json.stdout);
  assert.ok(j.regeln.every((r) => r.id.startsWith('tarnung/')));
  assert.deepEqual(j.hygiene, []);
  const md = await lauf(['selbsttest', '--format', 'md', '--datum', '2001-02-03']);
  assert.equal(md.code, 0);
  assert.match(md.stdout, /^# Kennzahlen\n\nErzeugt am 2001-02-03/);
});

test('selbsttest Exit-Codes: fehlender Befund 1, Fehlalarm 1, Hygiene-Verstoß 1, kaputter Korpus 2', async () => {
  const sauber = await miniKorpus({ 'boese/treffer': gitignoreFall('treffer', 'config.bat'), 'gut/still': guterFall('still', '    "lint": "eslint .",') });
  const fehlt = await miniKorpus({ 'boese/verfehlt': gitignoreFall('verfehlt', 'cache/') });
  const alarm = await miniKorpus({ 'boese/treffer': gitignoreFall('treffer', 'config.bat'), 'gut/laerm': guterFall('laerm', '    "postinstall": "node x.js",') });
  const schmutzig = await miniKorpus({ 'boese/treffer': gitignoreFall('treffer', 'config.bat'), 'gut/adresse': guterFall('adresse', '    "docs": "open https://docs.beispiel-firma.io",') });
  const kaputt = await miniKorpus({ 'gut/kaputt': { fall: { kennung: 'anders', art: 'gut', warum: 'passt nicht zum Ordner', dateien: [] } } });
  try {
    assert.equal((await lauf(['selbsttest', '--korpus', sauber])).code, 0);
    const r1 = await lauf(['selbsttest', '--korpus', fehlt]);
    assert.equal(r1.code, 1);
    assert.match(r1.stdout, /verfehlt · Lücke · projekt\/gitignore-versteck/);
    const r2 = await lauf(['selbsttest', '--korpus', alarm]);
    assert.equal(r2.code, 1);
    assert.match(r2.stdout, /laerm · Fehlalarm · autostart\/npm-lifecycle/);
    const r3 = await lauf(['selbsttest', '--korpus', schmutzig]);
    assert.equal(r3.code, 1);
    assert.match(r3.stdout, /Korpus-Hygiene verletzt/);
    const r4 = await lauf(['selbsttest', '--korpus', kaputt]);
    assert.equal(r4.code, 2);
    assert.match(r4.stderr, /passt nicht zum Ordner/);
  } finally {
    for (const w of [sauber, fehlt, alarm, schmutzig, kaputt]) await rm(w, { recursive: true, force: true });
  }
});

test('docs/KENNZAHLEN.md passt zum Korpus (sonst: node bin/schleuse.mjs selbsttest --format md --datum <heute> > docs/KENNZAHLEN.md)', async () => {
  const eingecheckt = await readFile(KENNZAHLEN, 'utf8');
  const datum = /^Erzeugt am (\d{4}-\d{2}-\d{2}) /m.exec(eingecheckt)?.[1];
  assert.ok(datum, 'Datum der Erzeugung fehlt');
  const { stdout, code } = await selbsttest({ format: 'md', datum });
  assert.equal(code, 0);
  assert.equal(eingecheckt, stdout);
});

test('Markdown ist reproduzierbar und braucht ein Datum', () => {
  const w = werte([{ kennung: 'b1', art: 'boese', erwartet: [{ regel: 'anhang/fuellung' }], bekannt: [] }], new Map([['b1', [{ regel: 'anhang/fuellung', stufe: 'block' }]]]));
  assert.equal(alsMarkdown(w, { datum: '2026-01-02' }), alsMarkdown(w, { datum: '2026-01-02' }));
  assert.throws(() => alsMarkdown(w, {}), /datum/);
  assert.match(heute(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('Review-Funde: ungültiges Datum, fremde Einträge im Korpus, Steuerzeichen im Pfad, JSON-escapte Adresse', async () => {
  const { pruefeHygiene } = await import('../lib/selbsttest/hygiene.mjs');
  const { ladeKorpus } = await import('../lib/selbsttest/korpus.mjs');
  const { symlink } = await import('node:fs/promises');
  assert.throws(() => parseArgs(['selbsttest', '--datum', '2026-99-99']), /valid date/);
  await assert.rejects(selbsttest({ format: 'md', datum: '2026-02-30' }), /valid date/);
  assert.ok(pruefeHygiene('"url": "https:\\/\\/c2.beispiel-angreifer.ru\\/x"').length > 0);

  const mitDatei = await miniKorpus({ 'boese/treffer': gitignoreFall('treffer', 'config.bat') });
  await writeFile(path.join(mitDatei, 'boese', 'streu.txt'), 'x');
  const mitLink = await miniKorpus({ 'boese/treffer': gitignoreFall('treffer', 'config.bat') });
  await symlink(path.join(mitLink, 'boese', 'treffer'), path.join(mitLink, 'boese', 'link'));
  const steuer = await miniKorpus({ 'gut/steuer': { fall: { kennung: 'steuer', art: 'gut', warum: 'Pfad mit Steuerzeichen', dateien: [{ pfad: 'a\u001b]0;x\u0007.js', hex: '00' }] } } });
  const ohneStufe = await miniKorpus({ 'gut/still': { ...guterFall('still', '    "lint": "eslint .",'), fall: { ...guterFall('still', '').fall, bekannt: [{ art: 'fehlalarm', regel: 'autostart/npm-lifecycle', grund: 'Stufe fehlt hier absichtlich' }] } } });
  try {
    await assert.rejects(ladeKorpus(mitDatei), /kein Fall-Ordner/);
    await assert.rejects(ladeKorpus(mitLink), /kein Fall-Ordner/);
    await assert.rejects(ladeKorpus(steuer), /Steuerzeichen/);
    await assert.rejects(ladeKorpus(ohneStufe), /bekannt\.stufe/);
    const r = await lauf(['selbsttest', '--korpus', steuer]);
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes('\u001b'), 'keine Escape-Sequenz im Terminal');
  } finally {
    for (const w of [mitDatei, mitLink, steuer, ohneStufe]) await rm(w, { recursive: true, force: true });
  }
});
