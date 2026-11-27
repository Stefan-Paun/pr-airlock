import { test } from 'node:test';
import assert from 'node:assert/strict';
import { werte, alleRegeln, regelFilter } from '../lib/selbsttest/auswertung.mjs';

const fall = (kennung, art, erwartet = [], bekannt = []) => ({ kennung, art, erwartet, bekannt });
const b = (regel, stufe = 'block') => ({ regel, stufe, datei: 'x.js' });

test('alleRegeln: Familien aufgelöst, kein Platzhalter, keine Dubletten', () => {
  const ids = alleRegeln();
  assert.ok(ids.includes('anhang/fuellung'));
  assert.ok(ids.includes('marker/polinrider-v1'));
  assert.ok(ids.includes('marker/polinrider-bat'));
  assert.ok(!ids.some((id) => id.endsWith('/*')));
  assert.equal(new Set(ids).size, ids.length);
});

test('regelFilter: genaue Kennung, Familie, Komma-Liste; Unsinn wird abgelehnt', () => {
  const f = regelFilter(['anhang/fuellung', 'marker/*,projekt/gitignore-versteck']);
  assert.ok(f('anhang/fuellung'));
  assert.ok(!f('anhang/riesenzeile'));
  assert.ok(f('marker/polinrider-v2'));
  assert.ok(f('projekt/gitignore-versteck'));
  assert.ok(regelFilter([])('egal/was'));
  assert.throws(() => regelFilter(['anhang']), /ungültiges Muster/);
  assert.throws(() => regelFilter(['*']), /ungültiges Muster/);
});

test('werte: Treffer, Lücke, falsche Stufe, Fehlalarm, info zählt nicht, Zusatzbefund bricht nicht', () => {
  const faelle = [
    fall('b1', 'boese', [{ regel: 'anhang/fuellung', stufe: 'block' }]),
    fall('b2', 'boese', [{ regel: 'anhang/fuellung', stufe: 'block' }]),
    fall('b3', 'boese', [{ regel: 'anhang/fuellung', stufe: 'block' }, { regel: 'projekt/gitignore-versteck' }]),
    fall('g1', 'gut'), fall('g2', 'gut'), fall('g3', 'gut'),
  ];
  const befunde = new Map([
    ['b1', [b('anhang/fuellung'), b('tarnung/base64-block', 'warn')]],
    ['b2', [b('anhang/fuellung', 'warn')]],
    ['b3', [b('anhang/fuellung'), b('projekt/gitignore-versteck', 'warn')]],
    ['g1', [b('autostart/pipe-to-shell', 'info')]],
    ['g2', [b('autostart/npm-lifecycle', 'warn')]],
  ]);
  const w = werte(faelle, befunde);
  const z = Object.fromEntries(w.regeln.map((r) => [r.id, r]));
  assert.equal(z['anhang/fuellung'].faelle, 3);
  assert.equal(z['anhang/fuellung'].treffer, 2);
  assert.equal(z['anhang/fuellung'].falscheStufe, 1);
  assert.deepEqual(z['anhang/fuellung'].trefferquote, { zaehler: 2, nenner: 3, anteil: 2 / 3 });
  assert.equal(z['projekt/gitignore-versteck'].treffer, 1, 'ohne Stufe reicht jede Stufe');
  assert.equal(z['autostart/npm-lifecycle'].fehlalarme, 1);
  assert.deepEqual(z['autostart/npm-lifecycle'].fehlalarmquote, { zaehler: 1, nenner: 3, anteil: 1 / 3 });
  assert.equal(z['autostart/pipe-to-shell'].fehlalarme, 0, 'info auf einem guten Fall ist kein Fehlalarm');
  assert.equal(z['marker/polinrider-v1'].faelle, 0);
  assert.equal(z['marker/polinrider-v1'].trefferquote.anteil, null, 'ohne Fälle keine Quote');
  assert.deepEqual(w.abweichungen.map((a) => [a.kennung, a.art, a.regel]), [['b2', 'stufe', 'anhang/fuellung'], ['g2', 'fehlalarm', 'autostart/npm-lifecycle']]);
  assert.deepEqual(w.zusatz.map((a) => [a.kennung, a.regel]), [['b1', 'tarnung/base64-block']]);
  assert.equal(w.gesamt.boese, 3); assert.equal(w.gesamt.gut, 3);
  assert.deepEqual(w.gesamt.trefferquote, { zaehler: 3, nenner: 4, anteil: 3 / 4 });
  assert.deepEqual(w.gesamt.boeseKomplett, { zaehler: 2, nenner: 3, anteil: 2 / 3 });
  assert.deepEqual(w.gesamt.guteMitAlarm, { zaehler: 1, nenner: 3, anteil: 1 / 3 });
  assert.equal(w.ok, false);
});

test('werte: bekannte Abweichungen zählen in den Quoten, brechen aber nicht; veraltete schon', () => {
  const faelle = [
    fall('b1', 'boese', [{ regel: 'anhang/fuellung', stufe: 'block' }], [{ art: 'luecke', regel: 'anhang/fuellung', grund: 'Schwelle bewusst gesetzt' }]),
    fall('g1', 'gut', [], [{ art: 'fehlalarm', regel: 'autostart/npm-lifecycle', grund: 'prepare husky ist harmlos' }]),
  ];
  const w = werte(faelle, new Map([['g1', [b('autostart/npm-lifecycle', 'warn')]]]));
  assert.equal(w.ok, true);
  assert.equal(w.gesamt.bekannt, 2);
  assert.equal(w.gesamt.offen, 0);
  assert.equal(w.regeln.find((r) => r.id === 'anhang/fuellung').uebersehen, 1);
  assert.ok(w.abweichungen.every((a) => a.bekannt && a.grund));

  // Die Regel wurde besser: die bekannte Lücke tritt nicht mehr auf → Korpus nachziehen.
  const w2 = werte(faelle, new Map([['b1', [b('anhang/fuellung')]], ['g1', [b('autostart/npm-lifecycle', 'warn')]]]));
  assert.equal(w2.ok, false);
  assert.deepEqual(w2.abweichungen.filter((a) => !a.bekannt).map((a) => [a.kennung, a.art]), [['b1', 'veraltet']]);
});

test('werte mit Filter: nur passende Regeln und nur böse Fälle, die eine davon erwarten', () => {
  const faelle = [
    fall('b1', 'boese', [{ regel: 'anhang/fuellung', stufe: 'block' }]),
    fall('b2', 'boese', [{ regel: 'tarnung/magic-bytes', stufe: 'block' }]),
    fall('g1', 'gut'),
  ];
  const befunde = new Map([['b1', [b('anhang/fuellung')]], ['g1', [b('tarnung/magic-bytes', 'warn')]]]);
  const w = werte(faelle, befunde, { filter: regelFilter(['anhang/*']) });
  assert.ok(w.regeln.every((r) => r.id.startsWith('anhang/')));
  assert.equal(w.gesamt.boese, 1);
  assert.equal(w.gesamt.gut, 1);
  assert.equal(w.ok, true, 'der Fehlalarm einer anderen Regel zählt hier nicht');
});

test('werte: eine Regel, die Schleuse nicht kennt, taucht trotzdem in der Tabelle auf', () => {
  const w = werte([fall('b1', 'boese', [{ regel: 'neu/regel' }])], new Map());
  const z = w.regeln.find((r) => r.id === 'neu/regel');
  assert.equal(z.faelle, 1);
  assert.equal(z.uebersehen, 1);
});

test('Ganzer Korpus: läuft ohne Netz in wenigen Sekunden und hat keine offene Abweichung', async () => {
  const { ladeKorpus } = await import('../lib/selbsttest/korpus.mjs');
  const { fuehreAus } = await import('../lib/selbsttest/auswertung.mjs');
  const alt = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Netz ist im Selbsttest verboten'); };
  try {
    const start = Date.now();
    const faelle = await ladeKorpus();
    const w = werte(faelle, await fuehreAus(faelle));
    assert.ok(Date.now() - start < 10000, 'dauert zu lange');
    assert.deepEqual(w.abweichungen.filter((a) => !a.bekannt), []);
    assert.equal(w.ok, true);
  } finally { globalThis.fetch = alt; }
});
