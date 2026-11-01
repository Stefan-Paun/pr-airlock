# schleuse

**A gate for incoming pull requests.** Schleuse reads a PR as *data* through the GitHub API, never checks it out and never runs it, and blocks the way repository-poisoning campaigns like **PolinRider** smuggle code into popular projects.

In 2026 a DPRK-attributed campaign appended obfuscated JavaScript to the end of ordinary config files (`postcss.config.mjs`, `tailwind.config.js`, `eslint.config.mjs`, `next.config.mjs`), hidden behind 500 to 2 000 spaces so it sits off-screen in any diff viewer, shipped loaders disguised as `fa-solid-400.woff2`, and used `.vscode/tasks.json` to run on folder open. Thousands of repositories were infected, and maintainers of large projects (shadcn/ui, NestJS, Prisma, Apache Superset, neutralino) received pull requests carrying the payload inside otherwise plausible changes. Several of them wrote their own grep workflows. Schleuse is that workflow, packaged, dependency-free, and built on *structure* rather than on markers the attacker has already rotated twice.

> Schleuse (German: *lock*, as in a canal lock) lets a PR through only after it has been looked at.

## Three lines in a workflow

```yaml
name: schleuse
on:
  pull_request_target:        # runs the base branch's workflow; the PR is only read through the API
permissions:
  contents: read
  pull-requests: write        # only for comment: true; drop it otherwise
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: Stefan-Paun/schleuse@v1
        with:
          comment: true       # one sticky comment with the findings, updated on every push
```

Make the check required in branch protection and the gate is closed. No checkout step, no `npm install`, no `${{ }}` inside `run:`; a malicious PR cannot edit the check away because `pull_request_target` always runs the workflow as it exists on the base branch.

Inputs: `fail-on` (`block` default, `warn`, `info`), `comment` (`false`), `sarif` (path; upload with `github/codeql-action/upload-sarif`), `token`. Outputs: `level`, `findings`.

## From the terminal

```sh
node bin/schleuse.mjs pr shadcn-ui/ui#7716          # any PR you can read; token from gh auth token / GITHUB_TOKEN
node bin/schleuse.mjs files postcss.config.mjs public/fonts/*.woff2
node bin/schleuse.mjs pr owner/repo#1 --md report.md --sarif report.sarif --fail-on warn
```

Exit codes: 0 clean or below threshold, 1 findings at or above `--fail-on`, 2 usage or API error. Node 20+, no dependencies.

## What it checks

| Rule | Severity | What it looks at |
|---|---|---|
| `anhang/fuellung` | block | an added line with ≥ 120 spaces/tabs *inside* it followed by ≥ 200 characters of code (or ≥ 200 leading spaces), with execution tokens such as `fromCharCode`, `eval(`, `atob(`, `child_process`; measured on real PolinRider PRs: 507 or 2 000 spaces, then 5 000 to 22 000 characters on one line |
| `anhang/riesenzeile` | block in config files, warn elsewhere | one line ≥ 1 500 characters, entropy ≥ 4.3, two or more execution tokens; skipped in `dist/`, `*.min.js`, lockfiles, source maps |
| `anhang/global-tag` | block / warn | the version tag every known variant writes (`global['!']='8-270-2'`, `global.o='5-3-235-du'`, `global.i='A10-…'`) and the ESM shim `global['r']=require` |
| `marker/*` | block | literal indicators from the OpenSourceMalware dossier and later reports: markers of variants 1 to 3, shuffle seeds (only in context), decoder names, XOR keys, TRON/Aptos dead-drop addresses, C2 hosts, `temp_auto_push.bat` including the `GIT_AUTHOR_DATE` variant |
| `tarnung/magic-bytes` | block | a `.woff2`, `.ttf`, `.png`, `.jpg`, `.webp`, … whose first bytes are not that format (the blob is fetched from the API and only its head is inspected) |
| `tarnung/base64-block` | warn | a ≥ 2 000-character Base64 run in a source file that is not a data-URL image |
| `autostart/vscode-task` | block / warn | `.vscode/tasks.json` with `runOn: folderOpen` plus a command |
| `autostart/npm-lifecycle` | warn (block if it pipes to a shell) | new or changed `preinstall`/`postinstall`/`prepare` scripts |
| `autostart/pipe-to-shell` | warn (info in docs) | `curl … \| sh`, `iwr … \| iex`, encoded PowerShell |
| `projekt/workflow-pwn-request` | block | a workflow that combines `pull_request_target` with a checkout of the PR head |
| `projekt/workflow-aus-fork` | warn | workflow files changed from a fork |
| `projekt/gitignore-versteck` | warn | `.gitignore` entries the campaign uses to hide its scripts |
| `projekt/neues-skript-im-root` | warn | a new `.bat`/`.ps1`/`.sh` in the repository root |

One finding per file and rule. Findings carry a sanitised 160-character excerpt; control characters and Markdown syntax from the PR never reach your terminal, job summary or comment unescaped.

## What it does not do

- It does not execute, install or parse the PR's code semantically. A payload split across many short lines without padding would need a different detector.
- GitHub returns at most 3 000 changed files per PR and omits diffs for very large files; Schleuse reports both as hints instead of pretending.
- A clean result means *none of the known shapes*, not *safe*.
- It is not a replacement for scanning your own machine or organisation after an infection; see [wormward](https://github.com/0fatihyildiz/wormward) and the [OpenSourceMalware dossier](https://github.com/OpenSourceMalware/PolinRider) for that.

## Development

```sh
node --test test/*.test.mjs
```

Test fixtures are synthetic: they reproduce the *shape* of the payloads (padding, line length, entropy, tokens, tag syntax), never working code. Modules: `lib/diff.mjs` (patch parsing), `lib/regeln/*` (one file per rule family, pure functions over added lines and blob bytes), `lib/github.mjs` (API client with injectable `fetch`), `lib/pruefung.mjs`, `lib/bericht/*` (console, Markdown, SARIF), `bin/action.mjs`, `bin/schleuse.mjs`.

## Credits

Indicators and campaign analysis: [OpenSourceMalware](https://opensourcemalware.com) PolinRider dossier and follow-up issues. The API-only, no-checkout design follows the hand-written PR content guard the NestJS maintainers published. MIT.
