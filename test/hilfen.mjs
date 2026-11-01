// Synthetische Nachbauten der FORM echter Payloads. Kein lauffähiger Code, nur Zeichenfolgen mit derselben Statistik.
export function pseudoBlob(laenge, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const bausteine = ["var _0x", "=['", "','", "'];", "function(", "){return ", ".split('')", ".join('')", "String.fromCharCode(", "0x", ")}", "charCodeAt(", "%", "^", "+"];
  let out = '';
  while (out.length < laenge) {
    const b = bausteine[Math.floor(rnd() * bausteine.length)];
    out += b + Math.floor(rnd() * 0xffff).toString(16) + (rnd() < 0.3 ? 'abcdefghij'.slice(0, Math.floor(rnd() * 9)) : '');
  }
  return out.slice(0, laenge);
}

export const fuellung = (n) => ' '.repeat(n);

export function datei(filename, addedLines, extra = {}) {
  const patch = ['@@ -1,0 +1,' + addedLines.length + ' @@', ...addedLines.map((l) => '+' + l)].join('\n');
  return { filename, status: 'modified', additions: addedLines.length, deletions: 0, patch, sha: 'deadbeef', ...extra };
}
