// Binär-Tarnung: eine „Font“ oder ein „Bild“, dessen erste Bytes nicht zur Endung passen, ist Code im Kostüm.
import { befund } from '../befund.mjs';
import { endung } from '../diff.mjs';

const QUELLE = 'OpenSourceMalware: fa-solid-400.woff2-Variante (142 Repos, Juli 2026); Magic-Bytes nach Dateiformat-Spezifikationen';

// Hex-Präfixe, mit denen eine Datei dieser Endung beginnen muss (mehrere Alternativen erlaubt).
export const MAGIC = {
  woff: ['774f4646'], woff2: ['774f4632'], ttf: ['00010000', '74727565'], otf: ['4f54544f', '00010000'],
  png: ['89504e470d0a1a0a'], jpg: ['ffd8ff'], jpeg: ['ffd8ff'], gif: ['474946383761', '474946383961'],
  webp: ['52494646'], ico: ['00000100'], pdf: ['25504446'], zip: ['504b0304', '504b0506'], gz: ['1f8b'],
  wasm: ['0061736d'], mp3: ['494433', 'fffb', 'fffa', 'fff3', 'fff2'], mp4: null, svg: null,
};

export function hexKopf(bytes, n = 16) {
  return Buffer.from(bytes).subarray(0, n).toString('hex');
}

export function passtMagic(ext, bytes) {
  const erwartet = MAGIC[ext];
  if (!erwartet) return null; // unbekannt oder absichtlich nicht geprüft
  const kopf = hexKopf(bytes);
  if (ext === 'webp') return kopf.startsWith('52494646') && kopf.slice(16, 24) === '57454250';
  return erwartet.some((p) => kopf.startsWith(p));
}

const CODE_IM_BINAER = /\b(?:eval|Function|require|fromCharCode|child_process|global\s*[.[])\b/;

/** `bytes` sind die ersten Bytes der Datei (aus dem Blob); null, wenn nicht ladbar. */
export function pruefeTarnung(datei, bytes) {
  const out = [];
  const pfad = datei.filename;
  const ext = endung(pfad);
  if (!(ext in MAGIC) || bytes == null) return out;
  const ok = passtMagic(ext, bytes);
  if (ok === false) {
    const kopf = Buffer.from(bytes).subarray(0, 400);
    const text = kopf.toString('latin1');
    const andereEndung = Object.keys(MAGIC).find((k) => k !== ext && MAGIC[k] && passtMagic(k, bytes));
    const istText = !kopf.includes(0) && /^[\x09\x0a\x0d\x20-\x7e\x80-\xff]*$/.test(text);
    // Bild im falschen Kostüm (PNG als .ico/.jpg) ist schlampig, aber kein Angriff → warn. Text/JS in einer Font ist einer → block.
    const stufe = istText || CODE_IM_BINAER.test(text) ? 'block' : 'warn';
    const sieht = CODE_IM_BINAER.test(text) ? 'Der Inhalt sieht nach JavaScript aus.' : istText ? 'Der Inhalt ist Text, keine Binärdatei.' : andereEndung ? `Der Inhalt sieht nach .${andereEndung} aus.` : 'Der Inhalt ist kein bekannter Dateikopf.';
    out.push(befund({ regel: 'tarnung/magic-bytes', stufe, datei: pfad, text: text.replace(/[^\x20-\x7e]/g, '.'),
      warum: `Datei heißt .${ext}, beginnt aber mit ${hexKopf(bytes, 8)} statt ${MAGIC[ext].join('/')}. ${sieht}${stufe === 'block' ? ' PolinRider liefert Loader als fa-solid-400.woff2 aus.' : ''}`, quelle: QUELLE }));
  }
  return out;
}

// Textdatei mit einem großen Base64-Block: oft eingebetteter Payload, manchmal nur ein Data-URL-Bild → warn.
// Linearer Scan statt Regex: auf 1-MB-Zeilen mit vielen fast-langen Läufen wird eine Regex quadratisch.
export function laengsterBase64Lauf(text, min = 2000) {
  let start = 0; let best = { laenge: 0, start: 0 };
  const ist = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && ist(text.charCodeAt(i))) continue;
    if (i - start > best.laenge) best = { laenge: i - start, start };
    start = i + 1;
  }
  return best.laenge >= min ? text.slice(best.start, best.start + best.laenge) : null;
}

export function pruefeBase64(datei, added) {
  const out = [];
  const pfad = datei.filename;
  if (/\.(?:svg|md|json|lock|map|snap|css)$/i.test(pfad)) return out;
  for (const { zeile, text } of added) {
    const lauf = laengsterBase64Lauf(text);
    if (lauf && !/data:image\//.test(text)) {
      out.push(befund({ regel: 'tarnung/base64-block', stufe: 'warn', datei: pfad, zeile, text: lauf,
        warum: `Base64-Block mit ${lauf.length} Zeichen in einer Quelldatei. Prüfen, was darin steckt (atob/Buffer.from in der Nähe?).`, quelle: 'Gängige Payload-Verpackung' }));
      break;
    }
  }
  return out;
}
