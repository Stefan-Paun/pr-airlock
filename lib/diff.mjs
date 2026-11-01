// Patch-Text (unified diff aus der GitHub-API) → hinzugefügte und entfernte Zeilen mit Zeilennummern.
// Reine Funktion, keine Annahmen über den Inhalt: Fremdtext wird nur zerlegt, nie ausgewertet.

export function parsePatch(patch = '') {
  const added = [];
  const removed = [];
  let neu = 0;
  let alt = 0;
  for (const roh of String(patch).split('\n')) {
    const kopf = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(roh);
    if (kopf) { alt = Number(kopf[1]); neu = Number(kopf[2]); continue; }
    if (roh.startsWith('+')) { added.push({ zeile: neu++, text: roh.slice(1) }); continue; }
    if (roh.startsWith('-')) { removed.push({ zeile: alt++, text: roh.slice(1) }); continue; }
    if (roh.startsWith('\\')) continue; // "\ No newline at end of file"
    neu++; alt++;
  }
  return { added, removed };
}

export function endung(pfad = '') {
  const m = /\.([a-z0-9]+)$/i.exec(pfad);
  return m ? m[1].toLowerCase() : '';
}

export function dateiname(pfad = '') {
  return String(pfad).split('/').pop() || '';
}

// Steuerzeichen und ESC-Sequenzen raus, damit Fremdtext weder Terminal noch Markdown kapert.
export function saeubere(text = '') {
  return String(text)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

// Dateinamen aus Git dürfen fast alles enthalten, auch Zeilenumbrüche. Für Log, Markdown und Workflow-Commands entschärfen.
export function saeuberePfad(pfad = '') {
  return saeubere(String(pfad).replace(/\r\n?|\n/g, '\u240a')).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 300);
}

export function auszug(text = '', max = 160) {
  const t = saeubere(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
