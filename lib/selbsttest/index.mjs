// `schleuse selbsttest`: Korpus laden, Hygiene prüfen, Regeln laufen lassen, auswerten, berichten.
// Kein Netz, keine Konfiguration des geprüften Repos: der Selbsttest misst die Regeln im Standard.
import { ladeKorpus, KORPUS_STANDARD } from './korpus.mjs';
import { pruefeFallHygiene } from './hygiene.mjs';
import { fuehreAus, werte, regelFilter } from './auswertung.mjs';
import { alsText, alsMarkdown, alsJson } from './bericht.mjs';

export const FORMATE = ['text', 'md', 'json'];

export function heute(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
}

/**
 * Ergebnis: { code, stdout, auswertung }. code 0 = bestanden, 1 = offene Abweichung oder Hygiene-Verstoß.
 * Ein kaputter Korpus wirft (der Aufrufer macht daraus Exit 2).
 */
export async function selbsttest({ korpus = KORPUS_STANDARD, regeln = [], format = 'text', datum = null } = {}) {
  if (!FORMATE.includes(format)) throw new Error(`--format must be ${FORMATE.join(', ')}`);
  if (datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new Error('--datum must be YYYY-MM-DD');
  const filter = regelFilter(regeln);
  const muster = regeln.flatMap((r) => String(r).split(',')).map((r) => r.trim()).filter(Boolean);
  const faelle = await ladeKorpus(korpus);
  const hygiene = faelle.flatMap((f) => pruefeFallHygiene(f));
  const auswertung = werte(faelle, await fuehreAus(faelle), { filter });
  let stdout;
  if (format === 'json') stdout = JSON.stringify({ ...alsJson(auswertung, { datum, filter: muster }), hygiene }, null, 1);
  else if (format === 'md') stdout = alsMarkdown(auswertung, { datum: datum || heute(), filter: muster });
  else stdout = alsText(auswertung, { filter: muster });
  if (hygiene.length && format !== 'json') stdout += `\n\nKorpus-Hygiene verletzt (${hygiene.length}):\n${hygiene.map((h) => `  ✗ ${h}`).join('\n')}`;
  return { code: auswertung.ok && !hygiene.length ? 0 : 1, stdout, auswertung };
}
