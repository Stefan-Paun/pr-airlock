// Bekannte Literale. Sie fangen die heutigen Varianten sicher; die Strukturregeln in anhang.mjs fangen die nächste.
import { befund } from '../befund.mjs';

const Q = { osm: 'OpenSourceMalware PolinRider-Dossier (2026-04-11) + YARA polinrider_payload', shadcn: 'shadcn-ui/ui#11971 (2026-09-20)', osm14: 'OpenSourceMalware/PolinRider#14 (2026-11-01)' };

export const MARKER = [
  { id: 'polinrider-v1', text: 'rmcej%otb%', warum: 'Signatur-Marker PolinRider Variante 1', quelle: Q.osm },
  { id: 'polinrider-v1-decoder', text: '_$_1e42', warum: 'Decoder-Funktion PolinRider Variante 1', quelle: Q.osm },
  { id: 'polinrider-v1-seed', text: '2857687', warum: 'Shuffle-Seed PolinRider Variante 1', quelle: Q.osm, nur: /global|_\$_|\(\s*['"][^'"]+['"]\s*,\s*2857687\s*\)/ },
  { id: 'polinrider-v2', text: 'Cot%3t=shtP', warum: 'Signatur-Marker PolinRider Variante 2', quelle: Q.osm },
  { id: 'polinrider-v2-seed', text: '1111436', warum: 'Shuffle-Seed PolinRider Variante 2', quelle: Q.osm, nur: /global|MDy|\(\s*['"][^'"]+['"]\s*,\s*1111436\s*\)/ },
  { id: 'polinrider-global-bang', text: "global['!']", warum: 'Injektions-Global PolinRider Variante 1', quelle: Q.osm },
  { id: 'polinrider-global-v', text: "global['_V']", warum: 'Injektions-Global PolinRider Variante 2', quelle: Q.osm },
  { id: 'polinrider-v3-tag', regex: /\bglobal\.i\s*=\s*['"]A\d{1,3}-[\w*_-]{1,16}['"]/, warum: 'Versions-Tag global.i=\'A…\' der dritten Variante (javascript-obfuscator-Packung, eval/atob)', quelle: Q.shadcn },
  { id: 'polinrider-xor-1', text: '2[gWfGj;<:-93Z^C', warum: 'XOR-Schlüssel der Payload-Stufe', quelle: Q.osm },
  { id: 'polinrider-xor-2', text: 'm6:tTh^D)cBz?NM]', warum: 'XOR-Schlüssel der Payload-Stufe (sekundär)', quelle: Q.osm },
  { id: 'polinrider-c2-tron-1', text: 'TMfKQEd7TJJa5xNZJZ2Lep838vrzrs7mAP', warum: 'TRON-Dead-Drop-Adresse (C2)', quelle: Q.osm },
  { id: 'polinrider-c2-tron-2', text: 'TXfxHUet9pJVU1BgVkBAbrES4YUc1nGzcG', warum: 'TRON-Dead-Drop-Adresse (C2, sekundär)', quelle: Q.osm },
  { id: 'polinrider-c2-aptos-1', text: '0xbe037400670fbf1c32364f762975908dc43eeb38759263e7dfcdabc76380811e', warum: 'Aptos-Dead-Drop-Adresse (C2)', quelle: Q.osm },
  { id: 'polinrider-c2-aptos-2', text: '0x3f0e5781d0855fb460661ac63257376db1941b2bb522499e4757ecb3ebd5dce3', warum: 'Aptos-Dead-Drop-Adresse (C2, sekundär)', quelle: Q.osm },
  { id: 'polinrider-c2-host', regex: /\b(?:260120|default-configuration)\.vercel\.app\b/, warum: 'Bekannter PolinRider/TasksJacker-C2-Host', quelle: Q.osm },
  { id: 'blockchain-dead-drop', stufe: 'warn', regex: /api\.trongrid\.io\/v1\/accounts\/T[1-9A-HJ-NP-Za-km-z]{33}\/transactions|fullnode\.mainnet\.aptoslabs\.com\/v1\/accounts\/0x[0-9a-f]{64}\/transactions/, warum: 'Abfrage der letzten Transaktionen einer festen Blockchain-Adresse – so holen PolinRider-Loader ihre zweite Stufe. In Wallet-Code legitim, in Konfigs nicht.', quelle: Q.osm },
  { id: 'polinrider-staking-uuid', text: 'e9b53a7c-2342-4b15-b02d-bd8b8f6a03f9', warum: 'UUID des bewaffneten StakingGame-Templates', quelle: Q.osm },
  { id: 'polinrider-propagation', regex: /\btemp_auto_push\.bat\b|LAST_COMMIT_TEXT|git push -uf origin .*--no-verify/, warum: 'Verbreitungsskript (amend + force-push), auch die GIT_AUTHOR_DATE-Variante', quelle: Q.osm14 },
];

export const DATEINAMEN = [
  { id: 'polinrider-bat', regex: /(?:^|\/)(?:temp_auto_push|config)\.bat$/i, warum: 'Verbreitungs- bzw. Orchestrator-Skript der Kampagne', quelle: Q.osm },
];

export function pruefeMarker(datei, added) {
  const out = [];
  const pfad = datei.filename;
  for (const d of DATEINAMEN) {
    if (d.regex.test(pfad)) out.push(befund({ regel: `marker/${d.id}`, stufe: 'block', datei: pfad, warum: d.warum, quelle: d.quelle }));
  }
  const gesehen = new Set();
  for (const { zeile, text } of added) {
    for (const m of MARKER) {
      if (gesehen.has(m.id)) continue;
      const trifft = m.regex ? m.regex.test(text) : text.includes(m.text);
      if (!trifft) continue;
      if (m.nur && !m.nur.test(text)) continue;
      gesehen.add(m.id);
      out.push(befund({ regel: `marker/${m.id}`, stufe: m.stufe || 'block', datei: pfad, zeile, text, warum: m.warum, quelle: m.quelle }));
    }
  }
  return out;
}
