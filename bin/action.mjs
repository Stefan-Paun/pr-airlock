#!/usr/bin/env node
// Einstieg für die GitHub Action. Liest das Event, prüft den PR über die API, schreibt Summary/Outputs, optional einen Sticky-Kommentar.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { client } from '../lib/github.mjs';
import { pruefePr } from '../lib/pruefung.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { STUFEN, hoechsteStufe } from '../lib/befund.mjs';

export async function lauf({ env = process.env, fetchImpl = fetch, log = (s) => console.log(s) } = {}) {
  // Action-Inputs kommen als INPUT_<NAME> (Bindestriche werden zu Unterstrichen).
  const eingabe = (name, std = '') => String(env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? std).trim();
  const eventPfad = env.GITHUB_EVENT_PATH;
  if (!eventPfad) throw new Error('GITHUB_EVENT_PATH fehlt – läuft das außerhalb von GitHub Actions?');
  const event = JSON.parse(await readFile(eventPfad, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw new Error(`Kein pull_request im Event (${env.GITHUB_EVENT_NAME || '?'}). Schleuse braucht pull_request_target oder pull_request.`);
  const [owner, repo] = String(env.GITHUB_REPOSITORY || event.repository?.full_name || '').split('/');
  if (!owner || !repo) throw new Error('Repository unbekannt (GITHUB_REPOSITORY)');
  const token = eingabe('token') || env.GITHUB_TOKEN || '';
  const failOn = eingabe('fail-on', 'block');
  if (!STUFEN.includes(failOn)) throw new Error('fail-on muss block, warn oder info sein');
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const gh = client({ token, fetchImpl, api, log: (s) => log(`  · ${s}`) });

  const ergebnis = await pruefePr(gh, { owner, repo, nummer: pr.number }, { log: (s) => log(`  · ${s}`) });
  const stufe = ergebnis.befunde.length ? hoechsteStufe(ergebnis.befunde) : 'none';
  log(toConsole(ergebnis, { farben: false }));

  const markdown = toMarkdown(ergebnis);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `level=${stufe}\nfindings=${ergebnis.befunde.length}\n`);
  const sarifPfad = eingabe('sarif');
  if (sarifPfad) await writeFile(sarifPfad, JSON.stringify(toSarif(ergebnis), null, 1));

  if (eingabe('comment', 'false') === 'true' && ergebnis.befunde.length) {
    const vorhandene = await gh.kommentare(owner, repo, pr.number);
    const meins = vorhandene.find((k) => typeof k.body === 'string' && k.body.startsWith('<!-- schleuse -->'));
    if (meins) await gh.kommentarAendern(owner, repo, meins.id, markdown);
    else await gh.kommentarSetzen(owner, repo, pr.number, markdown);
  }

  const rang = (s) => STUFEN.indexOf(s);
  const durchgefallen = ergebnis.befunde.some((b) => rang(b.stufe) >= rang(failOn));
  if (durchgefallen) log(`::error::Schleuse: ${ergebnis.befunde.length} Befund(e), höchste Stufe ${stufe}. Details im Job-Summary.`);
  return { ergebnis, stufe, durchgefallen };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  lauf().then(({ durchgefallen }) => process.exit(durchgefallen ? 1 : 0)).catch((e) => { console.log(`::error::schleuse: ${e.message}`); process.exit(2); });
}
