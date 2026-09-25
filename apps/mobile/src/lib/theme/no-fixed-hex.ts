/**
 * EGY FORRÁS HEX SZÍN LITERÁLJAI, KOMMENTEK NÉLKÜL.
 *
 * A Figma 12. kör brief-je (2026-09-25) minden átültetett képernyőhöz egy
 * állítást kér: a színek a közös `useAppTheme()`-ből jönnek, nincs fix hex
 * -- a kamera-rátétek kivételével, amik SZÁNDÉKOSAN sötétek maradnak
 * (élő kamera-kép fölé kerülnek, nem a téma része).
 *
 * A KOMMENTEKET KISZEDJÜK, UGYANAZ AZ OK, MINT A `visual-base.spec.ts`-BEN:
 * ez a fájl saját fejléce is idézhet egy régi hex-et ("korábban #071827
 * volt"), és egy nyers illesztés a DOKUMENTÁCIÓT venné leletnek.
 */
export function hexSzinLiteralok(forras: string): string[] {
  const kod = forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  return [
    ...kod.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g),
  ].map((m) => m[0]);
}
