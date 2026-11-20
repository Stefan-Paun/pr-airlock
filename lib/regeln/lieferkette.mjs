// Lieferkette: Angriffe über Abhängigkeiten, ohne eine einzige auffällige Codezeile.
// Strukturelle Warnzeichen in package.json, Lockfiles und .npmrc/.yarnrc*, rein aus dem Diff, ohne Netz.
// Stufen vorsichtig: Nur eindeutige Fälle (Quelle eines bekannten Pakets gewechselt, Registry umgebogen) blocken,
// damit normale Dependabot-/Renovate-Updates keinen Alarm auslösen.
import { posix } from 'node:path';
import { befund, STUFEN } from '../befund.mjs';
import { dateiname, parsePatch } from '../diff.mjs';
import { manifestAenderung, lockAenderung, lockFormat, quelle, algorithmus, ABSCHNITTE } from '../lieferkette/leser.mjs';

const Q = {
  lock: 'Lockfile-Injektion (Lockfile-Diffs werden selten gelesen): aufgelöste Adressen und Integrität sind die eigentliche Wahrheit',
  git: 'npm-Doku: git-/Tarball-/Datei-Abhängigkeiten umgehen Registry, Integritätswert und Versionsbindung',
  install: 'Gängiger Supply-Chain-Vektor: Install-Skripte neuer oder aktualisierter Pakete',
  rc: 'npm-/Yarn-Konfiguration: registry, Scope-Registry, strict-ssl, checksumBehavior',
  name: 'Typosquatting: Paketname nah an einem vorhandenen',
};

const PRUEFEN = {
  'lieferkette/lock-ohne-manifest': 'Prüfen: Wer hat das Lockfile neu erzeugt, und passt jede geänderte Version zu einer Absicht (Sicherheitsupdate, npm update)?',
  'lieferkette/quelle-gewechselt': 'Prüfen: Lockfile neu erzeugen (npm install / yarn / pnpm install) und vergleichen; eine Adresse außerhalb der Registry nicht übernehmen.',
  'lieferkette/direkt-von-git-oder-url': 'Prüfen: Warum nicht aus der Registry? Commit fest angeben (#<sha>) oder auf eine veröffentlichte Version wechseln.',
  'lieferkette/install-skript': 'Prüfen: Was das Install-Skript des Pakets tut; notfalls mit --ignore-scripts installieren.',
  'lieferkette/registry-umgebogen': 'Prüfen: Gehört die Registry eurem Team? TLS- und Prüfsummen-Abschaltungen nie übernehmen.',
  'lieferkette/namensnaehe': 'Prüfen: Ist das wirklich das gemeinte Paket und nicht ein Tippfehler-Doppelgänger?',
};

// Pakete, für die ein Lockfile auch ohne package.json-Änderung neu aufgelöst wird, sind normal → Hinweis genügt.
const MANIFEST_NAMEN = new Set(['package.json', 'pnpm-workspace.yaml']);
const RC = /(?:^|\/)\.(?:npmrc|yarnrc|yarnrc\.yml)$/;
const IN_NODE_MODULES = /(?:^|\/)node_modules\//;
const OEFFENTLICH_WARN = new Set(['npm.pkg.github.com']);

/** Sammelt je Datei und Regel alle Einzelfälle und baut daraus einen Befund mit der höchsten Stufe. */
function sammler() {
  const m = new Map();
  return {
    add(regel, datei, stufe, { zeile = null, text = '', grund, detail }) {
      const k = `${datei}|${regel}`;
      const s = m.get(k) || { regel, datei, stufe, zeile, text, gruende: [], details: [] };
      if (STUFEN.indexOf(stufe) > STUFEN.indexOf(s.stufe)) Object.assign(s, { stufe, zeile, text });
      if (grund && !s.gruende.includes(grund)) s.gruende.push(grund);
      if (detail) s.details.push(detail);
      m.set(k, s);
    },
    befunde: () => [...m.values()].map((s) => befund({
      regel: s.regel, stufe: s.stufe, datei: s.datei, zeile: s.zeile, text: s.text,
      warum: `${s.gruende.join(' ')} ${PRUEFEN[s.regel]}`, quelle: Q[QUELLE_VON[s.regel]], details: s.details,
    })),
  };
}
const QUELLE_VON = {
  'lieferkette/lock-ohne-manifest': 'lock', 'lieferkette/quelle-gewechselt': 'lock', 'lieferkette/direkt-von-git-oder-url': 'git',
  'lieferkette/install-skript': 'install', 'lieferkette/registry-umgebogen': 'rc', 'lieferkette/namensnaehe': 'name',
};

// Nur der Host einer Adresse geht in den Bericht – nie Pfad, Query oder Zugangsdaten (private Registries hängen dort Tokens an).
const zeigeQuelle = (adresse, format) => {
  const q = adresse == null && format !== 'npm' ? { art: 'registry', host: 'npm' } : quelle(adresse);
  if (q.art === 'registry') return q.host === 'npm' ? 'npm-Registry' : q.host || '?';
  if (q.art === 'datei') return 'lokaler Pfad';
  return `${q.art}${q.host ? ` (${q.host})` : ''}`;
};

/** Schwärzt Zugangsdaten in einer Konfigurationszeile: Token-Werte und Benutzer:Passwort in URLs. */
export function schwaerze(text) {
  return String(text)
    .replace(/((?:_authToken|_auth|_password|password|npmAuthToken|npmAuthIdent|token|username|email)\s*["']?\s*[=:]\s*).*/i, '$1***')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"']*@/gi, '$1***@')
    .replace(/(\?)[^\s"']*/g, '$1***');
}

// ---------------------------------------------------------------- .npmrc / .yarnrc / .yarnrc.yml

// Schlüssel dürfen in Anführungszeichen stehen (ini und YAML entfernen sie); .yarnrc.yml kennt auch die Flow-Form {a: {b: c}}.
const RC_REGISTRY = [
  /^\s*["']?(?:(@[\w.-]+):)?registry["']?\s*=\s*["']?([^\s"']+)/i,       // .npmrc
  /^\s*["']?(?:(@[\w.-]+):)?registry["']?\s+["']?([^\s"']+)/i,          // .yarnrc (v1)
  /["']?npmRegistryServer["']?\s*:\s*["']?([^\s"',}]+)/,                // .yarnrc.yml, auch unter npmScopes
];
const RC_TLS_AUS = [/^\s*["']?strict-ssl["']?\s*(?:=\s*|\s+)["']?false\b/i, /["']?enableStrictSsl["']?\s*:\s*["']?false\b/];
const RC_PRUEFSUMME = /["']?checksumBehavior["']?\s*:\s*["']?(ignore|update|reset)\b/;

function pruefeRc(datei, added, s) {
  const pfad = datei.filename;
  let scopeYaml = null;
  for (const { zeile, text } of added) {
    const t = text.replace(/\r$/, '');
    if (/^\s*[#;]/.test(t) || !t.trim()) continue;
    const zeige = schwaerze(t);
    const scope = /^\s{2}["']?([\w.-]+)["']?\s*:\s*$/.exec(t); // npmScopes:\n  firma:\n    npmRegistryServer: …
    if (scope) scopeYaml = '@' + scope[1];
    let url = null;
    let scopeName = null;
    for (const [i, re] of RC_REGISTRY.entries()) {
      const m = re.exec(t);
      if (!m) continue;
      url = i === 2 ? m[1] : m[2];
      scopeName = i === 2 ? (/^\s{4,}/.test(t) ? scopeYaml : /npmScopes/.test(t) ? '(Scope)' : null) : m[1] || null;
      break;
    }
    if (url) {
      const q = quelle(url);
      const ziel = scopeName ? `Scope ${scopeName} wird umgeleitet` : 'Registry wird umgestellt';
      // Auszug nur Schlüssel und Host: private Registries tragen Tokens auch im Pfad.
      const kurz = `${scopeName ? scopeName + ':' : ''}registry → ${q.art === 'http' ? 'http://' : ''}${q.host === 'npm' ? 'npm-Registry' : q.host || '?'}`;
      if (q.art === 'http') s.add('lieferkette/registry-umgebogen', pfad, 'block', { zeile, text: kurz, grund: `${ziel} auf eine unverschlüsselte http-Adresse.`, detail: `${zeile}: http (${q.host || '?'})` });
      else if (q.host === 'npm') s.add('lieferkette/registry-umgebogen', pfad, 'info', { zeile, text: kurz, grund: `${ziel}, Ziel ist die öffentliche npm-Registry.`, detail: `${zeile}: npm-Registry` });
      else if (q.host && OEFFENTLICH_WARN.has(q.host)) s.add('lieferkette/registry-umgebogen', pfad, 'warn', { zeile, text: kurz, grund: `${ziel} auf ${q.host}.`, detail: `${zeile}: ${q.host}` });
      else s.add('lieferkette/registry-umgebogen', pfad, 'block', { zeile, text: kurz, grund: `${ziel} auf einen fremden Host. Jedes Paket${scopeName ? ' dieses Scopes' : ''} kommt dann von dort.`, detail: `${zeile}: ${q.host || 'unlesbare Adresse'}` });
      continue;
    }
    const pruef = RC_PRUEFSUMME.exec(t);
    if (RC_TLS_AUS.some((re) => re.test(t))) {
      s.add('lieferkette/registry-umgebogen', pfad, 'block', { zeile, text: zeige, grund: 'TLS-Prüfung der Registry wird abgeschaltet.', detail: `${zeile}: TLS aus` });
    } else if (pruef && pruef[1] === 'ignore') {
      s.add('lieferkette/registry-umgebogen', pfad, 'block', { zeile, text: zeige, grund: 'Prüfsummen-Vergleich wird abgeschaltet.', detail: `${zeile}: checksumBehavior ignore` });
    } else if (pruef) {
      s.add('lieferkette/registry-umgebogen', pfad, 'warn', { zeile, text: zeige, grund: 'Abweichende Prüfsummen werden still übernommen.', detail: `${zeile}: checksumBehavior` });
    } else if (/^\s*["']?(?:ca|cafile)["']?\s*=/i.test(t) || /["']?(?:unsafeHttpWhitelist|httpsCaFilePath|caFilePath)["']?\s*:/.test(t)) {
      s.add('lieferkette/registry-umgebogen', pfad, 'warn', { zeile, text: zeige, grund: 'Eigenes Zertifikat oder http-Ausnahme für Registries.', detail: `${zeile}: Zertifikat/http-Ausnahme` });
    }
  }
}

// ---------------------------------------------------------------- package.json

/** Art einer Versions-Angabe, die an der Registry vorbeigeht (oder null für normale Bereiche, npm:, workspace:). */
export function direktArt(spec, manifestPfad) {
  const s = String(spec).trim();
  if (/^(?:npm|workspace|catalog|patch|exec):/i.test(s)) return null;
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:|ssh:)/i.test(s)) return 'git';
  if (/^[\w.-]+@[\w.-]+:(?!\/\/)/.test(s)) return 'git'; // scp-Form git@host:nutzer/repo.git
  if (/^https?:\/\//i.test(s)) return /\.git(?:#|$)/i.test(s) ? 'git' : 'url';
  if (/^(?:file:|link:|portal:)/i.test(s) || /^(?:\.{1,2}\/|\/|~)/.test(s)) {
    const pfad = s.replace(/^(?:file|link|portal):/i, '');
    if (/^(?:\/|~)/.test(pfad)) return 'pfad';
    const ziel = posix.normalize(posix.join(posix.dirname(manifestPfad), pfad));
    return ziel === '..' || ziel.startsWith('../') ? 'pfad' : null;
  }
  if (/^[\w.-]+\/[\w.-]+(?:#\S+)?$/.test(s) && !/^\d/.test(s)) return 'git'; // GitHub-Kurzform nutzer/repo
  return null;
}

const DIREKT_TEXT = { git: 'per git-Adresse', url: 'als HTTP-Tarball', pfad: 'aus einem Pfad außerhalb des Repos' };

// ---------------------------------------------------------------- Namensnähe

function teile(n) {
  const m = /^(@[^/]+)\/(.+)$/.exec(n);
  return m ? { scope: m[1], basis: m[2] } : { scope: '', basis: n };
}

function abstandHoechstensEins(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Wie nah ist ein neuer Name an einem vorhandenen? Gibt die Art zurück oder null.
 * Absichtlich eng: nur Ersetzung (nicht am ersten Zeichen), Dreher, Trennzeichen, Einfügen/Weglassen mitten im Namen,
 * und ein Scope, der sich in einem Zeichen unterscheidet. Ein Zeichen am Ende (vue/vuex) oder @types/* zählt nicht.
 */
export function namensnaehe(neu, alt) {
  if (neu === alt) return null;
  const a = teile(neu);
  const b = teile(alt);
  if (a.scope === '@types' || b.scope === '@types') return null;
  if (a.scope !== b.scope) {
    return a.scope && b.scope && a.basis === b.basis && abstandHoechstensEins(a.scope.slice(1), b.scope.slice(1)) ? 'anderer Scope' : null;
  }
  const x = a.basis.toLowerCase();
  const y = b.basis.toLowerCase();
  if (Math.min(x.length, y.length) < 4) return null;
  if (x === y) return 'Groß-/Kleinschreibung';
  const ohne = (t) => t.replace(/[-_.]/g, '');
  if (ohne(x) === ohne(y)) return 'Trennzeichen';
  if (x.length === y.length) {
    const diff = [...x].map((c, i) => (c === y[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length === 1 && diff[0] > 0) return 'ein Zeichen';
    if (diff.length === 2 && diff[1] === diff[0] + 1 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]]) return 'vertauschte Zeichen';
    return null;
  }
  if (Math.abs(x.length - y.length) === 1) {
    const [lang, kurz] = x.length > y.length ? [x, y] : [y, x];
    for (let i = 1; i < lang.length - 1; i++) if (lang.slice(0, i) + lang.slice(i + 1) === kurz) return 'ein Zeichen mehr oder weniger';
  }
  return null;
}

// ---------------------------------------------------------------- Hauptprüfung

/**
 * Prüft alle Dateien eines PRs gemeinsam (lock-ohne-manifest und namensnaehe sind dateiübergreifend).
 * `ladeText(datei)` liefert optional den ganzen Kopf-Stand einer package.json (oder null) – ohne ihn wird nur aus den Hunks gelesen.
 * Im Scan gibt es keinen Vorher-Stand: dort gilt nur registry-umgebogen.
 */
export async function pruefeLieferkette(dateien, { ladeText = async () => null, scan = false } = {}) {
  const s = sammler();
  const hinweise = [];
  const aktiv = dateien.filter((d) => d.status !== 'removed' && !IN_NODE_MODULES.test(d.filename));
  // Fail-closed wie der Rest von pruefeDateien: Was sich nicht lesen lässt, ist ein Befund (warn), kein stilles Durchwinken.
  const unvoll = [];
  const nichtPruefbar = (d, warum) => unvoll.push(befund({ regel: 'pruefung/unvollstaendig', stufe: 'warn', datei: d.filename,
    warum: `Lieferkette nicht prüfbar: ${warum}`, quelle: 'lieferkette/*: Leser arbeitet nur auf dem Diff' }));

  for (const d of aktiv.filter((x) => RC.test(x.filename))) pruefeRc(d, parsePatch(d.patch || '').added, s);
  if (scan) return { befunde: s.befunde(), hinweise };

  // Manifeste: neue und geänderte Abhängigkeiten
  const vorhanden = new Set();
  const neue = [];
  const manifeste = aktiv.filter((d) => MANIFEST_NAMEN.has(dateiname(d.filename)));
  for (const d of manifeste.filter((x) => dateiname(x.filename) === 'package.json')) {
    if (!d.patch) { if ((d.additions || 0) + (d.deletions || 0) > 0 || d.status === 'added') nichtPruefbar(d, 'kein Diff geliefert, Abhängigkeiten nicht verglichen.'); continue; }
    let kopfText = null;
    try { kopfText = await ladeText(d); } catch { kopfText = null; }
    const a = manifestAenderung(d.patch, { kopfText, hinzugefuegt: d.status === 'added' });
    if (a.unklar) nichtPruefbar(d, `${a.unklar} geänderte Zeile(n) ohne erkennbaren Abschnitt (Diff-Kontext zu klein).`);
    for (const v of a.vorher.values()) if (ABSCHNITTE.includes(v.abschnitt)) vorhanden.add(v.name);
    for (const e of [...a.neu, ...a.geaendert]) {
      const art = direktArt(e.spec, d.filename);
      if (!art) continue;
      s.add('lieferkette/direkt-von-git-oder-url', d.filename, 'warn', {
        zeile: e.zeile, text: `"${e.name}": "${schwaerze(e.spec)}"`,
        grund: `Abhängigkeit kommt ${DIREKT_TEXT[art]} statt aus der Registry: kein Integritätswert, Inhalt kann sich unter derselben Angabe ändern.`,
        detail: `${e.name} (${e.abschnitt}): ${DIREKT_TEXT[art]}`,
      });
    }
    for (const e of a.neu) if (ABSCHNITTE.includes(e.abschnitt)) neue.push({ ...e, datei: d.filename });
  }
  const neueNamen = new Set(neue.map((e) => e.name));
  for (const e of neue) {
    for (const alt of vorhanden) {
      if (neueNamen.has(alt)) continue;
      const art = namensnaehe(e.name, alt);
      if (!art) continue;
      s.add('lieferkette/namensnaehe', e.datei, 'warn', { zeile: e.zeile, text: `"${e.name}"`, grund: `Neues Paket ${e.name} ähnelt dem vorhandenen ${alt} (Unterschied: ${art}).`, detail: `${e.name} ~ ${alt} (${art})` });
      break;
    }
  }

  // Lockfiles
  for (const d of aktiv) {
    const format = lockFormat(d.filename);
    if (!format) continue;
    if (!d.patch) { if (d.status !== 'renamed' || (d.additions || 0) > 0) nichtPruefbar(d, 'kein Diff geliefert (zu groß?), Quellen, Integrität und Install-Skripte nicht verglichen.'); continue; }
    const r = lockAenderung(d.patch, format);
    if (r.unklar) nichtPruefbar(d, `${r.unklar} geänderte Zeile(n) ohne erkennbaren Paketkopf (Diff-Kontext zu klein).`);
    const neuesLock = d.status === 'added';
    let paketAenderungen = 0;
    for (const { name, vorher: v, nachher: n } of r.paare) {
      if (!n) { paketAenderungen++; continue; }
      if (n.neu || n.geaenderteFelder.size) paketAenderungen++;
      const qn = quelle(n.resolved);
      // Quelle eines bekannten Pakets: yarn-Berry und pnpm schreiben für die Registry gar keine Adresse.
      if (v && n.geaenderteFelder.has('resolved') && n.resolved) {
        const qv = v.resolved == null && format !== 'npm' ? { art: 'registry', host: 'npm' } : quelle(v.resolved);
        if (v.resolved != null || format !== 'npm') {
          if (!(qv.art === 'datei' && qn.art === 'datei') && (qv.art !== qn.art || qv.host !== qn.host)) {
            s.add('lieferkette/quelle-gewechselt', d.filename, 'block', { zeile: n.zeile, text: name,
              grund: 'Ein vorhandenes Paket wird jetzt von einer anderen Quelle aufgelöst.',
              detail: `${name}: ${zeigeQuelle(v.resolved, format)} → ${zeigeQuelle(n.resolved, format)}` });
          }
        }
      }
      // Yarn-Berry-Upgrade (cacheKey wechselt) berechnet jede Prüfsumme neu: dann kein Vergleich.
      if (!r.cacheWechsel && v && v.version && v.version === n.version && v.integrity && n.integrity && v.integrity !== n.integrity && algorithmus(v.integrity) === algorithmus(n.integrity)) {
        s.add('lieferkette/quelle-gewechselt', d.filename, 'block', { zeile: n.zeile, text: name,
          grund: 'Integritätswert ändert sich bei gleicher Version: derselbe Name liefert anderen Inhalt.',
          detail: `${name}@${n.version}: Integrität geändert` });
      }
      if (!v && n.resolved) {
        const fremd = qn.art === 'git' || qn.art === 'http' || qn.art === 'unbekannt' || (qn.art === 'registry' && qn.host !== 'npm' && !r.hostsVorher.has(qn.host));
        if (fremd) {
          s.add('lieferkette/quelle-gewechselt', d.filename, 'warn', { zeile: n.zeile, text: name,
            grund: 'Neues Paket wird nicht aus der bisher genutzten Registry aufgelöst.',
            detail: `${name}: ${zeigeQuelle(n.resolved, format)}` });
        }
      }
      if (!neuesLock && !r.formatWechsel && n.install && n.geaenderteFelder.has('install') && !(v && v.install)) {
        s.add('lieferkette/install-skript', d.filename, 'warn', { zeile: n.zeile, text: name,
          grund: v ? 'Ein vorhandenes Paket bringt in der neuen Version ein Install-Skript mit.' : 'Ein neues Paket bringt ein Install-Skript mit, das bei jedem Install läuft.',
          detail: `${name}${n.version ? '@' + n.version : ''}: ${v ? 'Install-Skript neu' : 'neues Paket mit Install-Skript'}` });
      }
    }
    // Lockfile ändert Pakete, aber kein Manifest im selben Projektbaum ändert sich.
    const dir = posix.dirname(d.filename);
    const passend = manifeste.some((m) => { const md = posix.dirname(m.filename); return dir === '.' || md === dir || md.startsWith(dir + '/'); });
    if (!neuesLock && paketAenderungen && !passend) {
      s.add('lieferkette/lock-ohne-manifest', d.filename, 'info', { grund: `Lockfile ändert ${paketAenderungen} Paket-Eintrag/-Einträge, ohne dass sich package.json ändert.`, detail: `${paketAenderungen} Paket-Eintrag/-Einträge geändert` });
    }
  }
  return { befunde: [...s.befunde(), ...unvoll], hinweise };
}
