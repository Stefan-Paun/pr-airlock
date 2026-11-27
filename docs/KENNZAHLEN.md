# Kennzahlen

Erzeugt am 2026-11-27 mit `node bin/schleuse.mjs selbsttest --format md --datum 2026-11-27`. Nicht von Hand ändern: `npm test` prüft, dass diese Datei zum Korpus passt.

**Korpus:** 49 böse Fälle (Nachbildungen der *Form* bekannter Angriffe, Inhalt ist ein wirkungsloser Platzhalter) und 63 gute Fälle (harmlose Änderungen, die sich leicht verwechseln lassen). Alles liegt in [`korpus/`](../korpus/), ein Ordner je Fall mit Begründung.

## Gesamt

| | Ergebnis |
|---|---|
| Erwartete Befunde gefunden (in der erwarteten Stufe) | 98 % (57/58) |
| Böse Fälle ganz erkannt | 98 % (48/49) |
| Gute Fälle mit Fehlalarm (ab warn) | 6 % (4/63) |
| Abweichungen | 5 bekannt, 0 offen |

## Je Regel

Treffer: böse Fälle, die diese Regel erwarten, und wie viele davon sie in der erwarteten Stufe meldet. Fehlalarme: gute Fälle, auf denen sie ab warn anschlägt.

| Regel | Treffer | Fehlalarme |
|---|---:|---:|
| `anhang/fuellung` | 91 % (10/11) | 0 % (0/63) |
| `anhang/riesenzeile` | 100 % (2/2) | 0 % (0/63) |
| `anhang/global-tag` | 100 % (5/5) | 0 % (0/63) |
| `marker/polinrider-bat` | 100 % (2/2) | 0 % (0/63) |
| `marker/polinrider-v1` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-v1-decoder` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-v1-seed` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-v2` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-v2-seed` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-global-bang` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-global-v` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-v3-tag` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-xor-1` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-xor-2` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-c2-tron-1` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-c2-tron-2` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-c2-aptos-1` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-c2-aptos-2` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-c2-host` | – (0/0) | 0 % (0/63) |
| `marker/blockchain-dead-drop` | – (0/0) | 0 % (0/63) |
| `marker/polinrider-staking-uuid` | 100 % (1/1) | 0 % (0/63) |
| `marker/polinrider-propagation` | 100 % (1/1) | 0 % (0/63) |
| `tarnung/magic-bytes` | 100 % (4/4) | 0 % (0/63) |
| `tarnung/base64-block` | 100 % (1/1) | 2 % (1/63) |
| `autostart/vscode-task` | 100 % (2/2) | 3 % (2/63) |
| `autostart/vscode-settings` | 100 % (1/1) | 0 % (0/63) |
| `autostart/idea` | 100 % (1/1) | 0 % (0/63) |
| `autostart/npm-lifecycle` | 100 % (2/2) | 2 % (1/63) |
| `autostart/pipe-to-shell` | 100 % (3/3) | 0 % (0/63) |
| `projekt/workflow-pwn-request` | 100 % (1/1) | 0 % (0/63) |
| `projekt/workflow-aus-fork` | 100 % (1/1) | 0 % (0/63) |
| `projekt/gitignore-versteck` | 100 % (2/2) | 0 % (0/63) |
| `projekt/neues-skript-im-root` | 100 % (2/2) | 0 % (0/63) |
| `pruefung/unvollstaendig` | 100 % (2/2) | 0 % (0/63) |

## Bekannte Abweichungen

Diese Fälle zeigen bewusste Grenzen der Regeln. Sie zählen in den Quoten oben mit, lassen den Selbsttest aber nicht scheitern. Verschwindet eine, scheitert der Selbsttest, bis der Korpus nachgezogen ist.

- `data-url-schrift` (Fehlalarm, `tarnung/base64-block`, gefunden: warn): Die Regel nimmt nur data:image/ aus. Eine eingebettete Schrift sieht für sie aus wie ein verpackter Payload; nur warn.
- `fuellung-knapp-unter-schwelle` (Lücke, `anhang/fuellung`, gefunden: nichts): Die Schwelle liegt bei 120 Weißraum-Zeichen (gemessen: echte Fälle haben 500 bis 2000). Kürzere Füllungen sind auf dem Bildschirm meist noch sichtbar; die Schwelle ist per .schleuse.json senkbar.
- `package-prepare-husky` (Fehlalarm, `autostart/npm-lifecycle`, gefunden: warn): Die Regel warnt bewusst bei jedem neuen install/prepare-Skript, weil es bei jedem Install läuft; „husky“ ist harmlos, aber eine Liste harmloser Werte wäre leicht zu missbrauchen. Nur warn, blockt mit dem Standard nicht.
- `vscode-tasks-watch-folderopen` (Fehlalarm, `autostart/vscode-task`, gefunden: warn): Ein npm-Watch-Task mit folderOpen hat kein command-Feld; die Regel warnt trotzdem, weil sie nicht prüft, was hinter dem npm-Skript steht. Nur warn.
- `vscode-tasks-watch-shell` (Fehlalarm, `autostart/vscode-task`, gefunden: block): Die Regel blockt bewusst jeden folderOpen-Task mit Kommando, auch einen harmlosen Watcher: genau diese Form nutzt TasksJacker, und die Regel ist geschützt. Ausweg ist eine benannte Ausnahme mit Grund.

## Regeln ohne bösen Fall im Korpus

- `marker/polinrider-c2-host`: braucht einen echten Hostnamen; der Korpus enthält nur Beispiel-Domains. Abgedeckt in test/regeln.test.mjs.
- `marker/blockchain-dead-drop`: braucht die Adresse eines echten Blockchain-API-Hosts; der Korpus enthält nur Beispiel-Domains.

## Was diese Zahlen aussagen

Sie zeigen, dass jede Regel den Aufbau erkennt, für den sie gebaut ist, und auf typischen harmlosen Änderungen still bleibt. Die bösen Fälle sind Nachbildungen der Form, die aus Berichten über PolinRider und verwandte Kampagnen bekannt ist; die guten Fälle sind von Hand ausgewählt, gerade weil sie verwechselbar sind.

Sie sagen nichts über unbekannte Angriffe. Wer die Regeln kennt, kann einen Angriff so bauen, dass keine anschlägt. Eine Trefferquote von 100 % heißt hier nur: kein bekannter Aufbau aus dem Korpus rutscht durch. Die Fehlalarmquote gilt für diesen Korpus, nicht für jedes Projekt; echte Projekte haben andere harmlose Dateien. Der Feldtest gegen echte Pull Requests steht in der README.
