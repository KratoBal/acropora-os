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

/**
 * Egy lapváltás hatása a nyomra.
 *
 * Három eset van, és a második az, ami nélkül a képernyő pattogna:
 * - ugyanaz a lap (újrarenderelés, szűrő, lapozás): a nyom nem változik;
 * - visszaléptünk oda, ahonnan jöttünk: a nyom RÖVIDÜL, nem hosszabbodik,
 *   különben a "vissza" gomb ide-oda dobálna a két lap között;
 * - új lap: hozzáfűzzük.
 */
export function advanceTrail(
  trail: readonly string[],
  pathname: string,
): string[] {
  const last = trail[trail.length - 1];
  if (last === pathname) return [...trail];

  const beforeLast = trail[trail.length - 2];
  if (beforeLast === pathname) return trail.slice(0, -1);

  return [...trail, pathname];
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
