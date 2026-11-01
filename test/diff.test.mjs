import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch, endung, dateiname, saeubere, auszug } from '../lib/diff.mjs';
import { befund, hoechsteStufe, zaehle } from '../lib/befund.mjs';

test('parsePatch nummeriert hinzugefügte und entfernte Zeilen richtig', () => {
  const patch = ['@@ -1,3 +1,4 @@', ' a', '-b', '+B', '+C', ' c', '@@ -10,1 +11,2 @@', ' x', '+y', '\\ No newline at end of file'].join('\n');
  const { added, removed } = parsePatch(patch);
  assert.deepEqual(added, [{ zeile: 2, text: 'B' }, { zeile: 3, text: 'C' }, { zeile: 12, text: 'y' }]);
  assert.deepEqual(removed, [{ zeile: 2, text: 'b' }]);
  assert.deepEqual(parsePatch(''), { added: [], removed: [] });
  assert.deepEqual(parsePatch(undefined).added, []);
});

test('Pfad-Helfer und Säuberung', () => {
  assert.equal(endung('a/b/postcss.config.MJS'), 'mjs');
  assert.equal(endung('Makefile'), '');
  assert.equal(dateiname('x/y/z.txt'), 'z.txt');
  assert.equal(saeubere('a\x1b[31mb\x1b]0;t\x07c\x00'), 'abc');
  assert.equal(auszug('  viel   text ' + 'x'.repeat(300), 20).length, 20);
});

test('Befund prüft Stufe, höchste Stufe und Zählung', () => {
  const b = befund({ regel: 'r', stufe: 'warn', datei: 'f', text: 'bad\x1b[2Jtext', warum: 'w' });
  assert.equal(b.auszug, 'badtext');
  assert.throws(() => befund({ regel: 'r', stufe: 'fatal', datei: 'f', warum: 'w' }), /Unbekannte Stufe/);
  const liste = [b, befund({ regel: 'r', stufe: 'info', datei: 'f', warum: 'w' })];
  assert.equal(hoechsteStufe(liste), 'warn');
  assert.equal(hoechsteStufe([]), 'info');
  assert.deepEqual(zaehle(liste), { block: 0, warn: 1, info: 1 });
});
