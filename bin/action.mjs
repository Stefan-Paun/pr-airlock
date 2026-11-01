#!/usr/bin/env node
// Einstieg für die GitHub Action. Liest das Event, prüft den PR über die API, schreibt Summary/Outputs, optional einen Sticky-Kommentar.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client } from '../lib/github.mjs';
import { pruefePr } from '../lib/pruefung.mjs';
import { toMarkdown } from '../lib/bericht/markdown.mjs';
import { toSarif } from '../lib/bericht/sarif.mjs';
import { toConsole } from '../lib/bericht/konsole.mjs';
import { STUFEN, hoechsteStufe } from '../lib/befund.mjs';

export async function lauf({ env = process.env, fetchImpl = fetch, log = (s) => console.log(s) } = {}) {
  // Der Runner setzt INPUT_<NAME> in Großbuchstaben und lässt Bindestriche stehen (INPUT_FAIL-ON); @actions/core ersetzt nur Leerzeichen.
  const eingabe = (name, std = '') => String(env[`INPUT_${name.toUpperCase()}`] ?? env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? std).trim();
  // Fremdtext darf im Job-Log keine Workflow-Commands bilden: ein `::` am Zeilenanfang wird entschärft.
  const sicher = (s) => String(s).replace(/^::/gm, '\u200b::').replace(/\r/g, '');
  const logSicher = (s) => log(sicher(s));
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
  const gh = client({ token, fetchImpl, api, log: (s) => logSicher(`  · ${s}`) });

  const ergebnis = await pruefePr(gh, { owner, repo, nummer: pr.number }, { log: (s) => logSicher(`  · ${s}`) });
  const stufe = ergebnis.befunde.length ? hoechsteStufe(ergebnis.befunde) : 'none';
  logSicher(toConsole(ergebnis, { farben: false }));

  // GitHub lehnt Kommentare über 65 536 Zeichen ab.
  const markdown = kappe(toMarkdown(ergebnis), 60_000);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `level=${stufe}\nfindings=${ergebnis.befunde.length}\n`);
  const sarifPfad = eingabe('sarif');
  if (sarifPfad) await writeFile(sarifPfad, JSON.stringify(toSarif(ergebnis), null, 1));

  if (eingabe('comment', 'false') === 'true') {
    try {
      const vorhandene = await gh.kommentare(owner, repo, pr.number);
      // Nur der eigene Bot-Kommentar zählt – ein Mensch kann den Marker nachahmen, aber nicht als Bot posten.
      const meins = vorhandene.find((k) => typeof k.body === 'string' && k.body.startsWith('<!-- schleuse -->') && (k.user?.type === 'Bot' || /\[bot\]$/.test(k.user?.login || '')));
      if (ergebnis.befunde.length) {
        if (meins) await gh.kommentarAendern(owner, repo, meins.id, markdown);
        else await gh.kommentarSetzen(owner, repo, pr.number, markdown);
      } else if (meins) {
        await gh.kommentarAendern(owner, repo, meins.id, markdown); // frühere Befunde sind weg → Kommentar auf „sauber“ setzen
      }
    } catch (e) {
      log(`::warning::Schleuse: Kommentar konnte nicht gesetzt werden (${sicher(e.message)}). Ergebnis gilt trotzdem.`);
    }
  }

  const rang = (s) => STUFEN.indexOf(s);
  const durchgefallen = ergebnis.befunde.some((b) => rang(b.stufe) >= rang(failOn));
  if (durchgefallen) log(`::error::Schleuse: ${ergebnis.befunde.length} Befund(e), höchste Stufe ${stufe}. Details im Job-Summary.`);
  return { ergebnis, stufe, durchgefallen };
}

export function kappe(text, max) {
  return text.length <= max ? text : text.slice(0, max) + '\n\n_… gekürzt, vollständiger Bericht im Job-Summary._\n';
}

export function istHauptmodul(argv1 = process.argv[1]) {
  try { return Boolean(argv1) && realpathSync(argv1) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (istHauptmodul()) {
  lauf().then(({ durchgefallen }) => { process.exitCode = durchgefallen ? 1 : 0; }).catch((e) => { console.log(`::error::schleuse: ${String(e.message).replace(/\r?\n/g, ' ')}`); process.exitCode = 2; });
}
