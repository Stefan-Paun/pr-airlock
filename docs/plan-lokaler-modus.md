# Plan: Lokaler Modus (`schleuse diff` / `schleuse scan`)

## Ziel
Dieselben Regeln auf einen Commit-Bereich oder ein ausgechecktes Repo anwenden, ohne GitHub-API und ohne Token – bevor man einen fremden Branch ausführt oder merged.

## Zwischenschicht
Die Regeln (`pruefeDateien`) bekommen schon heute Dateien im API-Format `{ filename, status, additions, deletions, patch?, sha }` plus `ladeBytes`. Der lokale Weg erzeugt genau diese Form aus git; der API-Weg bleibt unverändert.

## Etappen
1. **Sicherer git-Aufruf** (`lib/git.mjs`): nur `execFile`/`spawn` mit Argument-Liste, bereinigte Umgebung, Hooks/Pager/fsmonitor/ext-diff/textconv/Filter aus. Test mit präpariertem Repo.
2. **`schleuse diff`** (`lib/lokal.mjs`): Rev-Auflösung zu SHAs, Dateiliste mit Status/Umbenennung/Binär, Patches je Datei, Größenlimits, Symlinks und Submodule werden nicht gelesen.
3. **`schleuse scan`**: alle von git verfolgten Blobs aus HEAD (Objektdatenbank, nicht Arbeitsverzeichnis), ohne `node_modules`; Regeln nur für Änderungen werden als „nicht anwendbar“ ausgewiesen.
4. **CLI und Berichte**: Befehle, `--`, Ausgabe in Text/Markdown/JSON/SARIF, Exit-Codes 0/1/2.
5. **Doku**: README-Abschnitt, Beispiel `examples/pre-merge.sh`.

## Dateien
`lib/git.mjs`, `lib/lokal.mjs`, `lib/pruefung.mjs` (Hilfsfunktion), `lib/regeln/index.mjs` (Dateilimit), `lib/regeln/projekt.mjs` (Scan-Modus), `lib/bericht/*`, `bin/schleuse.mjs`, `test/lokal.test.mjs`, `test/git-sicherheit.test.mjs`.

## Tests
Temporäre Repos mit den synthetischen Nachbildungen aus `test/hilfen.mjs`; Vergleich mit dem API-Weg auf identischen Inhalt; keine Netzanfragen.

## Nicht dabei
Neue Regeln, Ausführen von Code aus geprüften Repos, Submodule betreten, Arbeitsverzeichnis-Änderungen (uncommitted) im Scan.

## Stand
Alle fünf Etappen sind umgesetzt und getestet (`test/lokal.test.mjs`, `test/git-sicherheit.test.mjs`).

Entscheidungen:
- Der Scan liest `HEAD` aus der Objektdatenbank statt aus dem Arbeitsverzeichnis: kein Symlink-Folgen, keine Filter, keine ignorierten Dateien.
- Der git-Wrapper erlaubt nur `diff`, `ls-tree`, `cat-file`, `rev-parse`, `merge-base`.
- Lokal gelten großzügigere Blob-Grenzen (5 000 Blobs, 200 MB), weil keine API-Minuten kosten.
- Nicht anwendbar im Scan: `projekt/workflow-aus-fork`, `projekt/neues-skript-im-root`.
- Offen: Die Quelle in `pruefung/unvollstaendig` nennt weiter die GitHub-API-Grenzen; Scan von Unterordnern prüft immer das ganze Repo.
