#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { githubToken, client, parsePrRef } from '../lib/github.mjs';
import { pruefePr, pruefeLokal } from '../lib/pruefung.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { STUFEN } from '../lib/befund.mjs';
import { configPruefe, configZeige } from '../lib/konfig/befehl.mjs';
import { konfigAusMergeBase } from '../lib/konfig/git.mjs';

const HILFE = `schleuse – gate for incoming pull requests (PolinRider-style repo poisoning)

Usage:
  schleuse pr <owner/repo#123 | PR URL>   check a pull request via the GitHub API (never checks out or runs it)
  schleuse files <path...>                check local files as if they were fully added
  schleuse config pruefe [file]           validate a .schleuse.json (default ./.schleuse.json)
  schleuse config zeige [file]            print the effective configuration (defaults + file + --fail-on)

Options:
  --fail-on block|warn|info   exit 1 at this severity or higher (default: failOn from .schleuse.json, else block)
  --base <ref>                files/config zeige: read .schleuse.json from the merge-base with <ref>, never from the working tree
  --json <path>               write findings as JSON
  --md <path>                 write a Markdown report
  --sarif <path>              write a SARIF 2.1.0 report (GitHub code scanning)
  -h, --help                  this help

Order: --fail-on > .schleuse.json (base branch only; for pr via API at the target commit) > defaults.
Token: GITHUB_TOKEN, GH_TOKEN or \`gh auth token\`. Exit codes: 0 clean/below threshold, 1 findings at threshold, 2 usage/API error.
`;

export function parseArgs(argv) {
  const o = { befehl: null, ziel: [], failOn: null, base: null, json: null, md: null, sarif: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Option ${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') return { ...o, befehl: 'help' };
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--base') o.base = next();
    else if (a === '--json') o.json = next();
    else if (a === '--md') o.md = next();
    else if (a === '--sarif') o.sarif = next();
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else if (!o.befehl) o.befehl = a;
    else o.ziel.push(a);
  }
  if (!o.befehl) return { ...o, befehl: 'help' };
  if (!['pr', 'files', 'config'].includes(o.befehl)) throw new Error(`Unknown command ${o.befehl}`);
  if (o.failOn !== null && !STUFEN.includes(o.failOn)) throw new Error('--fail-on must be block, warn or info');
  if (o.befehl === 'config') {
    if (!['pruefe', 'zeige'].includes(o.ziel[0])) throw new Error('Which config command? schleuse config pruefe|zeige [file]');
    if (o.ziel.length > 2) throw new Error('At most one file');
    return o;
  }
  if (!o.ziel.length) throw new Error(o.befehl === 'pr' ? 'Which PR? e.g. schleuse pr owner/repo#123' : 'Which files?');
  return o;
}

export function exitCode(ergebnis, failOn) {
  const rang = (s) => STUFEN.indexOf(s);
  return ergebnis.befunde.some((b) => rang(b.stufe) >= rang(failOn || ergebnis.konfig?.failOn || 'block')) ? 1 : 0;
}

async function schreibeBerichte(o, ergebnis) {
  if (o.json) await writeFile(o.json, JSON.stringify(ergebnis, null, 1));
  if (o.md) await writeFile(o.md, toMarkdown(ergebnis));
  if (o.sarif) await writeFile(o.sarif, JSON.stringify(toSarif(ergebnis), null, 1));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.befehl === 'help') { process.stdout.write(HILFE); return 0; }
  const log = (s) => process.stderr.write(`  · ${s}\n`);
  if (o.befehl === 'config') return configBefehl(o);
  let ergebnis;
  const eingaben = { failOn: o.failOn };
  if (o.befehl === 'pr') {
    if (o.ziel.length > 1) throw new Error('One PR at a time');
    const ref = parsePrRef(o.ziel[0]);
    const token = await githubToken();
    if (!token) log('no GitHub token found – anonymous requests are rate-limited (60/h)');
    ergebnis = await pruefePr(client({ token, log }), ref, { log, eingaben });
  } else {
    const dateien = [];
    for (const p of o.ziel) dateien.push({ pfad: path.relative(process.cwd(), p) || p, bytes: await readFile(p) });
    // Konfiguration nur mit --base, und dann vom Merge-Base, nie aus dem Arbeitsstand.
    const basisText = o.base ? (await konfigAusMergeBase(o.base)).text : undefined;
    ergebnis = await pruefeLokal(dateien, { basisText, eingaben });
  }
  await schreibeBerichte(o, ergebnis);
  console.log(toConsole(ergebnis));
  return exitCode(ergebnis, o.failOn);
}

async function configBefehl(o) {
  const [unter, datei] = o.ziel;
  let text = null;
  let quelle = 'Datei';
  if (unter === 'zeige' && o.base) {
    const r = await konfigAusMergeBase(o.base);
    text = r.text; quelle = `Merge-Base ${r.basis.slice(0, 7)}`;
  } else {
    const pfad = datei || '.schleuse.json';
    try { text = await readFile(pfad); } catch (e) {
      if (unter === 'zeige' && !datei && e.code === 'ENOENT') text = null;
      else throw new Error(`${pfad} nicht lesbar: ${e.code || e.message}`);
    }
    if (unter === 'zeige' && text) process.stderr.write('  · Hinweis: gezeigt wird die Datei im Arbeitsstand. Die Schleuse liest sie im Einsatz nur vom Basis-Zweig (--base <ref> zeigt das).\n');
  }
  const r = unter === 'pruefe' ? configPruefe(text, datei || '.schleuse.json') : configZeige(text, { failOn: o.failOn, quelle });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  return r.code;
}

export function istHauptmodul(argv1 = process.argv[1]) {
  try { return Boolean(argv1) && realpathSync(argv1) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (istHauptmodul()) {
  // exitCode statt exit(): sonst wird die Ausgabe in Pipes bei 64 KB abgeschnitten.
  main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(`schleuse: ${e.message}`); process.exitCode = 2; });
}
