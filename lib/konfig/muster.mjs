// Eigener kleiner Pfad-Abgleich: `*` (innerhalb eines Segments), `**` (über Segmente), `?` (ein Zeichen). Keine Bibliothek.
// Bewusst eng: keine Zeichenklassen, keine Negation, nur relative Pfade mit `/`.

const VERBOTEN = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩\\[\]{}!]/;

/** Liefert null, wenn das Muster brauchbar ist, sonst eine Meldung. */
export function pruefeMuster(muster) {
  if (typeof muster !== 'string' || !muster) return 'Muster muss ein nicht leerer Text sein';
  if (muster.length > 200) return 'Muster ist länger als 200 Zeichen';
  if (VERBOTEN.test(muster)) return 'Muster enthält ein nicht unterstütztes Zeichen (Steuerzeichen, \\ [ ] { } !); erlaubt sind nur * ** ?';
  if (muster.startsWith('/')) return 'Muster muss relativ zum Projektstamm sein (kein führendes /)';
  const teile = muster.split('/');
  for (const t of teile) {
    if (t === '') return 'Muster enthält ein leeres Segment (// oder abschließendes /)';
    if (t === '.' || t === '..') return 'Muster darf kein . oder .. enthalten';
    if (t.includes('**') && t !== '**') return '** ist nur als ganzes Segment erlaubt (z. B. dir/**/datei)';
  }
  // Muss etwas Festes enthalten, sonst träfe es „alles“ (`**`, `*`, `**/*`, `?`).
  if (!teile.some((t) => t !== '**' && /[^*?]/.test(t))) return 'Muster trifft alles (nur Platzhalter); nenne mindestens einen festen Teil, z. B. test/fixtures/**';
  return null;
}

// Ein Segment mit * und ?: iterativ, ohne Backtracking-Explosion.
function segment(muster, text) {
  let m = 0; let t = 0; let stern = -1; let rest = 0;
  while (t < text.length) {
    if (m < muster.length && (muster[m] === '?' || muster[m] === text[t]) && muster[m] !== '*') { m++; t++; }
    else if (m < muster.length && muster[m] === '*') { stern = m++; rest = t; }
    else if (stern >= 0) { m = stern + 1; t = ++rest; }
    else return false;
  }
  while (m < muster.length && muster[m] === '*') m++;
  return m === muster.length;
}

/** Kompiliert ein (geprüftes) Muster zu einer Prüffunktion über Pfade mit `/`. Wirft bei ungültigem Muster. */
export function kompiliere(muster) {
  const fehler = pruefeMuster(muster);
  if (fehler) throw new Error(fehler);
  const teile = muster.split('/');
  return (pfad) => {
    if (typeof pfad !== 'string' || !pfad) return false;
    const p = pfad.split('/');
    const memo = new Map();
    const geh = (i, j) => {
      const k = i * (p.length + 1) + j;
      if (memo.has(k)) return memo.get(k);
      let r;
      if (i === teile.length) r = j === p.length;
      else if (teile[i] === '**' && i === teile.length - 1) r = j < p.length; // endendes `**`: mindestens ein Segment, dann alles
      else if (teile[i] === '**') r = geh(i + 1, j) || (j < p.length && geh(i, j + 1)); // mitten im Muster darf `**` leer sein
      else r = j < p.length && segment(teile[i], p[j]) && geh(i + 1, j + 1);
      memo.set(k, r);
      return r;
    };
    return geh(0, 0);
  };
}

export const passt = (muster, pfad) => kompiliere(muster)(pfad);
