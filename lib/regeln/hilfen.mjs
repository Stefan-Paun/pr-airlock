import { endung, dateiname } from '../diff.mjs';

// Dateien, in die PolinRider und Verwandte bevorzugt injizieren: alles, was Build-Werkzeuge automatisch laden.
export const KONFIG_MUSTER = [/\.config\.(?:m?js|cjs|ts|mts|cts)$/i, /(?:^|\/)(?:seed|migrate)\.(?:[mc]?js|ts)$/i, /(?:^|\/)(?:truffle|hardhat|gulpfile|gruntfile|webpack\.[\w.]*|rollup\.[\w.]*|vite\.[\w.]*|babel\.[\w.]*|jest\.[\w.]*|metro\.[\w.]*)\.(?:[mc]?js|ts)$/i];
// Alles, worin ausführbarer oder eingebetteter Code stehen kann.
export const CODE_ENDUNGEN = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte', 'astro', 'html', 'htm', 'json', 'yml', 'yaml', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'py', 'rb', 'php']);
// Generierte oder gepackte Dateien: lange Zeilen sind dort normal → nur die Riesenzeilen-Regel setzt aus, Füllung und Marker gelten weiter.
export const GENERIERT = [/\.min\.(?:m?js|css)$/i, /\.map$/i, /(?:^|\/)(?:dist|build|out|vendor|\.next|node_modules)\//i, /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i, /\.bundle\.js$/i, /\.snap$/i];

export const istKonfig = (pfad) => KONFIG_MUSTER.some((m) => m.test(pfad));
export const istCode = (pfad) => CODE_ENDUNGEN.has(endung(pfad));
export const istGeneriert = (pfad) => GENERIERT.some((m) => m.test(pfad));
export { endung, dateiname };

// Token, ohne die ein funktionierender Entschlüssler-plus-Ausführer kaum auskommt.
export const CODE_TOKEN = ['eval(', 'Function(', 'fromCharCode', 'charCodeAt', 'child_process', 'spawn(', 'exec(', 'atob(', 'Buffer.from(', 'require(', 'import(', 'String.prototype', 'constructor(', 'XMLHttpRequest', 'fetch(', 'https.get', 'http.get', '.split(', '.join(', 'unescape(', 'decodeURIComponent(', 'WScript', 'Invoke-Expression', 'subprocess'];

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

// Alles, was JavaScript als Whitespace zählt – NBSP, Em-Space, ideographisches Leerzeichen, BOM – nicht nur Leerzeichen und Tab.
export const WEISS = '[ \\t\\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000\\ufeff]';
const LAUF = new RegExp(`${WEISS}{40,}`, 'g');
const FUEHREND = new RegExp(`^${WEISS}+`);

// Längster Weißraum-Lauf, der nicht am Zeilenanfang steht (Einrückung zählt nicht) und hinter dem noch Code kommt.
export function fuellungInZeile(text) {
  let best = { laenge: 0, danach: '' };
  LAUF.lastIndex = 0;
  let m;
  while ((m = LAUF.exec(text))) {
    if (m.index === 0) continue;
    const danach = text.slice(m.index + m[0].length);
    if (m[0].length > best.laenge && danach.trim().length > 0) best = { laenge: m[0].length, danach };
  }
  return best;
}

export function fuehrendeFuellung(text) {
  const m = FUEHREND.exec(text);
  return m ? m[0].length : 0;
}
