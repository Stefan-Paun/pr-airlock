// Sicherer git-Aufruf für den lokalen Modus. Das geprüfte Repo ist Fremdmaterial:
// nur Argument-Listen (nie eine Shell), bereinigte Umgebung, und alles abgeschaltet, was Befehle auslösen kann
// (Hooks, Pager, fsmonitor, externe Diff-Treiber, textconv, Filter, Ersetzungs-Objekte).
import { spawn } from 'node:child_process';
import os from 'node:os';

const AUS = os.devNull;

// Per -c überschrieben (höchste Priorität, schlägt .git/config des geprüften Repos).
export const GIT_SCHALTER = [
  '--no-pager',
  '-c', 'core.fsmonitor=false',
  '-c', `core.hooksPath=${AUS}`,
  '-c', 'core.pager=cat',
  '-c', `core.attributesFile=${AUS}`,
  '-c', 'core.untrackedCache=false',
  '-c', 'core.quotePath=false',
  '-c', 'diff.renames=false',
  '-c', 'protocol.allow=never',
];

export function gitUmgebung(basis = process.env) {
  return {
    PATH: basis.PATH || '/usr/bin:/bin',
    HOME: '/nonexistent',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: AUS,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_PAGER: 'cat',
  };
}

export class GitFehler extends Error {}

// Nur lesende Befehle auf Objekten (Commits, Bäume, Blobs). Befehle, die das Arbeitsverzeichnis anfassen (status, checkout, add …),
// würden clean/smudge-Filter und fsmonitor der geprüften Konfiguration berühren – die gibt es hier nicht.
export const ERLAUBT = new Set(['diff', 'ls-tree', 'cat-file', 'rev-parse', 'merge-base']);

/**
 * Führt `git <args>` in `repo` aus. Liest höchstens `max` Bytes Ausgabe; danach wird der Prozess beendet
 * und `abgeschnitten` ist true. Wirft GitFehler bei Exit-Code ≠ 0 (außer der Abbruch kam von uns).
 */
export function git(repo, args, { max = 64 * 1024 * 1024, timeoutMs = 60000, env = gitUmgebung() } = {}) {
  if (!ERLAUBT.has(args[0])) return Promise.reject(new GitFehler(`git ${args[0]}: nicht erlaubt im Prüfer`));
  return new Promise((resolve, reject) => {
    const kind = spawn('git', [...GIT_SCHALTER, ...args], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const teile = []; let n = 0; let abgeschnitten = false; let fehler = '';
    const timer = setTimeout(() => { kind.kill('SIGKILL'); reject(new GitFehler('git: Zeitüberschreitung')); }, timeoutMs);
    kind.stdout.on('data', (d) => {
      if (abgeschnitten) return;
      const rest = max - n;
      if (d.length >= rest) { teile.push(d.subarray(0, rest)); n = max; abgeschnitten = true; kind.kill('SIGKILL'); return; }
      teile.push(d); n += d.length;
    });
    kind.stderr.on('data', (d) => { if (fehler.length < 400) fehler += d.toString('utf8'); });
    kind.on('error', (e) => { clearTimeout(timer); reject(new GitFehler(`git nicht startbar: ${e.message}`)); });
    kind.on('close', (code) => {
      clearTimeout(timer);
      if (abgeschnitten) return resolve({ bytes: Buffer.concat(teile), abgeschnitten: true });
      if (code !== 0) return reject(new GitFehler(`git ${args[0]} fehlgeschlagen: ${fehler.trim().split('\n')[0] || 'Exit ' + code}`));
      resolve({ bytes: Buffer.concat(teile), abgeschnitten: false });
    });
  });
}

const REV_OK = /^[^\x00-\x1f\x7f-]\S*$/; // kein führendes "-" (Option), keine Steuerzeichen, kein Leerraum

/** Löst eine Revision zu einer Commit-SHA auf. Nie eine Option, nie mehr als eine Zeile. */
export async function loeseRev(repo, rev) {
  if (!REV_OK.test(rev || '')) throw new GitFehler(`Ungültige Revision: ${JSON.stringify(String(rev).slice(0, 80))}`);
  let sha = '';
  try { sha = (await git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { max: 1024 })).bytes.toString('utf8').trim(); } catch { /* unten gemeldet */ }
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new GitFehler(`Revision nicht gefunden: ${JSON.stringify(rev.slice(0, 80))}`);
  return sha;
}

/** Erste Bytes eines Blobs (Rohdaten, ohne Filter/textconv). */
export async function blobBytes(repo, sha, maxBytes) {
  if (!/^[0-9a-f]{40,64}$/.test(sha || '')) return null;
  const { bytes } = await git(repo, ['cat-file', 'blob', sha], { max: maxBytes });
  return bytes;
}
