// Strukturregeln: erkennen angehängte Payloads an ihrer Form, nicht an rotierbaren Markern.
// Vermessen an echten PolinRider-PRs (Nov 2026): 500–2000 Leerzeichen Abstand, eine Zeile mit
// 5 000–22 000 Zeichen, Entropie ≈ 5,5, meist Code-Token wie fromCharCode/split/join oder eval/atob.
import { befund } from '../befund.mjs';
import { istKonfig, istCode, istGeneriert, codeToken, entropie, fuellungInZeile, fuehrendeFuellung, WEISS_ALLE } from './hilfen.mjs';

export const SCHWELLEN = { fuellung: 120, fuehrend: 200, mindestCode: 200, riesenzeile: 1500, entropie: 4.3, tokenMin: 2 };
const QUELLE = 'OpenSourceMalware PolinRider-Dossier; eigene Messung an PR-Diffs 2026-11-01';

// Versions-Tag, den jede bekannte Variante setzt: global['!']='8-270-2', global.o='5-3-235-du', global.i='A10-*1_3191', global["_V"]="8-st12", global["!"]="10".
// Schlüssel höchstens 2 Zeichen, Wert sieht nach Versionsnummer aus – `global.TZ = 'UTC'` in einem Test-Setup fällt nicht darunter.
export const GLOBAL_TAG = /\bglobal\s*(?:\.\w{1,2}|\[\s*(?:'[^']{1,2}'|"[^"]{1,2}")\s*\])\s*=\s*(?:'([A-Za-z]?\d{1,4}(?:[-_*][\w*]{1,12}){0,4})'|"([A-Za-z]?\d{1,4}(?:[-_*][\w*]{1,12}){0,4})")/;
// Der ESM-Rückweg zu CommonJS, den die Payloads brauchen: global['r']=require / global.m=module
export const GLOBAL_SHIM = /\bglobal\s*(?:\.\w{1,2}|\[\s*['"][^'"]{1,2}['"]\s*\])\s*=\s*(?:require|module)\b\s*[;,)]/;

export function pruefeAnhang(datei, added) {
  const out = [];
  const pfad = datei.filename;
  if (!istCode(pfad)) return out;
  const konfig = istKonfig(pfad);
  const generiert = istGeneriert(pfad);
  const mindest = SCHWELLEN.fuellung + SCHWELLEN.mindestCode;
  for (const { zeile, text } of added) {
    if (text.length < mindest && !text.includes('global')) continue; // kann keine Regel treffen
    const token = codeToken(text);
    const f = fuellungInZeile(text);
    const kern = text.trim();

    // 1) Füllung mitten in der Zeile, dahinter Code – die Signatur der Kampagne, gilt auch in dist/ und .min.js
    if (f.laenge >= SCHWELLEN.fuellung && f.danach.length >= SCHWELLEN.mindestCode) {
      const stark = token.length >= 1 || entropie(f.danach) >= SCHWELLEN.entropie;
      if (stark) {
        out.push(befund({ regel: 'anhang/fuellung', stufe: token.length ? 'block' : 'warn', datei: pfad, zeile, text: f.danach,
          warum: `Code versteckt hinter ${f.laenge} Leerzeichen in einer Zeile${token.length ? ` (${token.slice(0, 3).join(', ')})` : ', ohne bekannte Token, aber hohe Entropie'}. So hängt PolinRider seinen Loader an Konfig-Dateien.`, quelle: QUELLE }));
        continue;
      }
    }
    // 2) Zeile beginnt mit sehr viel Weißraum, dahinter ein langer Code-Block
    const fuehrend = fuehrendeFuellung(text);
    if (fuehrend >= SCHWELLEN.fuehrend && kern.length >= SCHWELLEN.mindestCode && (token.length >= 1 || entropie(kern) >= SCHWELLEN.entropie)) {
      out.push(befund({ regel: 'anhang/fuellung', stufe: token.length ? 'block' : 'warn', datei: pfad, zeile, text: kern,
        warum: `Zeile beginnt mit ${fuehrend} Leerzeichen, dahinter ${kern.length} Zeichen Code${token.length ? ` (${token.slice(0, 3).join(', ')})` : ''}. Typische Off-Screen-Injektion.`, quelle: QUELLE }));
      continue;
    }
    // 3) Riesenzeile mit Ausführungs-Token – nicht in generierten/gepackten Dateien
    const dicht = kern.replace(WEISS_ALLE, ''); // Füllung soll die Entropie nicht drücken
    if (!generiert && dicht.length >= SCHWELLEN.riesenzeile && token.length >= SCHWELLEN.tokenMin && entropie(dicht) >= SCHWELLEN.entropie) {
      out.push(befund({ regel: 'anhang/riesenzeile', stufe: konfig ? 'block' : 'warn', datei: pfad, zeile, text: kern,
        warum: `Eine Zeile mit ${kern.length} Zeichen, Entropie ${entropie(dicht).toFixed(1)}, enthält ${token.slice(0, 4).join(', ')}. ${konfig ? 'In einer Konfig-Datei hat so etwas nichts verloren.' : 'Obfuskierter Code außerhalb von dist/min.'}`, quelle: QUELLE }));
      continue;
    }
    // 4) Versions-Tag oder CommonJS-Shim
    if (GLOBAL_TAG.test(text) || GLOBAL_SHIM.test(text)) {
      const stark = konfig || token.length >= 1 || kern.length > 300;
      out.push(befund({ regel: 'anhang/global-tag', stufe: stark ? 'block' : 'warn', datei: pfad, zeile, text: kern,
        warum: GLOBAL_SHIM.test(text) ? 'global[…]=require/module: der CommonJS-Rückweg, den die PolinRider-Loader in ESM-Dateien setzen.' : 'Versions-Tag der Form global.x=\'8-270-2\' – jede bekannte PolinRider-Variante markiert ihre Injektion so.', quelle: QUELLE }));
    }
  }
  return out;
}
