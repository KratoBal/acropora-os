/**
 * Az appon belül bejárt lapok nyoma, és belőle az, hogy honnan jött a
 * felhasználó.
 *
 * A böngésző saját előzménye erre nem használható: nincs megbízható módja
 * megtudni, van-e appon belüli előzmény, és egy `history.back()` a közvetlen
 * címmel megnyitott lapról KILÉP az alkalmazásból. Ezért saját nyomot
 * vezetünk - és ha az üres, a hívó a saját tartalék céljára megy, ami ma is
 * ott van a "Vissza a listához" gombokon.
 *
 * A logika külön áll a React-rétegtől, mert ez a rész az, ami elromolhat:
 * a kétszer feljegyzett lap és a vissza-oda pattogás mind itt dől el.
 */

/** A cím útvonal-része, a query nélkül: a lapot ez azonosítja. */
function pathOf(href: string): string {
  const cut = href.indexOf("?");
  return cut === -1 ? href : href.slice(0, cut);
}

/**
 * Egy lapváltás hatása a nyomra.
 *
 * A nyom elemei TELJES CÍMEK (útvonal + query), de a lapot az útvonal
 * azonosítja. Balázs kérése (2026-09-30 12:29 UTC): egy szűrt listáról az
 * adatlapra, majd vissza, a szűrés és az oldal maradjon meg. A nyom eddig
 * csak az útvonalat tartotta, ezért a "vissza" a szűretlen listára vitt.
 *
 * Három eset van, és a második az, ami nélkül a képernyő pattogna:
 * - ugyanaz a lap (újrarenderelés, szűrő, lapozás): a nyom nem hosszabbodik,
 *   csak az utolsó elem címe frissül a legújabb queryre;
 * - visszaléptünk oda, ahonnan jöttünk: a nyom RÖVIDÜL, nem hosszabbodik,
 *   különben a "vissza" gomb ide-oda dobálna a két lap között;
 * - új lap: hozzáfűzzük.
 */
export function advanceTrail(trail: readonly string[], href: string): string[] {
  const path = pathOf(href);
  const last = trail[trail.length - 1];
  if (last !== undefined && pathOf(last) === path)
    return [...trail.slice(0, -1), href];

  const beforeLast = trail[trail.length - 2];
  if (beforeLast !== undefined && pathOf(beforeLast) === path)
    return [...trail.slice(0, -2), href];

  return [...trail, href];
}

/**
 * Ahonnan a felhasználó erre a lapra jött, ha az appon belülről jött.
 *
 * `null`, ha ez az első lap ebben a munkamenetben: közvetlen cím, könyvjelző
 * vagy újratöltés után nincs hova visszamenni, és ilyenkor a hívó tartalék
 * célja következik.
 */
export function previousPage(trail: readonly string[]): string | null {
  return trail.length >= 2 ? (trail[trail.length - 2] ?? null) : null;
}

/**
 * Egy lista legutóbbi címe a nyomból, a queryjével együtt: a lista "ahogy
 * legutóbb otthagytad". Egy morzsamenü-linknek ez való, nem az előző lap
 * (az adatlapra lehet, hogy nem a listáról jöttek). Ha a lista nincs a
 * nyomban, `null`.
 */
export function lastVisitOf(
  trail: readonly string[],
  listPath: string,
): string | null {
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const href = trail[index]!;
    if (pathOf(href) === listPath) return href;
  }
  return null;
}
