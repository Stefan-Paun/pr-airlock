// GitHub-API nur lesend (plus optional ein Kommentar). Token steht nur im Header, nie in URL oder Fehlertext.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const API = 'https://api.github.com';
export const WARTE_SEK = [5, 20, 60];
const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));

export async function githubToken(env = process.env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  if (env.GH_TOKEN) return env.GH_TOKEN;
  try {
    const { stdout } = await exec('gh', ['auth', 'token'], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function parsePrRef(ref) {
  const m = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\/pull\/|#)(\d+)\/?$/.exec(String(ref).trim());
  if (!m) throw new Error(`PR-Angabe nicht verstanden: ${ref} (erwartet owner/repo#123 oder PR-URL)`);
  return { owner: m[1], repo: m[2], nummer: Number(m[3]) };
}

export function client({ token, fetchImpl = fetch, api = API, log = () => {}, warteSek = WARTE_SEK } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'schleuse/0.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  // Retry-After kann Sekunden oder ein HTTP-Datum sein; x-ratelimit-reset ist eine Unix-Zeit.
  function wartezeit(res, standard) {
    const ra = res.headers?.get?.('retry-after');
    if (ra) {
      const n = Number(ra);
      if (Number.isFinite(n)) return Math.min(120, Math.max(1, n));
      const t = Date.parse(ra);
      if (Number.isFinite(t)) return Math.min(120, Math.max(1, Math.ceil((t - Date.now()) / 1000)));
    }
    const reset = Number(res.headers?.get?.('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.min(120, Math.max(1, Math.ceil(reset - Date.now() / 1000)));
    return standard;
  }

  // Nur wiederholen, wenn es wirklich nach Rate-Limit aussieht – ein echtes 403 (kein Zugriff) bleibt ein Fehler.
  function istRateLimit(res, text) {
    if (res.status === 429) return true;
    if (res.status !== 403) return false;
    return res.headers?.get?.('x-ratelimit-remaining') === '0' || Boolean(res.headers?.get?.('retry-after')) || /rate limit/i.test(text || '');
  }

  async function roh(pfad, { method = 'GET', body, accept } = {}) {
    const url = pfad.startsWith('http') ? pfad : `${api}${pfad}`;
    const kopf = { ...headers, ...(accept ? { Accept: accept } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    for (let versuch = 0; ; versuch++) {
      const res = await fetchImpl(url, { method, headers: kopf, body: body ? JSON.stringify(body) : undefined });
      if (res.ok) return res;
      const text = await res.text();
      if (method === 'GET' && versuch < warteSek.length && istRateLimit(res, text)) {
        const sek = wartezeit(res, warteSek[versuch]);
        log(`github: Rate-Limit, warte ${sek} s (Versuch ${versuch + 1}/${warteSek.length})`);
        await schlafe(sek * 1000);
        continue;
      }
      const err = new Error(`GitHub ${res.status} für ${new URL(url).pathname}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
      err.status = res.status;
      throw err;
    }
  }

  async function anfrage(pfad, opts) {
    const res = await roh(pfad, opts);
    const text = await res.text();
    return { daten: text ? JSON.parse(text) : null, headers: res.headers };
  }

  // Liest höchstens maxBytes aus einem Antwort-Body und bricht dann ab – riesige Blobs landen nie ganz im Speicher.
  async function kopfBytes(res, maxBytes) {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const teile = []; let n = 0;
      try {
        while (n < maxBytes) {
          const { value, done } = await reader.read();
          if (done) break;
          teile.push(value); n += value.length;
        }
      } finally {
        try { await reader.cancel(); } catch { /* egal */ }
      }
      return Buffer.concat(teile.map((t) => Buffer.from(t))).subarray(0, maxBytes);
    }
    const alles = Buffer.from(await res.arrayBuffer());
    return alles.subarray(0, maxBytes);
  }

  return {
    async pr(owner, repo, nummer) {
      const { daten } = await anfrage(`/repos/${owner}/${repo}/pulls/${nummer}`);
      return daten;
    },
    /** Alle geänderten Dateien, paginiert (GitHub: max 3000). */
    async prDateien(owner, repo, nummer) {
      const alle = [];
      for (let seite = 1; seite <= 30; seite++) {
        const { daten } = await anfrage(`/repos/${owner}/${repo}/pulls/${nummer}/files?per_page=100&page=${seite}`);
        alle.push(...daten);
        if (daten.length < 100) break;
      }
      return alle;
    },
    /** Erste Bytes eines Blobs als Rohdaten (Media-Type raw), gestreamt und nach maxBytes abgebrochen. */
    async blobBytes(owner, repo, sha, maxBytes = 256 * 1024) {
      if (!/^[0-9a-f]{40}$/.test(sha || '')) return null;
      const res = await roh(`/repos/${owner}/${repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json' });
      return kopfBytes(res, maxBytes);
    },
    /** Login des Token-Inhabers (null bei App-Token ohne /user). */
    async ich() {
      try { const { daten } = await anfrage('/user'); return daten?.login || null; } catch { return null; }
    },
    async kommentare(owner, repo, nummer) {
      const alle = [];
      for (let seite = 1; seite <= 30; seite++) {
        const { daten } = await anfrage(`/repos/${owner}/${repo}/issues/${nummer}/comments?per_page=100&page=${seite}`);
        alle.push(...daten);
        if (daten.length < 100) break;
      }
      return alle;
    },
    async kommentarSetzen(owner, repo, nummer, body) {
      return anfrage(`/repos/${owner}/${repo}/issues/${nummer}/comments`, { method: 'POST', body: { body } });
    },
    async kommentarAendern(owner, repo, id, body) {
      return anfrage(`/repos/${owner}/${repo}/issues/comments/${id}`, { method: 'PATCH', body: { body } });
    },
  };
}
