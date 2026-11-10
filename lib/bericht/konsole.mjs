import { zaehle } from '../befund.mjs';

const F = { rot: '\x1b[38;2;255;85;85m', gelb: '\x1b[38;2;241;250;140m', grau: '\x1b[38;2;98;114;164m', gruen: '\x1b[38;2;80;250;123m', cyan: '\x1b[38;2;139;233;253m', fett: '\x1b[1m', aus: '\x1b[0m' };
const FARBE = { block: F.rot, warn: F.gelb, info: F.grau };
const WORT = { block: 'BLOCK', warn: 'WARN ', info: 'INFO ' };

export function toConsole(ergebnis, { farben = process.stdout.isTTY } = {}) {
  const c = (code, s) => (farben ? code + s + F.aus : s);
  const { befunde, meta = {} } = ergebnis;
  const z = zaehle(befunde);
  const z1 = [];
  z1.push(c(F.fett, `Schleuse · ${meta.ziel || ''} · ${meta.dateien ?? '?'} Dateien geprüft`));
  if (!befunde.length) {
    z1.push(c(F.gruen, '  Keine Auffälligkeit. Das ist kein Freispruch, nur: nichts von dem, was Schleuse kennt.'));
  } else {
    z1.push(`  ${c(F.rot, z.block + ' block')} · ${c(F.gelb, z.warn + ' warn')} · ${c(F.grau, z.info + ' info')}`);
    for (const b of befunde) {
      z1.push(`  ${c(FARBE[b.stufe], WORT[b.stufe])} ${c(F.cyan, b.regel)}  ${b.datei}${b.zeile ? ':' + b.zeile : ''}`);
      z1.push(c(F.grau, `        ${b.warum}${b.urspruenglich ? ` (per Konfiguration von ${b.urspruenglich} umgestuft)` : ''}`));
      for (const d of b.details || []) z1.push(c(F.grau, `          - ${d}`));
      if (b.auszug) z1.push(c(F.grau, `        › ${b.auszug}`));
    }
  }
  const u = ergebnis.unterdrueckt || [];
  if (u.length) {
    z1.push(c(F.fett, `  ${u.length} Befund(e) per .schleuse.json unterdrückt:`));
    for (const x of u.slice(0, 50)) z1.push(c(F.grau, `    · ${x.regel}  ${x.datei}${x.zeile ? ':' + x.zeile : ''}  – unterdrückt wegen: ${x.grund}`));
    if (u.length > 50) z1.push(c(F.grau, `    · … und ${u.length - 50} weitere`));
  }
  for (const h of meta.hinweise || []) z1.push(c(F.gelb, `  ! ${h}`));
  return z1.join('\n');
}
