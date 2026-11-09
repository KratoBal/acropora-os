/**
 * A CÉL-ADATBÁZIS, JELSZÓ NÉLKÜL (barracuda, #2185 review): a stage-próba és az éles futás ugyanaz a parancs, csak más `.env`-vel, és
 * a lenyomat nem árulja el a célt. Minden kimenet első sora ezt mondja ki.
 */
export function describeTarget(databaseUrl: string | undefined): string {
  if (!databaseUrl) return "ismeretlen (nincs DATABASE_URL)";
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "ismeretlen (a DATABASE_URL nem értelmezhető)";
  }
}
