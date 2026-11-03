/**
 * A KÉPERNYŐKÉP-ELLENŐRZÉS ÚTJAI, A WEB SAJÁT FÁJÁBÓL (kártya 4cb013c3, T1.1): a `src/app/(shell)` alatti `page.tsx`
 * fájlokból, nem kézzel írt listából, hogy egy új oldal magától bekerüljön, és egy törölt magától kiessen. Csak a
 * statikus utak: egy `[id]` szegmenshez valódi azonosító kellene, az a második kör.
 *
 * Tiszta függvény (a fájlok relatív útjait kapja), hogy a lemez nélkül tesztelhető legyen.
 */
export function shellRoutes(pageFiles: readonly string[]): string[] {
  const routes = new Set<string>();
  for (const file of pageFiles) {
    const parts = file.replaceAll("\\", "/").split("/");
    if (parts.at(-1) !== "page.tsx") continue;
    const shellAt = parts.indexOf("(shell)");
    if (shellAt === -1) continue;
    const segments = parts.slice(shellAt + 1, -1);
    // a dinamikus szegmens valódi azonosítót kér; a route group (zárójeles mappa) nem része az útnak
    if (segments.some((segment) => segment.startsWith("["))) continue;
    const route = `/${segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`;
    routes.add(route);
  }
  return [...routes].sort();
}

/** Az út a képfájl nevében: `/penzugy/szamlazas` -> `penzugy__szamlazas` (a per-jel két aláhúzás, hogy `/a/b` és `/a_b` ne ütközzön), a kezdőlap `kezdolap`. */
export function screenFileName(route: string): string {
  const name = route
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]+/g, "-"))
    .join("__");
  return name || "kezdolap";
}
