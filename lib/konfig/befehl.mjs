// `schleuse config pruefe|zeige`: reine Funktionen, die Text in Ausgabe und Exit-Code verwandeln.
import { ladeKonfig, fehlerText } from './schema.mjs';
import { wirksameKonfig } from './anwenden.mjs';
import { GESCHUETZT, stufeNachKonfig } from './regelliste.mjs';

export function configPruefe(text, name = '.schleuse.json') {
  const r = ladeKonfig(text);
  if (!r.konfig) return { code: 1, stdout: '', stderr: [`${name}: ${r.fehler.length} Fehler`, ...r.fehler.map((f) => `  - ${fehlerText(f)}`)].join('\n') + '\n' };
  const z = [`${name}: gültig (${Object.keys(r.konfig.regeln).length} Regeln, ${r.konfig.ausnahmen.length} Ausnahmen, ${Object.keys(r.konfig.schwellen).length} Schwellen)`, ...r.hinweise.map((h) => `  ! ${h}`)];
  return { code: 0, stdout: z.join('\n') + '\n', stderr: '' };
}

/** Wirksame Konfiguration als JSON. `failOn` (block|warn|info) ist die Eingabe mit Vorrang. */
export function configZeige(text, { failOn = null, quelle = 'Datei' } = {}) {
  let konfig = null;
  if (text != null) {
    const r = ladeKonfig(text);
    if (!r.konfig) return { code: 1, stdout: '', stderr: [`Konfiguration ungültig, es würde der Standard gelten (und ein Befund konfig/ungueltig):`, ...r.fehler.map((f) => `  - ${fehlerText(f)}`)].join('\n') + '\n' };
    konfig = r.konfig;
  }
  const w = wirksameKonfig(konfig, { failOn });
  const ausgabe = {
    quelle: konfig ? quelle : 'standard (keine Datei)',
    failOn: { wert: stufeNachKonfig(w.failOn), von: w.failOnQuelle },
    regeln: { ...w.regeln },
    ausnahmen: w.ausnahmen,
    schwellen: w.schwellen,
    nichtAbschaltbar: [...GESCHUETZT].sort(),
  };
  return { code: 0, stdout: JSON.stringify(ausgabe, null, 2) + '\n', stderr: '' };
}
