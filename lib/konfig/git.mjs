// Lokal: .schleuse.json vom Merge-Base lesen, nie aus dem Arbeitsstand. Kein Shell, Argumente als Liste.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KONFIG_DATEI } from './aenderung.mjs';

const exec = promisify(execFile);

export async function konfigAusMergeBase(ref, { cwd = process.cwd(), git = (args) => exec('git', args, { cwd, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'buffer' }) } = {}) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./@^~-]{0,200}$/.test(ref || '') || ref.includes('..')) throw new Error(`Ungültige Referenz für --base: ${String(ref).slice(0, 60)}`);
  let basis;
  try { basis = (await git(['merge-base', 'HEAD', ref])).stdout.toString().trim(); } catch { throw new Error(`Kein Merge-Base zwischen HEAD und ${ref} gefunden`); }
  if (!/^[0-9a-f]{40,64}$/.test(basis)) throw new Error('Merge-Base nicht lesbar');
  try { await git(['cat-file', '-e', `${basis}:${KONFIG_DATEI}`]); } catch { return { basis, text: null }; }
  const { stdout } = await git(['show', `${basis}:${KONFIG_DATEI}`]);
  return { basis, text: Buffer.from(stdout) };
}
