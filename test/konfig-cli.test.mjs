import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lauf } from '../bin/action.mjs';
import { parseArgs, exitCode } from '../bin/schleuse.mjs';
import { configPruefe, configZeige } from '../lib/konfig/befehl.mjs';
import { konfigAusMergeBase } from '../lib/konfig/git.mjs';
import { pruefeLokal } from '../lib/pruefung.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { pseudoBlob, datei } from './hilfen.mjs';

const exec = promisify(execFile);
const BIN = new URL('../bin/schleuse.mjs', import.meta.url).pathname;
const antwort = (daten) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(daten) });
const BASIS = 'a'.repeat(40);
const riesig = () => datei('test/fixtures/riesig.js', ['const x = "' + pseudoBlob(3000) + '"; eval(String.fromCharCode(1)); atob(1);']);

async function simuliere({ basisText, dateien, failOn }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-cfg-'));
  const event = path.join(dir, 'event.json');
  await writeFile(event, JSON.stringify({ pull_request: { number: 7 }, repository: { full_name: 'org/repo' } }));
  const summary = path.join(dir, 's.md'); await writeFile(summary, '');
  const fetchImpl = async (url) => {
    if (url.endsWith('/pulls/7')) return antwort({ number: 7, head: { sha: 'abc', repo: { full_name: 'org/repo' } }, base: { sha: BASIS, repo: { full_name: 'org/repo' } } });
    if (url.includes('/pulls/7/files')) return antwort(dateien);
    if (url.includes('/contents/.schleuse.json')) {
      if (basisText == null) return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' };
      const b = Buffer.from(basisText);
      return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), text: async () => '' };
    }
    return antwort({});
  };
  const env = { GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'org/repo', GITHUB_STEP_SUMMARY: summary, GITHUB_TOKEN: 't', ...(failOn ? { 'INPUT_FAIL-ON': failOn } : {}) };
  try { const r = await lauf({ env, fetchImpl, log: () => {} }); return { ...r, summary: await readFile(summary, 'utf8') }; } finally { await rm(dir, { recursive: true, force: true }); }
}

test('Rangfolge failOn: Eingabe > Datei (Basis-Stand) > Standard', async () => {
  const warnDatei = datei('package.json', ['{ "scripts": { "postinstall": "node setup.js" } }']);
  const ohne = await simuliere({ dateien: [warnDatei] });
  assert.equal(ohne.durchgefallen, false, 'Standard: erst ab block');
  const datei1 = await simuliere({ dateien: [warnDatei], basisText: '{"version":1,"failOn":"warnung"}' });
  assert.equal(datei1.durchgefallen, true, 'Datei: ab warnung');
  const eingabe = await simuliere({ dateien: [warnDatei], basisText: '{"version":1,"failOn":"warnung"}', failOn: 'block' });
  assert.equal(eingabe.durchgefallen, false, 'Eingabe schlägt Datei');
  await assert.rejects(simuliere({ dateien: [], failOn: 'nie' }), /fail-on muss/);
});

test('Action-Bericht nennt Unterdrücktes samt Grund', async () => {
  const basisText = JSON.stringify({ version: 1, ausnahmen: [{ pfad: 'test/fixtures/**', regel: 'anhang/riesenzeile', grund: 'Synthetische Fixtures' }] });
  const r = await simuliere({ dateien: [riesig()], basisText });
  assert.equal(r.durchgefallen, false);
  assert.match(r.summary, /unterdrückt/);
  assert.match(r.summary, /Synthetische Fixtures/);
});

test('Bericht: Konsole, Markdown und SARIF zeigen Unterdrücktes und Umgestuftes; Fremdtext bleibt entschärft', async () => {
  const basisText = JSON.stringify({ version: 1, regeln: { 'anhang/riesenzeile': 'hinweis' }, ausnahmen: [{ pfad: 'test/**', regel: 'tarnung/base64-block', grund: 'Grund <b>mit</b> | Pipe' }] });
  const ergebnis = await pruefeLokalMitBasis(basisText);
  assert.ok(ergebnis.unterdrueckt.length >= 1);
  const md = toMarkdown(ergebnis);
  assert.match(md, /per \.schleuse\.json unterdrückt/);
  assert.ok(!md.includes('<b>'), 'HTML im Grund wird entschärft');
  const konsole = toConsole(ergebnis, { farben: false });
  assert.match(konsole, /unterdrückt wegen: Grund/);
  assert.match(konsole, /von warn umgestuft|umgestuft/);
  const sarif = toSarif(ergebnis);
  assert.ok(sarif.runs[0].results.some((x) => x.suppressions?.[0]?.kind === 'external'));
});

async function pruefeLokalMitBasis(basisText) {
  const b64 = Buffer.from('x = "' + 'QUJD'.repeat(600) + '"');
  const riese = Buffer.from('const x = "' + pseudoBlob(3000) + '"; eval(String.fromCharCode(1)); atob(1);');
  return pruefeLokal([{ pfad: 'test/a.js', bytes: b64 }, { pfad: 'src/riese.js', bytes: riese }], { basisText });
}

test('config pruefe / zeige: Ausgabe und Exit-Codes', () => {
  const gut = configPruefe('{"version":1,"regeln":{"marker/*":"aus"}}');
  assert.equal(gut.code, 0);
  assert.match(gut.stdout, /gültig/);
  assert.match(gut.stdout, /geschützte Regel/);
  const schlecht = configPruefe('{"version":1,"regln":{}}');
  assert.equal(schlecht.code, 1);
  assert.match(schlecht.stderr, /regln: Unbekanntes Feld.*"regeln"/);
  const z = JSON.parse(configZeige('{"version":1,"failOn":"warnung","schwellen":{"riesenzeile":2000}}', { failOn: 'info' }).stdout);
  assert.deepEqual(z.failOn, { wert: 'hinweis', von: 'eingabe' });
  assert.equal(z.schwellen.riesenzeile, 2000);
  assert.equal(z.schwellen.entropie, 4.3);
  assert.ok(z.nichtAbschaltbar.includes('marker/polinrider-v1'));
  const std = JSON.parse(configZeige(null).stdout);
  assert.equal(std.quelle, 'standard (keine Datei)');
  assert.equal(std.failOn.wert, 'fehler');
  assert.equal(configZeige('{"version":1,"x":1}').code, 1);
});

test('parseArgs: config und --base', () => {
  assert.deepEqual(parseArgs(['config', 'pruefe', 'x.json']).ziel, ['pruefe', 'x.json']);
  assert.throws(() => parseArgs(['config']), /Which config command/);
  assert.throws(() => parseArgs(['config', 'tanzen']), /Which config command/);
  assert.equal(parseArgs(['files', 'a', '--base', 'origin/main']).base, 'origin/main');
  assert.equal(parseArgs(['files', 'a']).failOn, null);
  assert.equal(exitCode({ befunde: [{ stufe: 'warn' }], konfig: { failOn: 'warn' } }, null), 1);
  assert.equal(exitCode({ befunde: [{ stufe: 'warn' }], konfig: { failOn: 'warn' } }, 'block'), 0);
});

async function repo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-git-'));
  const git = (...a) => exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a]);
  await git('init', '-q', '-b', 'main');
  await writeFile(path.join(dir, '.schleuse.json'), '{"version":1,"regeln":{"anhang/riesenzeile":"fehler"}}');
  await git('add', '.'); await git('commit', '-q', '-m', 'basis');
  await git('checkout', '-q', '-b', 'pr');
  await writeFile(path.join(dir, '.schleuse.json'), '{"version":1,"regeln":{"anhang/riesenzeile":"aus"}}');
  await git('commit', '-q', '-am', 'lockern');
  return { dir, git };
}

test('Lokal: Konfiguration vom Merge-Base, nicht aus dem Arbeitsstand; geänderte Datei → Befund', async () => {
  const { dir } = await repo();
  try {
    const r = await konfigAusMergeBase('main', { cwd: dir });
    assert.match(r.text.toString(), /"fehler"/, 'Basis-Fassung, nicht die gelockerte');
    const arbeit = await readFile(path.join(dir, '.schleuse.json'));
    const erg = await pruefeLokal([{ pfad: '.schleuse.json', bytes: arbeit }], { basisText: r.text });
    const kb = erg.befunde.find((b) => b.regel === 'konfig/aenderung');
    assert.ok(kb && kb.details.some((d) => /anhang\/riesenzeile: fehler → aus/.test(d)));
    const gleich = await pruefeLokal([{ pfad: '.schleuse.json', bytes: r.text }], { basisText: r.text });
    assert.ok(!gleich.befunde.some((b) => b.regel === 'konfig/aenderung'));
    await assert.rejects(konfigAusMergeBase('--evil', { cwd: dir }), /Ungültige Referenz/);
    await assert.rejects(konfigAusMergeBase('gibtsnicht', { cwd: dir }), /Kein Merge-Base/);
    // CLI: config zeige --base
    const cli = await exec('node', [BIN, 'config', 'zeige', '--base', 'main'], { cwd: dir });
    assert.equal(JSON.parse(cli.stdout).regeln['anhang/riesenzeile'], 'fehler');
    const pruefe = await exec('node', [BIN, 'config', 'pruefe'], { cwd: dir });
    assert.match(pruefe.stdout, /gültig/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI: config pruefe mit kaputter oder fehlender Datei', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-cli-'));
  try {
    await writeFile(path.join(dir, 'k.json'), '{"version":1,"regeln":{"anhang/fuelung":"aus"}}');
    await assert.rejects(exec('node', [BIN, 'config', 'pruefe', 'k.json'], { cwd: dir }), (e) => e.code === 1 && /anhang\/fuellung/.test(e.stderr));
    await assert.rejects(exec('node', [BIN, 'config', 'pruefe', 'fehlt.json'], { cwd: dir }), (e) => e.code === 2);
    const ohne = await exec('node', [BIN, 'config', 'zeige'], { cwd: dir });
    assert.match(ohne.stdout, /standard/);
    await mkdir(path.join(dir, 'x'));
    const f = path.join(dir, 'x', 'a.js');
    await writeFile(f, 'const a = 1;\n');
    const sauber = await exec('node', [BIN, 'files', 'x/a.js'], { cwd: dir });
    assert.match(sauber.stdout, /Keine Auffälligkeit/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
