import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, parsePrRef } from '../lib/github.mjs';
import { pruefePr, pruefeLokal } from '../lib/pruefung.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const antwort = (daten, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), text: async () => JSON.stringify(daten) });

test('parsePrRef versteht owner/repo#n und PR-URLs', () => {
  assert.deepEqual(parsePrRef('shadcn-ui/ui#7716'), { owner: 'shadcn-ui', repo: 'ui', nummer: 7716 });
  assert.deepEqual(parsePrRef('https://github.com/nodejs/undici/pull/6054/'), { owner: 'nodejs', repo: 'undici', nummer: 6054 });
  assert.throws(() => parsePrRef('nur-text'), /nicht verstanden/);
});

test('client: Token nur im Header, Pagination, Blob-Dekodierung, Fehlertext ohne Query, Retry mit kurzen Wartezeiten', async () => {
  const aufrufe = [];
  let gesperrt = true;
  const fetchImpl = async (url, init) => {
    aufrufe.push({ url, auth: init.headers.Authorization, method: init.method });
    if (url.includes('/files?')) {
      const seite = Number(/[?&]page=(\d+)/.exec(url)[1]);
      return antwort(seite === 1 ? Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` })) : [{ filename: 'letzte' }]);
    }
    if (url.includes('/git/blobs/')) {
      assert.equal(init.headers.Accept, 'application/vnd.github.raw+json');
      const bytes = Buffer.concat([Buffer.from('774f4632abcd', 'hex'), Buffer.alloc(10_000, 1)]);
      return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), text: async () => '' };
    }
    if (url.includes('/pulls/9')) { if (gesperrt) { gesperrt = false; return antwort({ message: 'API rate limit exceeded' }, 403, { 'retry-after': '0' }); } return antwort({ number: 9 }); }
    if (url.includes('/pulls/403')) return antwort({ message: 'Resource not accessible' }, 403);
    if (url.includes('/pulls/404')) return antwort({ message: 'Not Found' }, 404);
    return antwort({});
  };
  const gh = client({ token: 'GEHEIM', fetchImpl, warteSek: [0.01, 0.01, 0.01] });
  const dateien = await gh.prDateien('a', 'b', 1);
  assert.equal(dateien.length, 101);
  assert.ok(aufrufe.every((a) => a.auth === 'Bearer GEHEIM' && !a.url.includes('GEHEIM')));
  const bytes = await gh.blobBytes('a', 'b', 'a'.repeat(40), 6);
  assert.equal(bytes.toString('hex'), '774f4632abcd', 'auf maxBytes gekappt');
  assert.equal(await gh.blobBytes('a', 'b', 'nicht-hex'), null);
  const pr = await gh.pr('a', 'b', 9);
  assert.equal(pr.number, 9);
  await assert.rejects(gh.pr('a', 'b', 404), (e) => /GitHub 404 für \/repos\/a\/b\/pulls\/404/.test(e.message) && !e.message.includes('GEHEIM'));
  const vorher = aufrufe.length;
  await assert.rejects(gh.pr('a', 'b', 403), /GitHub 403/);
  assert.equal(aufrufe.length - vorher, 1, 'echtes 403 ohne Rate-Limit-Anzeichen wird nicht wiederholt');
});

test('pruefePr: erkennt Fork, lädt Blobs nur für Binärdateien, liefert Meta', async () => {
  const boese = datei('postcss.config.mjs', ['export default config;' + fuellung(507) + "global['!']='8-1';" + pseudoBlob(5200)]);
  const font = { filename: 'public/fonts/fa-solid-400.woff2', status: 'added', additions: 0, deletions: 0, sha: 'b'.repeat(40) };
  const blobs = [];
  const gh = {
    pr: async () => ({ title: 'feat: x', user: { login: 'someone' }, head: { sha: 'abc1234', repo: { full_name: 'someone/ui' } }, base: { repo: { full_name: 'org/ui' } } }),
    prDateien: async () => [boese, font, datei('README.md', ['hi'])],
    blobBytes: async (o, r, sha) => { blobs.push(sha); return Buffer.from("global['r']=require;eval(" + pseudoBlob(200)); },
  };
  const e = await pruefePr(gh, { owner: 'org', repo: 'ui', nummer: 5 });
  assert.equal(e.meta.ausFork, true);
  assert.equal(e.meta.stufe, 'block');
  assert.deepEqual(blobs, ['b'.repeat(40)]);
  const regeln = e.befunde.map((b) => b.regel).sort();
  assert.ok(regeln.includes('anhang/fuellung') && regeln.includes('tarnung/magic-bytes'), regeln.join(','));
});

test('pruefeLokal: Textdateien als Diff, Binärdateien nur Magic-Bytes', async () => {
  const e = await pruefeLokal([
    { pfad: 'tailwind.config.js', bytes: Buffer.from('module.exports = {};' + fuellung(600) + pseudoBlob(4000) + 'fromCharCode(') },
    { pfad: 'ok.woff2', bytes: Buffer.from('774f46320001000000015ff000130000', 'hex') },
    { pfad: 'bad.woff2', bytes: Buffer.from('var x = require("child_process");' + pseudoBlob(100)) },
  ]);
  const regeln = e.befunde.map((b) => `${b.datei}:${b.regel}`).sort();
  assert.deepEqual(regeln, ['bad.woff2:tarnung/magic-bytes', 'tailwind.config.js:anhang/fuellung']);
});
