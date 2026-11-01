// Strukturregeln: erkennen angehängte Payloads an ihrer Form, nicht an rotierbaren Markern.
// Vermessen an echten PolinRider-PRs (Nov 2026): 500–2000 Leerzeichen Abstand, eine Zeile mit
// 5 000–22 000 Zeichen, Entropie ≈ 5,5, immer Code-Token wie fromCharCode/split/join oder eval/atob.
import { befund } from '../befund.mjs';
import { istKonfig, istCode, istGeneriert, codeToken, entropie, fuellungInZeile, fuehrendeFuellung } from './hilfen.mjs';

export const SCHWELLEN = { fuellung: 120, fuehrend: 200, riesenzeile: 1500, entropie: 4.3, tokenMin: 2 };
const QUELLE = 'OpenSourceMalware PolinRider-Dossier; eigene Messung an PR-Diffs 2026-11-01';

// Versions-Tag, den jede bekannte Variante setzt: global['!']='8-270-2', global.o='5-3-235-du', global.i='A10-*1_3191', global["_V"]="…"
export const GLOBAL_TAG = /\bglobal\s*(?:\.\w+|\[\s*(?:'[^']{1,8}'|"[^"]{1,8}")\s*\])\s*=\s*(?:'[\w*_#-]{1,24}'|"[\w*_#-]{1,24}")/;
// Der ESM-Rückweg zu CommonJS, den die Payloads brauchen: global['r']=require / global.m=module
export const GLOBAL_SHIM = /\bglobal\s*(?:\.\w+|\[\s*['"][^'"]{1,4}['"]\s*\])\s*=\s*(?:require|module)\b/;

export function pruefeAnhang(datei, added) {
  const out = [];
  const pfad = datei.filename;
  if (!istCode(pfad) || istGeneriert(pfad)) return out;
  const konfig = istKonfig(pfad);
  for (const { zeile, text } of added) {
    const token = codeToken(text);
    const f = fuellungInZeile(text);
    if (f.laenge >= SCHWELLEN.fuellung && token.length >= 1 && f.danach.length >= 200) {
      out.push(befund({ regel: 'anhang/fuellung', stufe: 'block', datei: pfad, zeile, text: f.danach,
        warum: `Code versteckt hinter ${f.laenge} Leerzeichen in einer Zeile (${token.slice(0, 3).join(', ')}). So hängt PolinRider seinen Loader an Konfig-Dateien.`, quelle: QUELLE }));
      continue;
    }
    if (fuehrendeFuellung(text) >= SCHWELLEN.fuehrend && token.length >= 1 && text.trim().length >= 200) {
      out.push(befund({ regel: 'anhang/fuellung', stufe: 'block', datei: pfad, zeile, text: text.trim(),
        warum: `Zeile beginnt mit ${fuehrendeFuellung(text)} Leerzeichen, dahinter ${text.trim().length} Zeichen Code (${token.slice(0, 3).join(', ')}). Typische Off-Screen-Injektion.`, quelle: QUELLE }));
      continue;
    }
    const kern = text.trim();
    if (kern.length >= SCHWELLEN.riesenzeile && token.length >= SCHWELLEN.tokenMin && entropie(kern) >= SCHWELLEN.entropie) {
      out.push(befund({ regel: 'anhang/riesenzeile', stufe: konfig ? 'block' : 'warn', datei: pfad, zeile, text: kern,
        warum: `Eine Zeile mit ${kern.length} Zeichen, Entropie ${entropie(kern).toFixed(1)}, enthält ${token.slice(0, 4).join(', ')}. ${konfig ? 'In einer Konfig-Datei hat so etwas nichts verloren.' : 'Obfuskierter Code außerhalb von dist/min.'}`, quelle: QUELLE }));
      continue;
    }
    if (GLOBAL_TAG.test(text) || GLOBAL_SHIM.test(text)) {
      const stark = konfig || token.length >= 1 || kern.length > 300;
      out.push(befund({ regel: 'anhang/global-tag', stufe: stark ? 'block' : 'warn', datei: pfad, zeile, text: kern,
        warum: GLOBAL_SHIM.test(text) ? 'global[…]=require/module: der CommonJS-Rückweg, den die PolinRider-Loader in ESM-Dateien setzen.' : 'Versions-Tag der Form global.x=\'…\' – jede bekannte PolinRider-Variante markiert ihre Injektion so.', quelle: QUELLE }));
    }
  }
  return out;
}
