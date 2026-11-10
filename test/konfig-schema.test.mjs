import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passt, pruefeMuster } from '../lib/konfig/muster.mjs';
import { ladeKonfig, pruefeKonfig, fehlerText } from '../lib/konfig/schema.mjs';
import { GESCHUETZT, REGEL_IDS } from '../lib/konfig/regelliste.mjs';

test('Muster: * bleibt im Segment, ** geht über Segmente, ? ist ein Zeichen', () => {
  assert.ok(passt('test/fixtures/**', 'test/fixtures/a/b.js'));
  assert.ok(!passt('test/fixtures/**', 'test/fixtures'), '** am Ende braucht mindestens ein Segment');
  assert.ok(!passt('test/fixtures/**', 'src/test/fixtures/a.js'), 'verankert am Projektstamm');
  assert.ok(passt('**/*.snap', 'a/b/c.snap'));
  assert.ok(passt('**/*.snap', 'c.snap'), '** in der Mitte darf leer sein');
  assert.ok(passt('a/**/b.js', 'a/b.js') && passt('a/**/b.js', 'a/x/y/b.js'));
  assert.ok(passt('*.config.js', 'x.config.js') && !passt('*.config.js', 'src/x.config.js'));
  assert.ok(passt('a?c.js', 'abc.js') && !passt('a?c.js', 'a/c.js') && !passt('a?c.js', 'ac.js'));
  assert.ok(passt('docs/*', 'docs/a.md') && !passt('docs/*', 'docs/x/a.md'));
  assert.ok(!passt('a.js', 'A.js'), 'Groß-/Kleinschreibung zählt');
});

test('Muster: Platzhalter-Orgien bleiben schnell und korrekt', () => {
  const t = Date.now();
  assert.equal(passt('*a*a*a*a*a*a*a*a*b.js', 'a'.repeat(60) + '.js'), false);
  assert.equal(passt('**/**/**/**/x.js', 'a/'.repeat(40) + 'y.js'), false);
  assert.ok(Date.now() - t < 500);
});

test('Muster: „alles“ und Kaputtes wird abgelehnt', () => {
  for (const m of ['**', '*', '**/*', '?', '**/**', '*/**']) assert.match(pruefeMuster(m), /alles/, m);
  assert.match(pruefeMuster('/abs'), /relativ/);
  assert.match(pruefeMuster('a/../b'), /\.\./);
  assert.match(pruefeMuster('a//b'), /leeres Segment/);
  assert.match(pruefeMuster('a**b'), /ganzes Segment/);
  assert.match(pruefeMuster('a/[ab].js'), /nicht unterstütztes/);
  assert.match(pruefeMuster('a\\b'), /nicht unterstütztes/);
  assert.match(pruefeMuster(''), /nicht leer/);
  assert.match(pruefeMuster('a‮b'), /nicht unterstütztes/);
  assert.equal(pruefeMuster('**/*.js'), null);
  assert.equal(pruefeMuster('test/**'), null);
});

const gut = { version: 1, regeln: { 'anhang/riesenzeile': 'warnung', 'autostart/*': 'hinweis' },
  ausnahmen: [{ pfad: 'test/fixtures/**', regel: 'anhang/riesenzeile', grund: 'Synthetische Fixtures für Tests' }],
  schwellen: { riesenzeile: 3000, entropie: 4.8 }, failOn: 'warnung' };

test('Schema: gute Datei wird übernommen', () => {
  const r = pruefeKonfig(gut);
  assert.deepEqual(r.fehler, []);
  assert.equal(r.konfig.regeln['anhang/riesenzeile'], 'warnung');
  assert.equal(r.konfig.schwellen.riesenzeile, 3000);
  assert.equal(r.konfig.failOn, 'warnung');
  assert.equal(r.konfig.ausnahmen.length, 1);
  const leer = pruefeKonfig({ version: 1 });
  assert.deepEqual(leer.fehler, []);
});

test('Schema: kaputte Dateien nennen Feld, Wert und Vorschlag', () => {
  const fehler = (o) => pruefeKonfig(o).fehler.map(fehlerText);
  assert.match(fehler({})[0], /version: Pflichtfeld/);
  assert.match(fehler({ version: 2 })[0], /Schema-Version/);
  assert.match(fehler({ version: 1, regln: {} })[0], /regln: Unbekanntes Feld.*"regeln"/);
  assert.match(fehler({ version: 1, regeln: { 'anhang/fuelung': 'fehler' } })[0], /regeln\.anhang\/fuelung: Unbekannte Regel-Kennung.*"anhang\/fuellung"/);
  assert.match(fehler({ version: 1, regeln: { 'anhg/*': 'aus' } })[0], /Unbekannte Regel-Familie.*"anhang\/\*"/);
  assert.match(fehler({ version: 1, regeln: { 'anhang/riesenzeile': 'warnng' } })[0], /Stufe muss.*"warnung"/);
  assert.match(fehler({ version: 1, regeln: { 'anhang/riesenzeile': 3 } })[0], /Wert 3/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: '**', grund: 'weil es geht schon so' }] })[0], /ausnahmen\[0\]\.pfad.*alles/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: 'a/**' }] })[0], /ausnahmen\[0\]\.grund: Pflichtfeld/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: 'a/**', grund: 'kurz' }] })[0], /grund/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: 'a/**', grund: '         ' }] })[0], /grund/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: 'a/**', grund: 'lange Begründung', regl: 'x' }] })[0], /regl: Unbekanntes Feld.*"regel"/);
  assert.match(fehler({ version: 1, ausnahmen: [{ pfad: 'a/**', grund: 'lange Begründung', regel: 'nix/da' }] })[0], /ausnahmen\[0\]\.regel: Unbekannte/);
  assert.match(fehler({ version: 1, ausnahmen: {} })[0], /Muss eine Liste sein/);
  assert.match(fehler({ version: 1, schwellen: { riesenzeil: 5 } })[0], /Unbekannte Schwelle.*"riesenzeile"/);
  assert.match(fehler({ version: 1, schwellen: { riesenzeile: '5' } })[0], /ganze Zahl/);
  assert.match(fehler({ version: 1, schwellen: { riesenzeile: 5 } })[0], /zwischen 200 und/);
  assert.match(fehler({ version: 1, failOn: 'block' })[0], /failOn/);
  assert.equal(pruefeKonfig({ version: 1, regln: 1 }).konfig, null, 'bei Fehlern keine halbe Konfiguration');
  assert.equal(pruefeKonfig([]).fehler.length, 1);
});

test('Schema: ladeKonfig fängt kaputtes JSON und Übergröße', () => {
  assert.match(ladeKonfig('{ nope').fehler[0].meldung, /Kein gültiges JSON/);
  assert.match(ladeKonfig('x'.repeat(70_000)).fehler[0].meldung, /größer als 64 KB/);
  assert.deepEqual(ladeKonfig('﻿{"version":1}').fehler, []);
  assert.equal(ladeKonfig('{"version":1,"__proto__":{"x":1}}').fehler.length, 1, '__proto__ ist ein unbekanntes Feld');
});

test('Schema: geschützte Regeln lassen sich nicht abschalten oder absenken', () => {
  assert.ok(GESCHUETZT.has('anhang/fuellung') && GESCHUETZT.has('marker/polinrider-v1') && !GESCHUETZT.has('marker/blockchain-dead-drop') && !GESCHUETZT.has('anhang/riesenzeile'));
  for (const id of GESCHUETZT) {
    for (const stufe of ['aus', 'hinweis', 'warnung']) assert.match(pruefeKonfig({ version: 1, regeln: { [id]: stufe } }).fehler[0]?.meldung || '', /nicht abschaltbar/, `${id}=${stufe}`);
    assert.deepEqual(pruefeKonfig({ version: 1, regeln: { [id]: 'fehler' } }).fehler, []);
  }
  const fam = pruefeKonfig({ version: 1, regeln: { 'marker/*': 'aus' } });
  assert.deepEqual(fam.fehler, [], 'Familie ist erlaubt, schützt aber ihre Mitglieder');
  assert.match(fam.hinweise[0], /geschützte Regel/);
  assert.ok(REGEL_IDS.length > 30);
});

test('Beispiel-Datei in examples/ ist gültig', async () => {
  const { readFile } = await import('node:fs/promises');
  const r = ladeKonfig(await readFile(new URL('../examples/schleuse.json', import.meta.url), 'utf8'));
  assert.deepEqual(r.fehler, []);
  assert.equal(r.konfig.ausnahmen.length, 2);
});
