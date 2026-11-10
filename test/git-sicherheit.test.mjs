// Der Prüfer darf aus dem geprüften Repo nichts ausführen lassen: Hooks, fsmonitor, Pager, externe Diff-Treiber,
// textconv und Filter stehen hier in .git/config bzw. .gitattributes – ihre Skripte schreiben nur eine Marker-Datei.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync, readdirSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruefeDiff, pruefeScan } from '../lib/lokal.mjs';
import { git, gitUmgebung, GIT_SCHALTER } from '../lib/git.mjs';
import { pseudoBlob, fuellung } from './hilfen.mjs';

const BASIS = { ...gitUmgebung(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const g = (cwd, ...a) => execFileSync('git', a, { cwd, env: BASIS, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const boese = 'export default {};' + fuellung(507) + pseudoBlob(3000) + 'fromCharCode(';

function vergiftetesRepo() {
  const wurzel = mkdtempSync(path.join(os.tmpdir(), 'schleuse-s-'));
  const repo = path.join(wurzel, 'repo');
  const marker = path.join(wurzel, 'marker');
  mkdirSync(marker);
  mkdirSync(repo);
  const skript = path.join(wurzel, 'harmlos.sh');
  writeFileSync(skript, `#!/bin/sh\necho "$0 $*" >> "${marker}/ausgefuehrt"\ncat\n`);
  chmodSync(skript, 0o755);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'start');
  g(repo, 'checkout', '-q', '-b', 'f');
  writeFileSync(path.join(repo, '.gitattributes'), '*.mjs diff=boese filter=boese\n*.txt diff=boese\n*.js diff=boese\n');
  writeFileSync(path.join(repo, 'postcss.config.mjs'), boese + '\n');
  writeFileSync(path.join(repo, 'a.txt'), '2\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'pr');
  // Konfiguration und Hooks, wie sie ein geklontes/fremdes .git enthalten könnte
  appendFileSync(path.join(repo, '.git', 'config'), [
    '[core]', `\tfsmonitor = ${skript}`, `\tpager = ${skript}`, `\tsshCommand = ${skript}`, `\thooksPath = ${path.join(wurzel, 'hooks')}`,
    '[diff]', `\texternal = ${skript}`,
    '[diff "boese"]', `\ttextconv = ${skript}`, `\tcachetextconv = false`,
    '[filter "boese"]', `\tclean = ${skript}`, `\tsmudge = ${skript}`, '\trequired = true',
    '[alias]', `\tlog = !${skript}`,
  ].join('\n') + '\n');
  mkdirSync(path.join(wurzel, 'hooks'));
  for (const h of ['post-checkout', 'post-merge', 'pre-commit', 'reference-transaction', 'post-index-change']) {
    writeFileSync(path.join(wurzel, 'hooks', h), `#!/bin/sh\necho ${h} >> "${marker}/ausgefuehrt"\n`);
    chmodSync(path.join(wurzel, 'hooks', h), 0o755);
    writeFileSync(path.join(repo, '.git', 'hooks', h), `#!/bin/sh\necho ${h} >> "${marker}/ausgefuehrt"\n`);
    chmodSync(path.join(repo, '.git', 'hooks', h), 0o755);
  }
  return { wurzel, repo, marker };
}
const ausgefuehrt = (marker) => readdirSync(marker).length > 0;

test('Gegenprobe: ohne Schutz würde die präparierte Konfiguration etwas ausführen', () => {
  const { wurzel, repo, marker } = vergiftetesRepo();
  try {
    // Normales git mit Stefans-artiger Standard-Umgebung, aber ohne unsere Schalter: Textconv bzw. externer Diff laufen.
    execFileSync('git', ['--no-pager', 'diff', 'main', 'f'], { cwd: repo, env: { ...BASIS }, stdio: 'ignore' });
    assert.ok(ausgefuehrt(marker), 'Testaufbau ist wirkungslos – sonst beweist der Haupttest nichts');
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('diff und scan lösen nichts aus, finden aber trotzdem den Befund', async () => {
  const { wurzel, repo, marker } = vergiftetesRepo();
  try {
    const r = await pruefeDiff(repo, 'main..f');
    assert.ok(r.befunde.some((b) => b.datei === 'postcss.config.mjs' && b.stufe === 'block'));
    const s = await pruefeScan(repo);
    assert.ok(s.befunde.some((b) => b.datei === 'postcss.config.mjs' && b.stufe === 'block'));
    assert.deepEqual(readdirSync(marker), [], 'es darf kein Skript gelaufen sein');
    assert.equal(existsSync(path.join(marker, 'ausgefuehrt')), false);
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('der git-Wrapper erlaubt nur lesende Objekt-Befehle (kein status/checkout/add: Filter und fsmonitor bleiben unberührt)', async () => {
  const { wurzel, repo, marker } = vergiftetesRepo();
  try {
    for (const befehl of ['status', 'checkout', 'add', 'commit', 'log', 'config', 'clone', 'fetch', 'submodule']) {
      await assert.rejects(git(repo, [befehl]), /nicht erlaubt/, befehl);
    }
    await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['diff', '--no-ext-diff', '--no-textconv', 'main', 'f', '--']);
    assert.deepEqual(readdirSync(marker), []);
    execFileSync('git', ['status', '--porcelain'], { cwd: repo, env: { ...BASIS }, stdio: 'ignore' });
    assert.ok(ausgefuehrt(marker), 'Gegenprobe: ohne Schutz läuft die präparierte Konfiguration bei status');
  } finally { rmSync(wurzel, { recursive: true, force: true }); }
});

test('Umgebung: nur Allowlist, GIT_*-Variablen des Aufrufers (GIT_DIR, GIT_EXTERNAL_DIFF, GIT_SSH_COMMAND …) kommen nicht durch', () => {
  const env = gitUmgebung({ PATH: '/bin', HOME: '/home/x', GIT_DIR: '/boese', GIT_EXTERNAL_DIFF: 'x', GIT_SSH_COMMAND: 'x', GIT_ASKPASS: 'x', EDITOR: 'x' });
  assert.deepEqual(Object.keys(env).filter((k) => /^(GIT_DIR|GIT_EXTERNAL_DIFF|GIT_SSH_COMMAND|GIT_ASKPASS|EDITOR)$/.test(k)), []);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, os.devNull);
  assert.equal(env.GIT_LITERAL_PATHSPECS, '1');
  assert.ok(GIT_SCHALTER.includes('--no-pager'));
  assert.ok(GIT_SCHALTER.includes('core.fsmonitor=false'));
});

test('Quelltext: keine Shell – weder exec noch shell: true', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['../lib/git.mjs', '../lib/lokal.mjs']) {
    const t = (await readFile(new URL(f, import.meta.url), 'utf8')).replace(/\/\/.*$/gm, '');
    assert.ok(!/(?<![.\w])exec(Sync|File|FileSync)?\b|shell:\s*true/.test(t), f);
    assert.match(t, /spawn\(|git\(/);
  }
});
