// Projekt-Hygiene: Workflow-Änderungen aus Forks, versteckte Skripte, .gitignore-Tricks.
import { befund } from '../befund.mjs';
import { dateiname } from '../diff.mjs';

const Q = 'OSM-Dossier (config.bat in .gitignore) und GitHub-Actions-Sicherheitsleitfaden';

export function pruefeProjekt(datei, added, kontext = {}) {
  const out = [];
  const pfad = datei.filename;
  const name = dateiname(pfad);
  const text = added.map((a) => a.text).join('\n');

  if (/^\.github\/workflows\//.test(pfad)) {
    if (/pull_request_target/.test(text) && /actions\/checkout/.test(text) && /head\.(?:sha|ref)|github\.event\.pull_request\.head/.test(text)) {
      out.push(befund({ regel: 'projekt/workflow-pwn-request', stufe: 'block', datei: pfad, warum: 'pull_request_target plus Checkout des PR-Heads: fremder Code läuft mit Repo-Rechten („pwn request“).', quelle: Q }));
    } else if (kontext.ausFork && !kontext.scan) {
      out.push(befund({ regel: 'projekt/workflow-aus-fork', stufe: 'warn', datei: pfad, warum: 'Workflow-Datei wird aus einem Fork geändert. Rechte, Trigger und Secrets prüfen.', quelle: Q }));
    }
  }
  if (name === '.gitignore') {
    for (const { zeile, text: t } of added) {
      if (/^\s*(?:config\.bat|\*\.bat|temp_auto_push\.bat|\.vscode\/tasks\.json)\s*$/i.test(t)) {
        out.push(befund({ regel: 'projekt/gitignore-versteck', stufe: 'warn', datei: pfad, zeile, text: t, warum: 'gitignore-Eintrag, mit dem die Kampagne ihre Skripte vor dem Diff versteckt.', quelle: Q }));
      }
    }
  }
  if (!pfad.includes('/') && /\.(?:bat|cmd|ps1|vbs|sh)$/i.test(name) && datei.status === 'added' && !kontext.scan) {
    out.push(befund({ regel: 'projekt/neues-skript-im-root', stufe: 'warn', datei: pfad, warum: 'Neues Shell-/Batch-Skript im Projektstamm. Inhalt lesen, bevor jemand es ausführt.', quelle: Q }));
  }
  return out;
}
