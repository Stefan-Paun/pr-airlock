import { endung, dateiname } from '../diff.mjs';

// Dateien, in die PolinRider und Verwandte bevorzugt injizieren: alles, was Build-Werkzeuge automatisch laden.
export const KONFIG_MUSTER = [/\.config\.(?:m?js|cjs|ts|mts|cts)$/i, /(?:^|\/)(?:seed|migrate)\.(?:[mc]?js|ts)$/i, /(?:^|\/)(?:truffle|hardhat|gulpfile|gruntfile|webpack\.[\w.]*|rollup\.[\w.]*|vite\.[\w.]*|babel\.[\w.]*|jest\.[\w.]*|metro\.[\w.]*)\.(?:[mc]?js|ts)$/i];
export const CODE_ENDUNGEN = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx']);
// Generierte oder gepackte Dateien: lange Zeilen sind dort normal, deshalb nur Marker, keine Strukturregeln.
export const GENERIERT = [/\.min\.(?:m?js|css)$/i, /\.map$/i, /(?:^|\/)(?:dist|build|out|vendor|\.next|node_modules)\//i, /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i, /\.bundle\.js$/i];

export const istKonfig = (pfad) => KONFIG_MUSTER.some((m) => m.test(pfad));
export const istCode = (pfad) => CODE_ENDUNGEN.has(endung(pfad));
export const istGeneriert = (pfad) => GENERIERT.some((m) => m.test(pfad));
export { endung, dateiname };

// Token, ohne die ein funktionierender Entschlüssler-plus-Ausführer nicht auskommt.
export const CODE_TOKEN = ['eval(', 'Function(', 'fromCharCode', 'charCodeAt', 'child_process', 'spawn(', 'exec(', 'atob(', 'Buffer.from(', 'require(', 'import(', 'String.prototype', 'constructor(', 'XMLHttpRequest', 'fetch(', 'https.get', 'http.get', '.split(', '.join(', 'unescape(', 'decodeURIComponent('];

export function codeToken(text) {
  return CODE_TOKEN.filter((t) => text.includes(t));
}

export function entropie(text) {
  if (!text) return 0;
  const z = new Map();
  for (const ch of text) z.set(ch, (z.get(ch) || 0) + 1);
  let e = 0;
  for (const n of z.values()) { const p = n / text.length; e -= p * Math.log2(p); }
  return e;
}

// Längster Lauf aus Leerzeichen/Tabs, der nicht am Zeilenanfang steht (Einrückung zählt nicht) und hinter dem noch Code kommt.
export function fuellungInZeile(text) {
  let best = { laenge: 0, danach: '' };
  const re = /[ \t]{40,}/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index === 0) continue;
    const danach = text.slice(m.index + m[0].length);
    if (m[0].length > best.laenge && danach.trim().length > 0) best = { laenge: m[0].length, danach };
  }
  return best;
}

export function fuehrendeFuellung(text) {
  const m = /^[ \t]+/.exec(text);
  return m ? m[0].length : 0;
}
