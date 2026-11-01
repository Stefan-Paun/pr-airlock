#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { githubToken, client, parsePrRef } from '../lib/github.mjs';
import { pruefePr, pruefeLokal } from '../lib/pruefung.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { STUFEN } from '../lib/befund.mjs';

const HILFE = `schleuse – gate for incoming pull requests (PolinRider-style repo poisoning)

Usage:
  schleuse pr <owner/repo#123 | PR URL>   check a pull request via the GitHub API (never checks out or runs it)
  schleuse files <path...>                check local files as if they were fully added

Options:
  --fail-on block|warn|info   exit 1 at this severity or higher (default: block)
  --json <path>               write findings as JSON
  --md <path>                 write a Markdown report
  --sarif <path>              write a SARIF 2.1.0 report (GitHub code scanning)
  -h, --help                  this help

Token: GITHUB_TOKEN, GH_TOKEN or \`gh auth token\`. Exit codes: 0 clean/below threshold, 1 findings at threshold, 2 usage/API error.
`;

export function parseArgs(argv) {
  const o = { befehl: null, ziel: [], failOn: 'block', json: null, md: null, sarif: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Option ${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') return { ...o, befehl: 'help' };
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--json') o.json = next();
    else if (a === '--md') o.md = next();
    else if (a === '--sarif') o.sarif = next();
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`);
    else if (!o.befehl) o.befehl = a;
    else o.ziel.push(a);
  }
  if (!o.befehl) return { ...o, befehl: 'help' };
  if (!['pr', 'files'].includes(o.befehl)) throw new Error(`Unknown command ${o.befehl}`);
  if (!STUFEN.includes(o.failOn)) throw new Error('--fail-on must be block, warn or info');
  if (!o.ziel.length) throw new Error(o.befehl === 'pr' ? 'Which PR? e.g. schleuse pr owner/repo#123' : 'Which files?');
  return o;
}

export function exitCode(ergebnis, failOn) {
  const rang = (s) => STUFEN.indexOf(s);
  return ergebnis.befunde.some((b) => rang(b.stufe) >= rang(failOn)) ? 1 : 0;
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
  let ergebnis;
  if (o.befehl === 'pr') {
    if (o.ziel.length > 1) throw new Error('One PR at a time');
    const ref = parsePrRef(o.ziel[0]);
    const token = await githubToken();
    if (!token) log('no GitHub token found – anonymous requests are rate-limited (60/h)');
    ergebnis = await pruefePr(client({ token, log }), ref, { log });
  } else {
    const dateien = [];
    for (const p of o.ziel) dateien.push({ pfad: path.relative(process.cwd(), p) || p, bytes: await readFile(p) });
    ergebnis = await pruefeLokal(dateien);
  }
  await schreibeBerichte(o, ergebnis);
  console.log(toConsole(ergebnis));
  return exitCode(ergebnis, o.failOn);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`schleuse: ${e.message}`); process.exit(2); });
}
