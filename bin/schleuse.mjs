#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { githubToken, client, parsePrRef } from '../lib/github.mjs';
import { pruefePr, pruefeLokal } from '../lib/pruefung.mjs';
import { pruefeDiff, pruefeScan, repoPfad } from '../lib/lokal.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { STUFEN } from '../lib/befund.mjs';
import { configPruefe, configZeige } from '../lib/konfig/befehl.mjs';
import { konfigAusMergeBase } from '../lib/konfig/git.mjs';
import { selbsttest } from '../lib/selbsttest/index.mjs';

const HILFE = `schleuse – gate for incoming pull requests (PolinRider-style repo poisoning)

Usage:
  schleuse pr <owner/repo#123 | PR URL>   check a pull request via the GitHub API (never checks out or runs it)
  schleuse files <path...>                check local files as if they were fully added
  schleuse config pruefe [file]           validate a .schleuse.json (default ./.schleuse.json)
  schleuse config zeige [file]            print the effective configuration (defaults + file + --fail-on)
  schleuse diff [range]                   check a local commit range via git, no network (a..b, a...b, or one revision;
                                          default: HEAD against the merge-base with main/master)
  schleuse scan [path]                    check every git-tracked file of HEAD in a checked-out repo, no network
  schleuse selbsttest                     run every rule against the bundled, defused corpus (korpus/) and print
                                          hit rate and false-alarm rate per rule, no network

Options:
  --fail-on block|warn|info   exit 1 at this severity or higher (default: failOn from .schleuse.json, else block)
  --repo <path>               repository for diff (default: current directory)
  --base <ref>                files/config zeige: read .schleuse.json from the merge-base with <ref>, never from the working tree;
                              diff/scan: main branch for the base (default: origin/HEAD, main, master)
  --json <path>               write findings as JSON
  --md <path>                 write a Markdown report
  --sarif <path>              write a SARIF 2.1.0 report (GitHub code scanning)
  -h, --help                  this help

Selbsttest options:
  --format text|md|json       output format (md = the page docs/KENNZAHLEN.md)
  --regel <id|family/*>       only these rules (repeatable or comma-separated)
  --datum YYYY-MM-DD          generation date written into the md page (default: today)
  --korpus <dir>              another corpus directory (default: korpus/ next to this tool)
  Exit codes: 0 passed, 1 an expected finding is missing, a good case raises warn or higher, or the corpus breaks
  a hygiene rule; 2 usage error or malformed corpus.

Order: --fail-on > .schleuse.json (base branch only; for pr via API at the target commit) > defaults.
Token: GITHUB_TOKEN, GH_TOKEN or \`gh auth token\`. Exit codes: 0 clean/below threshold, 1 findings at threshold, 2 usage/API error.
`;

export function parseArgs(argv) {
  const o = { befehl: null, ziel: [], failOn: null, base: null, json: null, md: null, sarif: null, repo: null, format: null, regel: [], datum: null, korpus: null };
  let ende = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Option ${a} needs a value`); return argv[++i]; };
    if (ende) { if (!o.befehl) o.befehl = a; else o.ziel.push(a); }
    else if (a === '--') ende = true;
    else if (a === '-h' || a === '--help') return { ...o, befehl: 'help' };
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--repo') o.repo = next();
    else if (a === '--base') o.base = next();
    else if (a === '--json') o.json = next();
    else if (a === '--md') o.md = next();
    else if (a === '--sarif') o.sarif = next();
    else if (a === '--format') o.format = next();
    else if (a === '--regel') o.regel.push(next());
    else if (a === '--datum') o.datum = next();
    else if (a === '--korpus') o.korpus = next();
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else if (!o.befehl) o.befehl = a;
    else o.ziel.push(a);
  }
  if (!o.befehl) return { ...o, befehl: 'help' };
  if (!['pr', 'files', 'diff', 'scan', 'config', 'selbsttest'].includes(o.befehl)) throw new Error(`Unknown command ${o.befehl}`);
  const nurSelbsttest = o.format !== null || o.regel.length || o.datum !== null || o.korpus !== null;
  if (o.befehl === 'selbsttest') {
    if (o.ziel.length) throw new Error('selbsttest takes no arguments');
    if (o.failOn !== null || o.base || o.json || o.md || o.sarif || o.repo) throw new Error('selbsttest: only --format, --regel, --datum and --korpus apply');
    if (o.format !== null && !['text', 'md', 'json'].includes(o.format)) throw new Error('--format must be text, md or json');
    if (o.datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(o.datum)) throw new Error('--datum must be YYYY-MM-DD');
    return o;
  }
  if (nurSelbsttest) throw new Error('--format, --regel, --datum and --korpus only apply to selbsttest');
  if (o.failOn !== null && !STUFEN.includes(o.failOn)) throw new Error('--fail-on must be block, warn or info');
  if (o.befehl === 'config') {
    if (!['pruefe', 'zeige'].includes(o.ziel[0])) throw new Error('Which config command? schleuse config pruefe|zeige [file]');
    if (o.ziel.length > 2) throw new Error('At most one file');
    return o;
  }
  if ((o.befehl === 'diff' || o.befehl === 'scan') && o.ziel.length > 1) throw new Error(`${o.befehl}: at most one argument`);
  if (o.befehl !== 'diff' && o.befehl !== 'scan' && !o.ziel.length) throw new Error(o.befehl === 'pr' ? 'Which PR? e.g. schleuse pr owner/repo#123' : 'Which files?');
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
  if (o.befehl === 'selbsttest') {
    const r = await selbsttest({ korpus: o.korpus ? path.resolve(o.korpus) : undefined, regeln: o.regel, format: o.format || 'text', datum: o.datum });
    process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    return r.code;
  }
  let ergebnis;
  const eingaben = { failOn: o.failOn };
  if (o.befehl === 'pr') {
    if (o.ziel.length > 1) throw new Error('One PR at a time');
    const ref = parsePrRef(o.ziel[0]);
    const token = await githubToken();
    if (!token) log('no GitHub token found – anonymous requests are rate-limited (60/h)');
    ergebnis = await pruefePr(client({ token, log }), ref, { log, eingaben });
  } else if (o.befehl === 'diff') {
    ergebnis = await pruefeDiff(repoPfad(o.repo), o.ziel[0], { log, basis: o.base, eingaben });
  } else if (o.befehl === 'scan') {
    ergebnis = await pruefeScan(repoPfad(o.ziel[0]), { log, basis: o.base, eingaben });
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
