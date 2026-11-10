#!/bin/sh
# Beispiel: fremden Branch prüfen, BEVOR man ihn auscheckt, baut oder merged.
# Kein Netz, kein Token. schleuse liest nur Git-Objekte und führt nichts aus dem Repo aus.
# Nichts davon wird installiert; kopiere, was du brauchst.
set -eu

BRANCH="${1:?usage: pre-merge.sh <branch>}"
SCHLEUSE="${SCHLEUSE:-node /pfad/zu/schleuse/bin/schleuse.mjs}"

# Der Branch-Name kommt von außen: mit "--" und in Anführungszeichen übergeben.
# $SCHLEUSE absichtlich ohne Anführungszeichen (enthält "node <pfad>").
# shellcheck disable=SC2086
$SCHLEUSE diff --fail-on warn --md schleuse-report.md -- "main...$BRANCH"
echo "schleuse: nichts gefunden. Erst jetzt auschecken/mergen: git merge --no-ff -- \"$BRANCH\""
