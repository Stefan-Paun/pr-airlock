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

  async function anfrage(pfad, { method = 'GET', body } = {}) {
    const url = pfad.startsWith('http') ? pfad : `${api}${pfad}`;
    for (let versuch = 0; ; versuch++) {
      const res = await fetchImpl(url, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined });
      if ((res.status === 403 || res.status === 429) && versuch < warteSek.length && method === 'GET') {
        const roh = res.headers?.get?.('retry-after');
        const sek = roh ? Math.min(120, Number(roh) || warteSek[versuch]) : warteSek[versuch];
        log(`github: Rate-Limit, warte ${sek} s`);
        await schlafe(sek * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`GitHub ${res.status} für ${new URL(url).pathname}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
      return { daten: text ? JSON.parse(text) : null, headers: res.headers };
    }
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
    /** Erste Bytes eines Blobs (Base64 aus der API). Begrenzt, damit riesige Dateien nicht den Speicher fressen. */
    async blobBytes(owner, repo, sha, maxBytes = 2 * 1024 * 1024) {
      if (!/^[0-9a-f]{40}$/.test(sha || '')) return null;
      const { daten } = await anfrage(`/repos/${owner}/${repo}/git/blobs/${sha}`);
      if (daten.encoding !== 'base64') return null;
      const b64 = String(daten.content).replace(/\s/g, '');
      // 4 Base64-Zeichen = 3 Bytes; wir dekodieren nur, was wir brauchen.
      return Buffer.from(b64.slice(0, Math.ceil((maxBytes * 4) / 3)), 'base64');
    },
    async kommentare(owner, repo, nummer) {
      const { daten } = await anfrage(`/repos/${owner}/${repo}/issues/${nummer}/comments?per_page=100`);
      return daten;
    },
    async kommentarSetzen(owner, repo, nummer, body) {
      return anfrage(`/repos/${owner}/${repo}/issues/${nummer}/comments`, { method: 'POST', body: { body } });
    },
    async kommentarAendern(owner, repo, id, body) {
      return anfrage(`/repos/${owner}/${repo}/issues/comments/${id}`, { method: 'PATCH', body: { body } });
    },
  };
}
