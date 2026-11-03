/**
 * A KÜLSŐ FORRÁSBÓL JÖVŐ SZÖVEG SIMA SZÖVEGKÉNT (UI-áttekintés, 4. csomag, 2026-11-03). Az UNAS
 * címei ("Dunaharaszti&nbsp;;") és a publikációk címei ("&lt;i&gt;Acropora pulchra&lt;/i&gt;")
 * HTML-entitásokkal és címkékkel érkeznek, és a képernyőn nyersen látszottak. Ez a segéd az
 * entitásokat kicseréli a karakterükre, a címkéket kivágja; sima szöveget ad, a React pedig
 * szövegként írja ki (nem `innerHTML`), tehát nem nyit új beszúrási felületet.
 */
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1]!.toLowerCase() === "x"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
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
  const stripped = decoded.replace(/<\/?[a-z][^>]*>/gi, "");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}
