import { REGELN } from '../regeln/index.mjs';
import { saeubere } from '../diff.mjs';

const LEVEL = { block: 'error', warn: 'warning', info: 'note' };

export function toSarif(ergebnis, { version = '0.1.0' } = {}) {
  const regelIds = new Set([...REGELN.map((r) => r.id), ...ergebnis.befunde.map((b) => b.regel)]);
  const rules = [...regelIds].map((id) => ({ id, shortDescription: { text: REGELN.find((r) => r.id === id)?.text || (id.startsWith('marker/') ? REGELN.find((r) => r.id === 'marker/*').text : id) } }));
  const results = ergebnis.befunde.map((b) => ({
    ruleId: b.regel,
    level: LEVEL[b.stufe],
    message: { text: saeubere(`${b.warum}${b.auszug ? ' › ' + b.auszug : ''}`) },
    locations: [{ physicalLocation: { artifactLocation: { uri: b.datei }, ...(b.zeile ? { region: { startLine: b.zeile } } : {}) } }],
  }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'schleuse', version, informationUri: 'https://github.com/Stefan-Paun/schleuse', rules } }, results }],
  };
}
