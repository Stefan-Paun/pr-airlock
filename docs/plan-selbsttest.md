# Plan: Selbsttest mit Kennzahlen (`schleuse selbsttest`)

## Ziel
„Erkennt X, 0 Fehlalarme“ soll jederzeit nachprüfbar sein: ein Befehl lässt alle Regeln gegen einen mitgelieferten,
entschärften Korpus laufen und zeigt je Regel Trefferquote und Fehlalarmquote, immer mit der Anzahl dahinter.

## Etappen
1. **Korpus-Format, Laden, Hygiene** (`lib/selbsttest/korpus.mjs`, `lib/selbsttest/hygiene.mjs`): ein Ordner je Fall
   unter `korpus/boese/` und `korpus/gut/` mit `fall.json` (Kennung, Art, erwartete Regeln, Begründung) und den Diffs
   als Fixture. Vorhandene Test-Fixtures werden per Verweis einbezogen. Hygiene-Prüfung gegen echte Payloads.
2. **Auswertung** (`lib/selbsttest/auswertung.mjs`): reines Modul. Je Regel Treffer, übersehen, falsche Stufe,
   Fehlalarm; Gesamtzeile; Abweichungen mit Fall-Kennung; bekannte Abweichungen werden gezählt, brechen aber nicht.
3. **Korpus füllen**: mindestens 30 böse und 50 gute Fälle.
4. **CLI und Kennzahlen-Seite** (`lib/selbsttest/bericht.mjs`, `bin/schleuse.mjs`): `schleuse selbsttest
   [--format text|md|json] [--regel …] [--datum JJJJ-MM-TT]`, Exit 1 bei fehlendem erwarteten Befund oder Fehlalarm.
   `docs/KENNZAHLEN.md` wird mit `--format md` erzeugt; ein Test prüft, dass sie zum Korpus passt.
5. **Doku**: README verweist auf die Kennzahlen.

## Test
`npm test`: Auswertung (synthetische Ergebnisse), Exit-Codes, Korpus-Hygiene, Kennzahlen-Datei aktuell, Lauf ohne Netz
(`fetch` wird im Test gesperrt).

## Bewusst nicht dabei
Echte Payloads, echte bösartige PRs, Netzanfragen, Umbau bestehender Regeln. Gefundene Lücken und Fehlalarme werden
im Korpus als bekannte Abweichung markiert und im Bericht genannt.

## Stand
Alle 5 Etappen fertig: 49 böse und 63 gute Fälle, Hygiene-Prüfung, Auswertung, `schleuse selbsttest`,
`docs/KENNZAHLEN.md` mit Aktualitätstest, README-Abschnitt. Gefunden und als bekannt markiert: eine Lücke
(Füllung unter 120 Zeichen) und vier Fehlalarme (folderOpen-Watcher zweimal, `prepare: husky`,
eingebettete Schrift als Base64).
