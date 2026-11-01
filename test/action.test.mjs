import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lauf } from '../bin/action.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const antwort = (daten) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(daten) });

async function simuliere({ dateien, comment = 'false', failOn = 'block', vorhandeneKommentare = [] }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-action-'));
  const event = path.join(dir, 'event.json');
  await writeFile(event, JSON.stringify({ pull_request: { number: 7 }, repository: { full_name: 'org/repo' } }));
  const summary = path.join(dir, 'summary.md'); const output = path.join(dir, 'out.txt'); const sarif = path.join(dir, 'r.sarif');
  await writeFile(summary, ''); await writeFile(output, '');
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'POST' || init.method === 'PATCH') { posts.push({ url, method: init.method, body: JSON.parse(init.body).body }); return antwort({ id: 1 }); }
    if (url.endsWith('/pulls/7')) return antwort({ number: 7, title: 't', user: { login: 'u' }, head: { sha: 'abc', repo: { full_name: 'x/repo' } }, base: { repo: { full_name: 'org/repo' } } });
    if (url.includes('/pulls/7/files')) return antwort(dateien);
    if (url.includes('/issues/7/comments')) return antwort(vorhandeneKommentare);
    return antwort({});
  };
  const env = { GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'org/repo', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, GITHUB_TOKEN: 't', INPUT_COMMENT: comment, 'INPUT_FAIL-ON': failOn, INPUT_SARIF: sarif };
  const logs = [];
  try {
    const r = await lauf({ env, fetchImpl, log: (s) => logs.push(s) });
    return { ...r, summary: await readFile(summary, 'utf8'), output: await readFile(output, 'utf8'), sarif: JSON.parse(await readFile(sarif, 'utf8')), posts, logs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Action: Befund → durchgefallen, Summary, Outputs, SARIF, kein Kommentar ohne Opt-in', async () => {
  const boese = datei('postcss.config.mjs', ['export default config;' + fuellung(507) + pseudoBlob(5200) + 'eval(']);
  const r = await simuliere({ dateien: [boese] });
  assert.equal(r.durchgefallen, true);
  assert.equal(r.stufe, 'block');
  assert.match(r.summary, /<!-- schleuse -->/);
  assert.match(r.output, /level=block\nfindings=1/);
  assert.equal(r.sarif.runs[0].results.length, 1);
  assert.deepEqual(r.posts, []);
  assert.ok(r.logs.some((l) => l.startsWith('::error::')));
});

test('Action: comment=true postet einmal und aktualisiert danach den eigenen Kommentar', async () => {
  const boese = datei('eslint.config.mjs', ['export default [];' + fuellung(600) + pseudoBlob(3000) + 'fromCharCode(']);
  const neu = await simuliere({ dateien: [boese], comment: 'true' });
  assert.equal(neu.posts.length, 1);
  assert.equal(neu.posts[0].method, 'POST');
  const bot = { id: 42, body: '<!-- schleuse -->\nalt', user: { login: 'github-actions[bot]', type: 'Bot' } };
  const nachahmer = { id: 41, body: '<!-- schleuse -->\nich bin nicht der Bot', user: { login: 'someone', type: 'User' } };
  const update = await simuliere({ dateien: [boese], comment: 'true', vorhandeneKommentare: [nachahmer, bot, { id: 43, body: 'mensch', user: { login: 'x', type: 'User' } }] });
  assert.equal(update.posts.length, 1);
  assert.equal(update.posts[0].method, 'PATCH');
  assert.match(update.posts[0].url, /comments\/42$/, 'nur der eigene Bot-Kommentar wird aktualisiert, nicht der Nachahmer');
  const sauber = await simuliere({ dateien: [datei('src/a.js', ['ok'])], comment: 'true', vorhandeneKommentare: [bot] });
  assert.equal(sauber.posts.length, 1);
  assert.match(sauber.posts[0].body, /✅/, 'alter Befund-Kommentar wird auf sauber gesetzt');
  const nieKommentiert = await simuliere({ dateien: [datei('src/a.js', ['ok'])], comment: 'true' });
  assert.equal(nieKommentiert.posts.length, 0, 'sauber ohne alten Kommentar → kein neuer Kommentar');
});

test('Action: sauberer PR → nicht durchgefallen, level=none; warn nur mit fail-on warn', async () => {
  const sauber = await simuliere({ dateien: [datei('src/a.js', ['const a = 1;'])] });
  assert.equal(sauber.durchgefallen, false);
  assert.match(sauber.output, /level=none\nfindings=0/);
  const pkg = datei('package.json', ['  "postinstall": "node scripts/x.js",']);
  assert.equal((await simuliere({ dateien: [pkg] })).durchgefallen, false);
  assert.equal((await simuliere({ dateien: [pkg], failOn: 'warn' })).durchgefallen, true);
});

test('Action: ohne pull_request im Event klare Fehlermeldung', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schleuse-action-'));
  try {
    const event = path.join(dir, 'e.json');
    await writeFile(event, JSON.stringify({ push: {} }));
    await assert.rejects(lauf({ env: { GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'a/b', GITHUB_EVENT_NAME: 'push' } }), /Kein pull_request/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
