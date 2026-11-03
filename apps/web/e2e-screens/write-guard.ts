import type { BrowserContext } from "@playwright/test";

/*
  A LAPNÉZÉS NEM ÍRHAT (barracuda, #2091): a képernyőkép-ellenőrzés egy bejelentkezett fiókkal nyit meg minden lapot, és a
  lapok kliensoldali kódja lefut. Ha egy lap betöltéskor nem olvasó kérést küld (vázlat létrehozása, olvasottnak jelölés,
  szinkron indítása), az a stage-en, és egy rosszul címzett futásnál bárhol, valódi írás lenne. Ezért a böngésző-kontextus
  minden GET és HEAD kéréstől eltérőt megszakít, mielőtt elhagyná a böngészőt, és a megszakítottat feljegyzi: melyik lap
  próbált írni, az önmagában lelet. Kivétel nincs (a belépés a login.setup.pw.ts-ben, e szűrő NÉLKÜL fut; a munkamenet
  ellenőrzése, a `GET /auth/me`, olvasás). A service worker kérései megkerülnék a szűrőt: a konfiguráció tiltja őket.
*/
export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export interface BlockedRequest {
  method: string;
  url: string;
}

/** A kontextus összes lapjára szól; a visszaadott lista a megszakított kéréseket gyűjti, sorrendben. */
export async function blockWrites(
  context: BrowserContext,
): Promise<BlockedRequest[]> {
  const blocked: BlockedRequest[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (READ_METHODS.has(request.method())) return route.continue();
    blocked.push({ method: request.method(), url: request.url() });
    return route.abort("blockedbyclient");
  });
  return blocked;
}

/** Az összesítő cellája: `POST staging.acropora.hu/api/x; PATCH ...`, üresen `-`. A cím a lekérdezés nélkül (abban azonosító lehet). */
export function blockedCell(blocked: readonly BlockedRequest[]): string {
  if (!blocked.length) return "-";
  return blocked
    .map(
      ({ method, url }) =>
        `${method} ${new URL(url).host}${new URL(url).pathname}`,
    )
    .join("; ");
}
