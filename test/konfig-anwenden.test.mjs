import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeKonfig } from '../lib/konfig/schema.mjs';
import { wirksameKonfig, wendeKonfigAn } from '../lib/konfig/anwenden.mjs';
import { befund } from '../lib/befund.mjs';
import { pruefeDateien } from '../lib/regeln/index.mjs';
import { pseudoBlob, fuellung, datei } from './hilfen.mjs';

const b = (regel, stufe, d = 'src/a.js') => befund({ regel, stufe, datei: d, warum: 'w', quelle: 'q' });
const konf = (o) => { const r = pruefeKonfig({ version: 1, ...o }); assert.deepEqual(r.fehler, []); return wirksameKonfig(r.konfig); };

test('Abstufen: einzelne Regel, Familie, exakte Kennung geht vor Familie, hochstufen', () => {
  const liste = [b('autostart/idea', 'warn'), b('autostart/pipe-to-shell', 'warn'), b('anhang/riesenzeile', 'warn'), b('tarnung/base64-block', 'warn')];
  const r = wendeKonfigAn(liste, konf({ regeln: { 'autostart/*': 'hinweis', 'autostart/idea': 'fehler', 'anhang/riesenzeile': 'fehler' } }));
  const stufe = (id) => r.befunde.find((x) => x.regel === id)?.stufe;
  assert.equal(stufe('autostart/idea'), 'block', 'exakt vor Familie');
  assert.equal(stufe('autostart/pipe-to-shell'), 'info', 'Familie');
  assert.equal(stufe('anhang/riesenzeile'), 'block', 'hochgestuft');
  assert.equal(r.befunde.find((x) => x.regel === 'anhang/riesenzeile').urspruenglich, 'warn');
  assert.equal(stufe('tarnung/base64-block'), 'warn', 'unberührt');
  assert.deepEqual(r.unterdrueckt, []);
});

test('aus: Befund verschwindet, steht aber unter unterdrückt', () => {
  const r = wendeKonfigAn([b('tarnung/base64-block', 'warn'), b('autostart/idea', 'warn')], konf({ regeln: { 'tarnung/*': 'aus' } }));
  assert.deepEqual(r.befunde.map((x) => x.regel), ['autostart/idea']);
  assert.equal(r.unterdrueckt.length, 1);
  assert.equal(r.unterdrueckt[0].art, 'regel-aus');
});

test('Ausnahme: mit Grund wirkt, nur für Pfad und Regel; Grund steht im Ergebnis', () => {
  const k = konf({ ausnahmen: [{ pfad: 'test/fixtures/**', regel: 'anhang/riesenzeile', grund: 'Synthetische Test-Fixtures' }] });
  const r = wendeKonfigAn([b('anhang/riesenzeile', 'warn', 'test/fixtures/x.js'), b('anhang/riesenzeile', 'warn', 'src/x.js'), b('autostart/idea', 'warn', 'test/fixtures/y.js')], k);
  assert.deepEqual(r.befunde.map((x) => x.datei), ['src/x.js', 'test/fixtures/y.js']);
  assert.equal(r.unterdrueckt[0].grund, 'Synthetische Test-Fixtures');
  assert.equal(r.unterdrueckt[0].art, 'ausnahme');
});

test('Ausnahme ohne Grund ist ein Schema-Fehler und wirkt nie', () => {
  const r = pruefeKonfig({ version: 1, ausnahmen: [{ pfad: 'test/**', regel: 'anhang/riesenzeile' }] });
  assert.equal(r.konfig, null);
  assert.match(r.fehler[0].feld, /grund/);
});

test('Geschützte Regeln: Ausnahme ohne Regel oder mit Familie trifft sie nicht, nur der exakte Name', () => {
  const marker = b('marker/polinrider-v1', 'block', 'test/fixtures/m.js');
  const breit = konf({ ausnahmen: [{ pfad: 'test/fixtures/**', grund: 'alles in den Fixtures' }, { pfad: 'test/**', regel: 'marker/*', grund: 'Familie nennt nicht genau' }] });
  assert.equal(wendeKonfigAn([marker], breit).befunde.length, 1);
  const genau = konf({ ausnahmen: [{ pfad: 'test/fixtures/**', regel: 'marker/polinrider-v1', grund: 'Erkennungs-Test-Daten' }] });
  const r = wendeKonfigAn([marker, { ...marker, datei: 'src/m.js' }], genau);
  assert.equal(r.befunde.length, 1);
  assert.equal(r.befunde[0].datei, 'src/m.js');
  assert.equal(r.unterdrueckt.length, 1);
});

test('Familie senkt geschützte Mitglieder nicht', () => {
  const r = wendeKonfigAn([b('anhang/fuellung', 'block'), b('anhang/riesenzeile', 'warn')], konf({ regeln: { 'anhang/*': 'aus' } }));
  assert.deepEqual(r.befunde.map((x) => x.regel), ['anhang/fuellung']);
});

test('Pfade mit Bidi-/Steuerzeichen bekommen nie eine Ausnahme; Konfig-Befunde auch nicht', () => {
  const k = konf({ ausnahmen: [{ pfad: 'test/fixtures/**', grund: 'Fixtures dürfen alles' }] });
  const trick = b('autostart/idea', 'warn', 'test/‮fixtures/x.js');
  assert.equal(trick.unsauber, true);
  assert.equal(wendeKonfigAn([trick], k).befunde.length, 1);
  const kb = befund({ regel: 'konfig/aenderung', stufe: 'block', datei: 'test/fixtures/.schleuse.json', warum: 'w' });
  assert.equal(wendeKonfigAn([kb], k).befunde.length, 1);
});

test('Wirksam: Rangfolge Eingabe > Datei > Standard', () => {
  assert.equal(wirksameKonfig(null).failOn, 'block');
  const k = pruefeKonfig({ version: 1, failOn: 'warnung' }).konfig;
  assert.equal(wirksameKonfig(k).failOn, 'warn');
  assert.equal(wirksameKonfig(k, { failOn: 'info' }).failOn, 'info');
  assert.equal(wirksameKonfig(k, { failOn: 'info' }).failOnQuelle, 'eingabe');
  assert.equal(wirksameKonfig(null).schwellen.riesenzeile, 1500);
});

test('Schwellen: wirken in den Regeln; ohne Angabe bleibt alles wie heute', async () => {
  const zeile = 'export default config;' + fuellung(130) + pseudoBlob(260) + 'eval(';
  const d = [datei('postcss.config.mjs', [zeile])];
  const heute = await pruefeDateien(d);
  assert.equal(heute.befunde[0].regel, 'anhang/fuellung');
  const gleich = await pruefeDateien(d, { kontext: { schwellen: wirksameKonfig(null).schwellen } });
  assert.deepEqual(gleich.befunde, heute.befunde);
  const lockerer = await pruefeDateien(d, { kontext: { schwellen: { ...wirksameKonfig(null).schwellen, fuellung: 500 } } });
  assert.deepEqual(lockerer.befunde, []);
  const base = [datei('a.js', ['x = "' + 'QUJD'.repeat(600) + '"'])];
  assert.equal((await pruefeDateien(base)).befunde[0]?.regel, 'tarnung/base64-block');
  assert.deepEqual((await pruefeDateien(base, { kontext: { schwellen: { ...wirksameKonfig(null).schwellen, base64Min: 5000 } } })).befunde, []);
});
