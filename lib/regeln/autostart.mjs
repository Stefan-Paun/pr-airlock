// Dinge, die von selbst laufen, sobald jemand den Ordner öffnet oder `npm install` tippt.
import { befund } from '../befund.mjs';
import { dateiname } from '../diff.mjs';

const Q = { tj: 'TasksJacker/PolinRider: .vscode/tasks.json mit runOn: folderOpen (OSM-Dossier)', npm: 'Gängiger Supply-Chain-Vektor: Lifecycle-Skripte' };
const PIPE_SHELL = /\b(?:curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]{0,300}\|\s*(?:ba|z|da)?sh\b|\|\s*iex\b|\bInvoke-Expression\b|\bpowershell\b[^\n]{0,80}-enc(?:odedcommand)?\b/i;

export function pruefeAutostart(datei, added) {
  const out = [];
  const pfad = datei.filename;
  const name = dateiname(pfad);
  const text = added.map((a) => a.text).join('\n');

  if (/(?:^|\/)\.vscode\/tasks\.json$/i.test(pfad)) {
    const folderOpen = /"runOn"\s*:\s*"folderOpen"/i.test(text);
    const shell = /"type"\s*:\s*"(?:shell|process)"/i.test(text) || /"command"\s*:/.test(text);
    if (folderOpen && shell) {
      out.push(befund({ regel: 'autostart/vscode-task', stufe: 'block', datei: pfad, text: text.match(/"command"\s*:\s*"[^"]{0,200}"/)?.[0] || '',
        warum: 'VS-Code-Task startet beim Öffnen des Ordners ein Kommando. Genau so verbreitet sich TasksJacker.', quelle: Q.tj }));
    } else if (folderOpen) {
      out.push(befund({ regel: 'autostart/vscode-task', stufe: 'warn', datei: pfad, warum: 'VS-Code-Task mit runOn: folderOpen hinzugefügt. Bitte Kommando prüfen.', quelle: Q.tj }));
    }
  }
  if (/(?:^|\/)\.vscode\/settings\.json$/i.test(pfad) && /task\.allowAutomaticTasks"\s*:\s*"on"/.test(text)) {
    out.push(befund({ regel: 'autostart/vscode-settings', stufe: 'warn', datei: pfad, warum: 'Automatische Tasks werden per Workspace-Einstellung freigeschaltet.', quelle: Q.tj }));
  }
  if (/(?:^|\/)\.idea\/.*\.xml$/i.test(pfad) && /<option name="RUN_ON_STARTUP"|StartupTask|BeforeLaunch/i.test(text)) {
    out.push(befund({ regel: 'autostart/idea', stufe: 'warn', datei: pfad, warum: 'JetBrains-Startkonfiguration geändert.', quelle: Q.tj }));
  }
  if (name === 'package.json') {
    for (const { zeile, text: t } of added) {
      const m = /"(pre|post)?(?:install|prepare|prepublish|prepack)"\s*:\s*"([^"]{0,300})"/.exec(t);
      if (m) {
        out.push(befund({ regel: 'autostart/npm-lifecycle', stufe: PIPE_SHELL.test(m[2]) || /\bnode\s+-e\b|\beval\b|\bbase64\b/.test(m[2]) ? 'block' : 'warn', datei: pfad, zeile, text: t,
          warum: 'Neues oder geändertes npm-Lifecycle-Skript läuft bei jedem Install automatisch.', quelle: Q.npm }));
      }
    }
  }
  for (const { zeile, text: t } of added) {
    if (PIPE_SHELL.test(t)) {
      out.push(befund({ regel: 'autostart/pipe-to-shell', stufe: /\.(?:md|mdx|txt|rst)$/i.test(pfad) ? 'info' : 'warn', datei: pfad, zeile, text: t,
        warum: 'Download wird direkt in eine Shell gepiped. In Doku ok, in Skripten und Workflows prüfen.', quelle: Q.npm }));
      break;
    }
  }
  return out;
}
