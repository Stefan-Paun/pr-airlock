import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { client } from '../lib/github.mjs';
import { pruefePr, pruefeLokal } from '../lib/pruefung.mjs';
import { lockerungen } from '../lib/konfig/aenderung.mjs';
import { pruefeKonfig } from '../lib/konfig/schema.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const BASIS = 'b'.repeat(40);
const KOPF_SHA = 'c'.repeat(40);
const k = (o) => pruefeKonfig({ version: 1, ...o }).konfig;

// Attrappe des API-Clients: alles kommt aus Fixtures, nichts aus dem Netz.
function attrappe({ basisText = null, dateien, kopfText, basisFehler }) {
  const aufrufe = [];
  return {
    aufrufe,
    pr: async () => ({ number: 1, title: 't', user: { login: 'u' }, head: { sha: 'h', repo: { full_name: 'x/r' } }, base: { sha: BASIS, repo: { full_name: 'o/r' } }, changed_files: dateien.length }),
    prDateien: async () => dateien,
    dateiAn: async (o, r, pfad, sha) => { aufrufe.push({ pfad, sha }); if (basisFehler) throw new Error(basisFehler); return basisText == null ? null : Buffer.from(basisText); },
    blobBytes: async (o, r, sha) => (sha === KOPF_SHA ? Buffer.from(kopfText ?? '') : null),
  };
}
const riesig = () => datei('test/fixtures/riesig.js', ['const x = "' + pseudoBlob(3000) + '"; eval(String.fromCharCode(1)); atob(1);']);
const ref = { owner: 'o', repo: 'r', nummer: 1 };

test('Basis-Stand: Konfiguration wird vom Ziel-Commit gelesen und wirkt', async () => {
  const basisText = JSON.stringify({ version: 1, regeln: { 'anhang/riesenzeile': 'hinweis' } });
  const gh = attrappe({ basisText, dateien: [riesig()] });
  const mit = await pruefePr(gh, ref);
  assert.deepEqual(gh.aufrufe, [{ pfad: '.schleuse.json', sha: BASIS }]);
  assert.equal(mit.konfig.quelle, 'datei');
  const ohne = await pruefePr(attrappe({ dateien: [riesig()] }), ref);
  assert.equal(ohne.konfig.quelle, 'standard');
  assert.ok(ohne.befunde.some((b) => b.regel === 'anhang/riesenzeile'));
  assert.equal(mit.befunde.find((b) => b.regel === 'anhang/riesenzeile')?.stufe, 'info');
});

test('PR ändert die Datei: Befund fehler mit Lockerungs-Diff, Lockerung unwirksam', async () => {
  const basisText = JSON.stringify({ version: 1, regeln: { 'anhang/riesenzeile': 'fehler' } });
  const kopfText = JSON.stringify({ version: 1, regeln: { 'anhang/riesenzeile': 'aus', 'tarnung/*': 'aus' }, ausnahmen: [{ pfad: 'test/fixtures/**', grund: 'Fixtures sind harmlos' }], schwellen: { riesenzeile: 900000 } });
  const dateien = [riesig(), { filename: '.schleuse.json', status: 'modified', additions: 5, deletions: 1, sha: KOPF_SHA, patch: '@@ -1 +1 @@\n+x' }];
  const r = await pruefePr(attrappe({ basisText, kopfText, dateien }), ref);
  const kb = r.befunde.find((b) => b.regel === 'konfig/aenderung');
  assert.equal(kb.stufe, 'block');
  assert.match(kb.warum, /wirkt für diesen Lauf nicht/);
  assert.ok(kb.details.some((d) => /Regel anhang\/riesenzeile: fehler → aus/.test(d)));
  assert.ok(kb.details.some((d) => /Neue Ausnahme: test\/fixtures\/\*\*/.test(d)));
  assert.ok(kb.details.some((d) => /Schwelle riesenzeile: 1500 → 900000/.test(d)));
  assert.ok(kb.details.some((d) => /tarnung\/base64-block: warnung → aus/.test(d)));
  // Die Lockerung greift nicht: der Befund bleibt auf der Stufe der Basis-Konfiguration.
  assert.equal(r.befunde.find((b) => b.regel === 'anhang/riesenzeile')?.stufe, 'block');
  assert.deepEqual(r.unterdrueckt, []);
  assert.equal(r.meta.stufe, 'block');
});

test('PR legt die Datei neu an: Befund, Wirkung nur der Standard', async () => {
  const kopfText = JSON.stringify({ version: 1, regeln: { 'anhang/riesenzeile': 'aus' } });
  const dateien = [riesig(), { filename: '.schleuse.json', status: 'added', additions: 3, deletions: 0, sha: KOPF_SHA, patch: '@@ -0,0 +1 @@\n+x' }];
  const r = await pruefePr(attrappe({ kopfText, dateien }), ref);
  const kb = r.befunde.find((b) => b.regel === 'konfig/aenderung');
  assert.match(kb.warum, /legt eine Konfigurationsdatei an/);
  assert.ok(kb.details[0].includes('anhang/riesenzeile'));
  assert.ok(r.befunde.some((b) => b.regel === 'anhang/riesenzeile'), 'Regel bleibt scharf');
});

test('PR löscht oder benennt die Datei um / ungültige Fassung / nicht lesbar', async () => {
  const basisText = JSON.stringify({ version: 1, regeln: { 'autostart/idea': 'fehler' }, schwellen: { riesenzeile: 1000 } });
  const lauf = (d, kopfText) => pruefePr(attrappe({ basisText, kopfText, dateien: [d] }), ref);
  const weg = await lauf({ filename: '.schleuse.json', status: 'removed', additions: 0, deletions: 4, sha: KOPF_SHA }, '');
  assert.match(weg.befunde[0].warum, /löscht/);
  assert.ok(weg.befunde[0].details.some((d) => /autostart\/idea: fehler → warnung/.test(d)));
  assert.ok(weg.befunde[0].details.some((d) => /Schwelle riesenzeile: 1000 → 1500/.test(d)));
  const um = await lauf({ filename: 'x.json', previous_filename: '.schleuse.json', status: 'renamed', additions: 0, deletions: 0, sha: KOPF_SHA }, '');
  assert.ok(um.befunde.some((b) => b.regel === 'konfig/aenderung'));
  const kaputt = await lauf({ filename: '.schleuse.json', status: 'modified', additions: 1, deletions: 1, sha: KOPF_SHA, patch: '@@ -1 +1 @@\n+x' }, '{"version":1,"regln":{}}');
  assert.match(kaputt.befunde.find((b) => b.regel === 'konfig/aenderung').warum, /ungültig/);
  const leer = await lauf({ filename: '.schleuse.json', status: 'modified', additions: 1, deletions: 1, sha: 'd'.repeat(40), patch: '@@ -1 +1 @@\n+x' }, '');
  assert.match(leer.befunde.find((b) => b.regel === 'konfig/aenderung').warum, /nicht gelesen/);
});

test('Kaputte oder nicht lesbare Basis-Konfiguration: Standard gilt, Befund konfig/ungueltig', async () => {
  const dat = [riesig()];
  const r1 = await pruefePr(attrappe({ basisText: '{"version":1,"regeln":{"anhang/riesenzeil":"aus"}}', dateien: dat }), ref);
  const u = r1.befunde.find((b) => b.regel === 'konfig/ungueltig');
  assert.equal(u.stufe, 'block');
  assert.match(u.details[0], /anhang\/riesenzeile/);
  assert.ok(r1.befunde.some((b) => b.regel === 'anhang/riesenzeile'), 'nichts abgeschaltet');
  const r2 = await pruefePr(attrappe({ basisFehler: 'GitHub 500', dateien: dat }), ref);
  assert.match(r2.befunde.find((b) => b.regel === 'konfig/ungueltig').warum, /nicht lesbar/);
});

test('Ausnahme aus der Basis-Konfiguration wirkt und wird im Ergebnis genannt', async () => {
  const basisText = JSON.stringify({ version: 1, ausnahmen: [{ pfad: 'test/fixtures/**', regel: 'anhang/riesenzeile', grund: 'Synthetische Fixtures' }] });
  const r = await pruefePr(attrappe({ basisText, dateien: [riesig()] }), ref);
  assert.ok(!r.befunde.some((b) => b.regel === 'anhang/riesenzeile'));
  assert.equal(r.unterdrueckt.length, 1);
  assert.equal(r.unterdrueckt[0].grund, 'Synthetische Fixtures');
});

test('Ohne Datei exakt wie vorher: alte Fixtures, gleiche Befunde mit und ohne Basis-Abfrage', async () => {
  const legit = await readFile(new URL('./fixtures/legit-next.config.mjs.txt', import.meta.url));
  const boese = datei('postcss.config.mjs', ['export default config;' + fuellung(507) + pseudoBlob(5200) + 'eval(']);
  const lokal = await pruefeLokal([{ pfad: 'next.config.mjs', bytes: legit }]);
  assert.deepEqual(lokal.befunde, []);
  assert.deepEqual(lokal.unterdrueckt, []);
  assert.equal(lokal.konfig.failOn, 'block');
  const a = await pruefePr(attrappe({ dateien: [boese] }), ref);
  const ohneBase = { ...attrappe({ dateien: [boese] }), pr: async () => ({ number: 1, head: { sha: 'h', repo: { full_name: 'x/r' } }, base: { repo: { full_name: 'o/r' } } }) };
  const b = await pruefePr(ohneBase, ref);
  assert.deepEqual(a.befunde, b.befunde);
  assert.equal(a.befunde.length, 1);
});

test('Lockerungen: nur echte Lockerungen, Verschärfung nicht', () => {
  assert.deepEqual(lockerungen(null, k({ regeln: { 'anhang/riesenzeile': 'fehler' }, schwellen: { riesenzeile: 1000 }, failOn: 'hinweis' })), []);
  assert.equal(lockerungen(k({ failOn: 'hinweis' }), k({ failOn: 'fehler' })).length, 1);
  assert.equal(lockerungen(k({ ausnahmen: [{ pfad: 'a/**', grund: 'bekannter Grund' }] }), k({ ausnahmen: [{ pfad: 'a/**', grund: 'bekannter Grund' }] })).length, 0);
});

test('client.dateiAn: feste SHA, 404 → null, Pfad kodiert, andere Fehler bleiben Fehler', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('/contents/gibtsnicht')) return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' };
    if (url.includes('/contents/kaputt')) return { ok: false, status: 500, headers: new Headers(), text: async () => 'x' };
    const b = Buffer.from('{"version":1}');
    return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length), text: async () => '' };
  };
  const gh = client({ token: 't', fetchImpl });
  assert.equal((await gh.dateiAn('o', 'r', '.schleuse.json', BASIS)).toString(), '{"version":1}');
  assert.ok(urls[0].endsWith(`/contents/.schleuse.json?ref=${BASIS}`));
  assert.equal(await gh.dateiAn('o', 'r', 'gibtsnicht', BASIS), null);
  await assert.rejects(gh.dateiAn('o', 'r', 'kaputt', BASIS), /GitHub 500/);
  await assert.rejects(gh.dateiAn('o', 'r', 'x', 'main'), /SHA/);
});
