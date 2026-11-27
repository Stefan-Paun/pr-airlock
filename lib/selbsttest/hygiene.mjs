// Korpus-Hygiene: der Selbsttest-Korpus darf die FORM von Angriffen nachbilden, aber nie ihren Inhalt.
// Reine Funktion über Text. Sie ist bewusst streng; ein Fall, der hier anschlägt, wird umgeschrieben, nicht die Prüfung.

// Aufrufe, die Code ausführen oder Prozesse starten: im Korpus nur mit dem Platzhalter-String als Argument.
const AUSFUEHREN = /\b(eval|Function|exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/g;
const PLATZHALTER_ARG = /^\s*(['"`])platzhalter\1\s*\)/;
const VERBOTEN_WORT = /\b(?:child_process|subprocess|WScript\.Shell|Invoke-Expression|DownloadString|XMLHttpRequest)\b/;
// Reservierte Beispiel-Namen nach RFC 2606 / RFC 6761.
const ERLAUBTE_HOSTS = /^(?:localhost|(?:[\w-]+\.)*(?:example|test|invalid|localhost)|(?:[\w-]+\.)*example\.(?:com|net|org))$/i;
const URL_HOST = /\b[a-z][a-z0-9+.-]{1,15}:\/\/([^\s/'"`)<>\]\\]+)/gi;
const NACKTE_DOMAIN = /(?<![\w@-])((?:[a-z0-9-]+\.)+(?:com|net|org|io|xyz|ru|cn|tk|cc|ly|onion|pw|su|biz|vercel\.app|workers\.dev|ngrok\.io))(?![\w-])/gi;
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
const IP_ERLAUBT = [/^127\./, /^0\.0\.0\.0$/, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
// Feste Format-Kennungen, die eine Datei enthalten MUSS und die nie abgerufen werden (SVG-Namensraum, Git-LFS-Zeiger).
const FORMAT_KENNUNGEN = ['http://www.w3.org/2000/svg', 'https://git-lfs.github.com/spec/v1'];
const BASE64_LAUF = /[A-Za-z0-9+/]{64,}={0,2}/g;
const ESCAPES = /(?:\\x[0-9a-f]{2}|\\u[0-9a-f]{4}){8,}/gi;
const ZEICHENCODES = /fromCharCode\s*\(\s*\d+(?:\s*,\s*\d+){7,}/;

/** Anteil druckbarer ASCII-Zeichen (plus Tab/Zeilenumbruch) in einem Byte-Puffer. */
export function druckbar(bytes) {
  if (!bytes.length) return 0;
  let n = 0;
  for (const b of bytes) if ((b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13) n++;
  return n / bytes.length;
}

function hostOhneZusatz(roh) {
  return roh.replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
}

/**
 * Prüft einen Text aus dem Korpus. Ergebnis: Liste von Verstößen (leer = sauber).
 * `wo` landet nur in der Meldung.
 */
export function pruefeHygiene(text, wo = '') {
  const verstoesse = [];
  const melde = (was) => verstoesse.push(wo ? `${wo}: ${was}` : was);
  const t = FORMAT_KENNUNGEN.reduce((x, k) => x.split(k).join(' '), String(text));

  AUSFUEHREN.lastIndex = 0;
  let m;
  while ((m = AUSFUEHREN.exec(t))) {
    if (!PLATZHALTER_ARG.test(t.slice(m.index + m[0].length, m.index + m[0].length + 40))) {
      melde(`${m[1]}( mit anderem Argument als 'platzhalter'`);
      break;
    }
  }
  const wort = VERBOTEN_WORT.exec(t);
  if (wort) melde(`verbotenes Wort ${wort[0]}`);

  URL_HOST.lastIndex = 0;
  while ((m = URL_HOST.exec(t))) {
    const host = hostOhneZusatz(m[1]);
    if (/^[\d.]+$/.test(host)) continue; // IP-Adressen prüft der nächste Block
    if (!ERLAUBTE_HOSTS.test(host)) { melde(`Adresse außerhalb der Beispiel-Domains: ${host}`); break; }
  }
  NACKTE_DOMAIN.lastIndex = 0;
  while ((m = NACKTE_DOMAIN.exec(t))) {
    if (!ERLAUBTE_HOSTS.test(m[1])) { melde(`Domain außerhalb der Beispiel-Domains: ${m[1]}`); break; }
  }
  IPV4.lastIndex = 0;
  while ((m = IPV4.exec(t))) {
    if (m.slice(1).some((x) => Number(x) > 255)) continue;
    if (!IP_ERLAUBT.some((r) => r.test(m[0]))) { melde(`IP-Adresse außerhalb der Dokumentationsbereiche: ${m[0]}`); break; }
  }

  BASE64_LAUF.lastIndex = 0;
  while ((m = BASE64_LAUF.exec(t))) {
    const bytes = Buffer.from(m[0], 'base64');
    if (bytes.length >= 16 && druckbar(bytes) >= 0.9) { melde(`Base64-Lauf (${m[0].length} Zeichen) dekodiert zu Text`); break; }
  }
  ESCAPES.lastIndex = 0;
  if (ESCAPES.test(t)) melde('lange Kette aus \\x-/\\u-Escapes');
  if (ZEICHENCODES.test(t)) melde('fromCharCode mit einer Liste von Zeichencodes');
  return verstoesse;
}

/** Hygiene für alle Texte eines geladenen Falls. */
export function pruefeFallHygiene(fall) {
  return fall._texte.flatMap((text, i) => pruefeHygiene(text, `${fall.art}/${fall.kennung}#${i}`));
}
