/**
 * A KÜLSŐ FORRÁSBÓL JÖVŐ SZÖVEG SIMA SZÖVEGKÉNT (UI-áttekintés, 4. csomag, 2026-11-03). Az UNAS
 * címei ("Dunaharaszti&nbsp;;") és a publikációk címei ("&lt;i&gt;Acropora pulchra&lt;/i&gt;")
 * HTML-entitásokkal és címkékkel érkeznek, és a képernyőn nyersen látszottak. Ez a segéd az
 * entitásokat kicseréli a karakterükre, a címkéket kivágja; sima szöveget ad, a React pedig
 * szövegként írja ki (nem `innerHTML`), tehát nem nyit új beszúrási felületet.
 *
 * CSAK MEGJELENÍTÉSRE: a kimenet sima szöveg, nem biztonságos HTML. Ha valaha HTML-be (e-mail
 * sablon, `innerHTML`) kerülne, ez a segéd ott tilos: ott kimenet-kódolás kell, nem ez.
 */
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * A számos entitásból NEM lesz karakter, ha vezérlő vagy irányváltó: a C0/C1 vezérlők (a tabulátor
 * és az újsor kivételével) és a kétirányú szöveg vezérlői (U+200E-F, U+202A-E, U+2066-9). Egy külső
 * forráscím így nem fordíthatja meg a szöveg irányát a képernyőn.
 */
function isControl(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1]!.toLowerCase() === "x"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return match;
        return isControl(code) ? "" : String.fromCodePoint(code);
      }
      return NAMED[body.toLowerCase()] ?? match;
    },
  );
}

/** Entitások kicserélve, HTML-címkék kivágva, a szóközök egyesítve. Üres vagy hiányzó érték: üres szöveg. */
export function plainText(value: string | null | undefined): string {
  if (!value) return "";
  // Kétszer: az "&lt;i&gt;" először "<i>"-vé válik, azt a második kör vágja ki.
  const decoded = decodeEntities(value);
  // A sortörés és a blokk-címkék szóközt kapnak ("sor1<br>sor2" nem ragad össze), az inline
  // címkék (<i>, <b>...) üresre cserélődnek.
  const stripped = decoded
    .replace(/<\/?(?:br|p|div|li|ul|ol|tr|td|th|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}
