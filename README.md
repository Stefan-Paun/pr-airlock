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
      - uses: Stefan-Paun/pr-airlock@v1
        with:
          comment: true       # one sticky comment with the findings, updated on every push
```

Make the check required in branch protection and the gate is closed. No checkout step, no `npm install`, no `${{ }}` inside `run:`; a malicious PR cannot edit the check away because `pull_request_target` always runs the workflow as it exists on the base branch.

Inputs: `fail-on` (`block`, `warn`, `info`; unset means `failOn` from `.schleuse.json`, else `block`), `comment` (`false`), `sarif` (path; upload with `github/codeql-action/upload-sarif`), `token`. Outputs: `level`, `findings`.

## From the terminal

```sh
node bin/schleuse.mjs pr shadcn-ui/ui#7716          # any PR you can read; token from gh auth token / GITHUB_TOKEN
node bin/schleuse.mjs files postcss.config.mjs public/fonts/*.woff2
node bin/schleuse.mjs pr owner/repo#1 --md report.md --sarif report.sarif --fail-on warn
```

Exit codes: 0 clean or below threshold, 1 findings at or above `--fail-on`, 2 usage or API error. Node 20+, no dependencies.

## Local mode: `diff` and `scan` (no GitHub, no token)

```sh
node bin/schleuse.mjs diff                      # HEAD against the merge-base with origin/HEAD, main or master
node bin/schleuse.mjs diff main..other-branch   # two-dot: direct comparison; main...other-branch: against the merge-base
node bin/schleuse.mjs diff other-branch         # one revision = the head; base = merge-base with the main branch (--base <rev> to choose)
node bin/schleuse.mjs scan [path]               # every git-tracked file of HEAD: "I cloned this, is it clean?"
```

Same rules, same reports (`--json`, `--md`, `--sarif`, `--fail-on`) and exit codes (0 / 1 / 2) as `pr`. The files come from `git` instead of the API, in the same shape (`filename`, `status`, `additions`, `patch`, `sha`), so a given content yields the same findings either way. Renames and binary files behave as in the API path.

- **Nothing from the checked repo runs.** git is started as a child process with an argument list (never a shell), a cleaned environment (`GIT_CONFIG_NOSYSTEM`, no global config, no inherited `GIT_*`), and `-c` switches that turn off hooks, pager, `core.fsmonitor`; diffs use `--no-ext-diff --no-textconv`. Only read-only object commands (`diff`, `ls-tree`, `cat-file`, `rev-parse`, `merge-base`) are allowed; `status`/`checkout`/`add` (which would touch clean/smudge filters) are refused. Revisions are resolved to commit SHAs first and never passed on as options. Symlinks and submodules are never followed (reported as a note). `.gitattributes` and `.git/config` of the checked repo have no effect; tests with a prepared repo prove it.
- **Configuration works as with `pr`.** `diff` and `scan` apply the `.schleuse.json` of the merge-base (for `scan`: of HEAD against the main branch; on the main branch itself that is HEAD), never the one of the checked head. If the head changes, adds or deletes `.schleuse.json` (a symlink counts too), that is a `konfig/aenderung` finding and the change has no effect. Without a findable main branch `scan` uses the defaults and says so. `schleuse diff` without an argument on the main branch itself (nothing to compare) prints a clear note instead of a silent "0 files".
- **`diff`** reads one patch per file (≤ 1 MB each, ≤ 50 MB in total); code without a patch is read whole from the blob (≤ 5 MB), anything beyond a limit becomes a `pruefung/unvollstaendig` finding as in the API path. At most 3 000 files.
- **`scan`** reads the committed state of `HEAD` from the object database (not the working tree: uncommitted edits and ignored files are not part of it), skips `node_modules` and symlinks (both noted), and checks up to 20 000 files. Rules that only make sense for a change (`projekt/workflow-aus-fork`, `projekt/neues-skript-im-root`) are off in a scan and listed as *not applicable* in the output (`meta.nichtAnwendbar` in the JSON). Run it from the repo root: it always scans the whole repository.
- A leading dash in a file name or revision is safe; use `--` before a positional argument that starts with `-`.

[`examples/pre-merge.sh`](examples/pre-merge.sh) shows a pre-merge call.

## What it checks

| Rule | Severity | What it looks at |
|---|---|---|
| `anhang/fuellung` | block (warn without execution tokens) | an added line with ≥ 120 whitespace characters *inside* it (spaces, tabs, NBSP, em-space, ideographic space, BOM) followed by ≥ 200 characters of code, or ≥ 200 leading whitespace characters; block with execution tokens such as `fromCharCode`, `eval(`, `atob(`, `child_process`, warn when only the entropy is high. Applies to every code-like file including `dist/` and `.min.js`. Measured on real PolinRider PRs: 507 or 2 000 spaces, then 5 000 to 22 000 characters on one line |
| `anhang/riesenzeile` | block in config files, warn elsewhere | one line ≥ 1 500 characters, entropy ≥ 4.3, two or more execution tokens; skipped in `dist/`, `*.min.js`, lockfiles, source maps |
| `anhang/global-tag` | block / warn | the version tag every known variant writes (`global['!']='8-270-2'`, `global.o='5-3-235-du'`, `global.i='A10-…'`: key of at most two characters, value shaped like a version) and the ESM shim `global['r']=require`; `global.TZ = 'UTC'` in a test setup does not match |
| `marker/*` | block (`marker/blockchain-dead-drop`: warn) | literal indicators from the OpenSourceMalware dossier and later reports: markers of variants 1 to 3, shuffle seeds (only in context), decoder names, XOR keys, TRON/Aptos dead-drop addresses, C2 hosts, `temp_auto_push.bat` including the `GIT_AUTHOR_DATE` variant |
| `tarnung/magic-bytes` | block / warn | a `.woff2`, `.ttf`, `.png`, `.jpg`, `.webp`, … whose first bytes are not that format. Block when the content is text or looks like JavaScript, warn when it is merely another binary format (a PNG named `.ico`). Only the first 256 KB of a binary blob are streamed from the API; code files without a diff are fetched up to 5 MB. At most 300 blobs and 50 MB per PR, riskiest first (code, then fonts, images last) |
| `tarnung/base64-block` | warn | a ≥ 2 000-character Base64 run in a source file that is not a data-URL image |
| `autostart/vscode-task` | block / warn | `.vscode/tasks.json` with `runOn: folderOpen` plus a command |
| `autostart/vscode-settings`, `autostart/idea` | warn | workspace settings that enable automatic tasks; JetBrains startup configuration |
| `autostart/npm-lifecycle` | warn (block if it pipes to a shell) | new or changed `preinstall`/`postinstall`/`prepare` scripts |
| `autostart/pipe-to-shell` | warn (info in docs) | `curl … \| sh`, `iwr … \| iex`, encoded PowerShell |
| `projekt/workflow-pwn-request` | block | a workflow that combines `pull_request_target` with a checkout of the PR head |
| `projekt/workflow-aus-fork` | warn | workflow files changed from a fork |
| `projekt/gitignore-versteck` | warn | `.gitignore` entries the campaign uses to hide its scripts |
| `projekt/neues-skript-im-root` | warn | a new `.bat`/`.ps1`/`.sh` in the repository root |
| `konfig/aenderung`, `konfig/ungueltig` | block | the PR changes `.schleuse.json`, or the base branch's configuration is invalid or unreadable; see [Configuration](#configuration-schleusejson). Not configurable |
| `pruefung/unvollstaendig` | warn / block | something could not be checked: GitHub omitted a diff and the blob could not be read, the 3 000-file limit was hit, more than 300 blobs, a code file larger than 5 MB, fewer files returned than the PR reports. Block when the unchecked part is code or a font or the file list is truncated, warn when it is only images. |

One finding per file and rule, keeping the highest severity. Findings carry a sanitised 160-character excerpt. File names, excerpts and reasons are cleaned before they reach your terminal, the job summary or the comment: control and bidi characters are removed, line breaks become `␊`, Markdown syntax is escaped or wrapped in code spans, and a `::` at the start of a log line is neutralised so a file name cannot issue workflow commands. Comments are truncated below GitHub's 65 536-character limit, and only Schleuse's own bot comment is ever updated.

## Configuration: `.schleuse.json`

A project can tune the gate with a `.schleuse.json` in the repository root (example: [`examples/schleuse.json`](examples/schleuse.json)). Validate it with `node bin/schleuse.mjs config pruefe [file]`, see what is in effect with `config zeige [file]` (`--base <ref>` reads it from the merge-base instead of the working tree).

```json
{
  "version": 1,
  "regeln": { "autostart/pipe-to-shell": "hinweis", "tarnung/*": "warnung" },
  "ausnahmen": [{ "pfad": "test/fixtures/**", "regel": "anhang/riesenzeile", "grund": "synthetic test data" }],
  "schwellen": { "riesenzeile": 3000 },
  "failOn": "fehler"
}
```

| Field | Meaning |
|---|---|
| `version` | schema version, must be `1` |
| `regeln` | rule id or `family/*` → `aus` \| `hinweis` \| `warnung` \| `fehler` (= info / warn / block). An exact id beats its family. The level replaces the rule's own level for every finding of that rule |
| `ausnahmen` | list of `{ pfad, regel?, grund }`. `grund` is mandatory (at least 8 characters). `pfad` supports `*` (within a segment), `**` (across segments, only as a whole segment) and `?`, rooted at the repository root, case-sensitive; a pattern that matches everything (`**`, `*`, `**/*`) is rejected |
| `schwellen` | the numeric constants the rules use today: `fuellung`, `fuehrend`, `mindestCode`, `riesenzeile`, `entropie`, `tokenMin`, `base64Min` (higher = fewer findings; each has a sane range) |
| `failOn` | `hinweis` \| `warnung` \| `fehler`: the run fails at this level or higher |

The file is checked strictly: unknown fields, unknown rule ids, broken patterns and out-of-range values are errors that name the field, the value and a suggestion for typos (`anhang/fuelung` → did you mean `anhang/fuellung`?). A broken file is never ignored silently: the defaults apply and the run reports `konfig/ungueltig` (fehler).

**Order of precedence** for the fail threshold: Action input `fail-on` / CLI `--fail-on` (if set) > `failOn` in `.schleuse.json` > `block`. Without a file nothing changes.

### Threat model

A gate that a pull request can reconfigure is no gate. So:

1. **The configuration is read from the base, never from the code under review.** In the Action via the API at the target commit (`base.sha`), locally from the merge-base (`--base <ref>`).
2. **A PR that touches `.schleuse.json`** (edits, creates, deletes or renames it) gets its own finding `konfig/aenderung` at level fehler, with a list of every loosening it contains (rules lowered, new exceptions, raised thresholds, later `failOn`). The change has no effect on that run; a maintainer reads it and merges it separately.
3. **Protected rules cannot be turned off or lowered**, neither one by one nor by family: `anhang/fuellung`, `anhang/global-tag`, `tarnung/magic-bytes`, `autostart/vscode-task`, `projekt/workflow-pwn-request`, `pruefung/unvollstaendig` and every `marker/*` that blocks (all but `marker/blockchain-dead-drop`). They are the rules with the highest hit severity and practically no false positives; if one fires, the answer is to look, not to dial it down. The only way to silence one is an exception that names the rule exactly and the path, with a `grund`. An exception without `regel` or with a family never covers them.
4. **Nothing disappears silently.** Every finding removed by an exception or by `aus` is listed in the console, the job summary, the comment and the SARIF file (`suppressions`) as "unterdrückt wegen: …" with its reason; downgraded findings say what they were.
5. File names that contain control or bidi characters never match an exception, and the `konfig/*` findings cannot be configured at all.

What this does not stop: an exception is trusted once a maintainer has merged it, so an attacker can still put a payload under an excepted path in a later PR. That is why exceptions are narrow by design (rule plus path), visible in every report, and protected rules need a named exception.

## Field test (2026-11-01)

| Set | PRs | Result |
|---|---:|---|
| documented PolinRider PRs: prisma/prisma-examples #8391, neutralinojs #1602, prisma-zod-generator #363 | 3 | all **block** (markers, padding rule, `.gitignore` hide) |
| latest merged PRs of next.js, tailwindcss, shadcn/ui, NestJS, Prisma | 15 | clean |
| merged PRs whose title names `postcss.config.mjs`, `tailwind.config` or `eslint.config.mjs` | 10 | clean |
| merged PRs adding `.woff2` fonts | 6 | clean |

## What it does not do

- It does not execute, install or parse the PR's code semantically. A payload split across many short lines without padding would need a different detector.
- GitHub returns at most 3 000 changed files per PR and omits diffs for very large files. Code files without a diff are fetched whole (up to 5 MB) and checked; everything that still cannot be checked becomes a `pruefung/unvollstaendig` finding (warn for images, block for code and fonts) instead of a silent pass.
- A clean result means *none of the known shapes*, not *safe*.
- It is not a replacement for scanning your own machine or organisation after an infection; see [wormward](https://github.com/0fatihyildiz/wormward) and the [OpenSourceMalware dossier](https://github.com/OpenSourceMalware/PolinRider) for that.

## Development

```sh
node --test test/*.test.mjs
```

Test fixtures are synthetic: they reproduce the *shape* of the payloads (padding, line length, entropy, tokens, tag syntax), never working code. Modules: `lib/diff.mjs` (patch parsing), `lib/regeln/*` (one file per rule family, pure functions over added lines and blob bytes), `lib/github.mjs` (API client with injectable `fetch`), `lib/pruefung.mjs`, `lib/git.mjs` (sandboxed git child process) and `lib/lokal.mjs` (local `diff`/`scan`: git → API-shaped file list), `lib/konfig/*` (pattern matching, schema, applying rules and exceptions, change detection, `config` commands), `lib/bericht/*` (console, Markdown, SARIF), `bin/action.mjs`, `bin/schleuse.mjs`.

## Credits

Indicators and campaign analysis: [OpenSourceMalware](https://opensourcemalware.com) PolinRider dossier and follow-up issues. The API-only, no-checkout design follows the hand-written PR content guard the NestJS maintainers published. MIT.
