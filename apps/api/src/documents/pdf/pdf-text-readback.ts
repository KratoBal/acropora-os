import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * A KIMENETBŐL VISSZAOLVASOTT SZÖVEG -- AZ EGYETLEN, AMI A BETŰT MÉRI.
 *
 * === MIÉRT NEM A FÁJL MÉRETÉRE VAGY A BETŰ NEVÉRE ŐRZÜNK ===
 *
 * Mindkét romlás, amit ismerünk, ÉRVÉNYES PDF-et ad, nulla kilépési kóddal:
 *
 *   a beépített betű        "ő Ő" -> "P",  "ű Ű" -> "p"   (WinAnsi-ra szűkítés)
 *   hiányzó jel a készletből  bármely karakter -> U+0000
 *
 * Egyik sem látszik a méreten, egyik sem látszik a betű nevén, és egyik sem
 * dob hibát. A KÜLÖNBSÉG csak akkor jelenik meg, ha a kész PDF-ből visszaolvassuk
 * a szöveget, és BETŰRE összevetjük azzal, amit beleírtunk.
 *
 * === MIÉRT POZÍCIÓBÓL RAKJUK ÖSSZE A SOROKAT ===
 *
 * A `pdfjs` nem sorokat ad vissza, hanem szövegdarabokat, és a darabolás a
 * tartalomtól függ: MÉRVE, egy hiányzó jel KETTÉVÁGJA a sort (a
 * `"hianyzo = <hiányzó> kinai jelek"` sorból `"hianyzo"` és `"= .. kinai jelek"`
 * lett). Aki darabonként hasonlít, épp a HIBÁS esetben nem találja a sorát --
 * vagyis az őrző pont ott mondaná, hogy "nincs ilyen sor", ahol a hiba van.
 *
 * Ezért a darabokat a FÜGGŐLEGES helyük (`transform[5]`) szerint csoportosítjuk,
 * és vízszintesen rendezve fűzzük össze: ez a sor akkor is egyben marad, ha a
 * megjelenítő szétvágta.
 */

/** Egy visszaolvasott sor: a szöveg és a lap, amin áll. */
export interface PdfTextLine {
  pageNumber: number;
  text: string;
  /** PDF coordinates converted to a top-origin page box. */
  x?: number;
  top?: number;
  width?: number;
  height?: number;
}

/** Két darab akkor van egy soron, ha a függőleges helyük ennél közelebb van. */
const SAME_LINE_TOLERANCE = 1;

export async function readPdfTextLines(
  bytes: Uint8Array,
): Promise<PdfTextLine[]> {
  // A `pdfjs` a kapott puffert magához veszi; másolattal hívjuk, hogy a hívó
  // sajátja használható maradjon (a Buffer ugyanúgy Uint8Array).
  //
  // A `useSystemFonts: false` SZÁNDÉKOS, és eltér a Foxpost-elszámolás
  // olvasójától (ott `true`). Ott idegen PDF-ekből kell szöveget kinyerni, és a
  // rendszer betűi segítenek; ITT viszont azt mérjük, mit hordoz a SAJÁT
  // kimenetünk. Ha a megjelenítő a hiányzó betűt a rendszeréből pótolhatná, épp
  // azt a hibát fedné el, amiért ez a függvény létezik.
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });

  const lines: PdfTextLine[] = [];

  try {
    const doc = await loadingTask.promise;

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      const buckets: {
        y: number;
        parts: { x: number; text: string; width: number; height: number }[];
      }[] = [];

      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const bucket = buckets.find(
          (candidate) => Math.abs(candidate.y - y) <= SAME_LINE_TOLERANCE,
        );
        const width = item.width as number;
        const height = Math.abs(item.height as number);
        if (bucket) bucket.parts.push({ x, text: item.str, width, height });
        else buckets.push({ y, parts: [{ x, text: item.str, width, height }] });
      }

      // Fentről lefelé, soron belül balról jobbra: a PDF y tengelye fölfelé nő.
      buckets.sort((a, b) => b.y - a.y);
      for (const bucket of buckets) {
        bucket.parts.sort((a, b) => a.x - b.x);
        const text = bucket.parts.map((part) => part.text).join("");
        if (text.trim() === "") continue;
        const x = Math.min(...bucket.parts.map((part) => part.x));
        const right = Math.max(
          ...bucket.parts.map((part) => part.x + part.width),
        );
        const height = Math.max(...bucket.parts.map((part) => part.height));
        const top = (page.view[3] ?? 842) - bucket.y - height;
        lines.push({ pageNumber, text, x, top, width: right - x, height });
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return lines;
}

/** Egy eltérés, névvel -- hogy a bukás megmondja, MELYIK sor romlott el. */
export interface PdfTextMismatch {
  index: number;
  expected: string;
  actual: string | null;
}

/**
 * A BEMENET ÉS A VISSZAOLVASOTT SZÖVEG ÖSSZEVETÉSE, SORONKÉNT.
 *
 * Üres tömb = a lap betűre azt hordozza, amit beleírtunk. Minden más eset
 * megnevezi a sort, a várt és a kapott értékkel: egy `null` azt jelenti, hogy
 * az a sor egyáltalán nem jött vissza.
 */
export function comparePdfTextLines(
  expected: readonly string[],
  actual: readonly PdfTextLine[],
): PdfTextMismatch[] {
  const mismatches: PdfTextMismatch[] = [];

  for (const [index, line] of expected.entries()) {
    const found = actual[index];
    if (found?.text !== line) {
      mismatches.push({
        index,
        expected: line,
        actual: found?.text ?? null,
      });
    }
  }

  return mismatches;
}
