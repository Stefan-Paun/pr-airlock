# Plan: Regelfamilie `lieferkette/*` (Issue #1)

## Ziel
Ein PR kann über Abhängigkeiten angreifen, ohne eine auffällige Codezeile: neue Quelle im Lockfile, Git-Abhängigkeit, Install-Skript eines neuen Pakets, umgebogene Registry, Tippfehler-Paket. Die Familie erkennt die strukturellen Warnzeichen rein aus dem Diff, ohne Netz und ohne Bibliothek.

## Etappen
1. **Leser** (`lib/lieferkette/leser.mjs`): Hunks aus dem Patch, Vorher/Nachher-Sicht je Hunk, Rückwärts-Anwenden des Patches auf den Kopf-Stand (`package.json`), zeilenbasierte Leser für `package.json`, `package-lock.json` v2/v3, `yarn.lock` (v1 und Berry), `pnpm-lock.yaml` (v5–v9). Fehlertolerant: eine geänderte Zeile ohne erkennbaren Paketkopf zählt als „unklar“ und wird als Hinweis „nicht prüfbar“ gemeldet, nie geraten.
2. **Regeln** (`lib/regeln/lieferkette.mjs`) und Einbau in `pruefeDateien` (ein Durchgang über alle Dateien, weil `lock-ohne-manifest` und `namensnaehe` dateiübergreifend sind). Regeltabelle in `REGELN`, damit `.schleuse.json` sie kennt. Im Scan sind alle außer `registry-umgebogen` nicht anwendbar (sie brauchen einen Vorher-Stand).
3. **Fehlalarm-Sammlung** (`test/fixtures/lieferkette/`): mindestens 12 harmlose Updates (Dependabot-/Renovate-Form, Lockfile-Neuaufbau, Wechsel der Lockfile-Version, Workspace-Verweise …) ohne warn/block; README-Regeltabelle.

## Regeln und Stufen
| Regel | Stufe | Warum |
|---|---|---|
| `lieferkette/lock-ohne-manifest` | info | Lockfile-only-Updates sind bei Sicherheitsupdates normal; Hinweis genügt |
| `lieferkette/quelle-gewechselt` | block (warn bei neuen Paketen) | bekanntes Paket wechselt Host/Schema, oder Integrität ändert sich bei gleicher Version |
| `lieferkette/direkt-von-git-oder-url` | warn | neue Abhängigkeit per git, HTTP-Tarball oder Pfad außerhalb des Repos |
| `lieferkette/install-skript` | warn | Paket im Lockfile bekommt `hasInstallScript`/`requiresBuild` neu. Das eigene Manifest deckt `autostart/npm-lifecycle` schon ab (auf main) |
| `lieferkette/registry-umgebogen` | block (info für die öffentliche npm-Registry) | `.npmrc`/`.yarnrc*` mit fremder Registry, Scope-Umleitung, TLS- oder Prüfsummen-Abschaltung; Token-Werte werden geschwärzt |
| `lieferkette/namensnaehe` | warn | neues Paket, ein Zeichen/Dreher/Trenner/Scope vom vorhandenen entfernt |

## Tests
`test/lieferkette-leser.test.mjs` (je Format inkl. kaputter Dateien), `test/lieferkette.test.mjs` (je Regel positiv und negativ, Fehlalarm-Sammlung, Scan, Konfiguration). Alle Paketnamen und Adressen sind erfunden (`*.example`).

## Nicht dabei
Registry-Abfragen, andere Ökosysteme, Liste populärer Pakete.

## Stand
Alle drei Etappen sind umgesetzt (`test/lieferkette-leser.test.mjs`, `test/lieferkette.test.mjs`, `test/fixtures/lieferkette/harmlos.mjs` mit 16 harmlosen Szenarien).

Entscheidungen:
- Das eigene Manifest-Install-Skript (Teil 4 des Issues) war schon auf main als `autostart/npm-lifecycle`; `lieferkette/install-skript` deckt nur das Lockfile ab, damit es keine Doppelbefunde gibt.
- „Nicht prüfbar“ ist ein Hinweis im Bericht, kein Befund: Er soll nicht blocken, aber sichtbar sein.
- Namensnähe absichtlich eng (kein Zeichen am Ende, nicht am ersten Zeichen ersetzt, `@types/*` ausgenommen), damit `vue`/`vuex` oder `react`/`@testing-library/react` nicht anschlagen.
