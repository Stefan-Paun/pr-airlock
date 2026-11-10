# Plan: Konfigurationsdatei `.schleuse.json`

## Ziel
Projekte stufen Regeln ab oder hoch, nehmen Pfade aus und ändern Schwellen. Ein Angreifer kann die Prüfung
nicht im selben Pull Request abschalten.

## Grundsätze
- Konfiguration kommt immer vom **Basis-Stand** (Action: API am Ziel-Commit `base.sha`; lokal: Merge-Base), nie aus dem PR.
- Ändert der PR die Datei, ist das ein Befund `konfig/aenderung` (fehler) mit Lockerungs-Diff; die Änderung wirkt nicht.
- Geschützte Regeln lassen sich nicht abschalten, nur per Ausnahme mit Grund für einen Pfad aussetzen.
- Jede wirksame Ausnahme steht im Bericht („unterdrückt wegen: …“).
- Ohne Datei: Verhalten wie bisher.

## Etappen
1. **Muster und Schema** (`lib/konfig/muster.mjs`, `lib/konfig/schema.mjs`): Abgleich mit `*`, `**`, `?`; strenge Prüfung mit Tippfehler-Vorschlägen; Tests.
2. **Anwenden** (`lib/konfig/anwenden.mjs`, Schwellen in `lib/regeln/anhang.mjs`/`tarnung.mjs` parametrierbar): Abstufen, Familien, Ausnahmen, Geschützte, Unterdrücktes im Ergebnis; Tests.
3. **Basis-Stand und Änderungsbefund** (`lib/konfig/lockerung.mjs`, `lib/pruefung.mjs`, `lib/github.mjs`): Datei vom Basis-Commit, PR ändert Datei → Befund; Fixtures statt Netz.
4. **Bericht, Action, CLI** (`lib/bericht/*`, `bin/action.mjs`, `bin/schleuse.mjs`, `action.yml`): „unterdrückt“-Abschnitt, Rangfolge Eingabe > Datei > Standard, `schleuse config pruefe|zeige`.
5. **Doku**: `examples/schleuse.json`, README-Abschnitt mit Bedrohungsmodell.

## Test
`npm test` (node:test), keine Netzanfragen, API-Antworten als Fixtures.

## Bewusst nicht dabei
Neue Regeln, Konfiguration per Code-Kommentar, verschachtelte Konfigurationen in Unterordnern, Zeichenklassen im Muster.

## Stand
Etappen 1–3 fertig (Muster, Schema, Anwenden, Basis-Stand, Änderungsbefund).
