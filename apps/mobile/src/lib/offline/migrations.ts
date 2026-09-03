/**
 * A HELYI ADATBAZIS SEMA-LEPESEI, SORSZAMOZVA.
 *
 * === MIERT MOST, ES MIERT NEM EGY DROP ===
 *
 * A `sync_queue` tabla ma URES (senki nem ir bele, merve: a sajat definiciojan
 * kivul sehol nem szerepel). Egy DROP + ujra letrehozas tehat ma olcso lenne es
 * karmentes -- DE a mechanizmus hianya REJTVE MARADNA a kovetkezo
 * sema-valtozasig, es akkor egy soha ki nem probalt migracionak kellene eloszor
 * VALODI adaton, a felhasznalok telefonjan mukodnie.
 *
 * A ket tevedes ara nem egyforma: a DROP-e nema es kesobb csap le, a migracioe
 * hangos es most. Ma van egy tablank, amin a migracio hibaja NEM okoz kart --
 * ez a legjobb korulmeny egy ilyen mechanizmus bevezetesere, es holnap mar nem
 * lesz meg.
 *
 * === A VERZIO KULON NYILVANTARTAS, NEM A SEMA ALAKJABOL OLVASVA ===
 *
 * NEM azt kerdezzuk, hogy "letezik-e mar az oszlop". Az ugyanaz a csapda, mint a
 * `CREATE TABLE IF NOT EXISTS`: egyetlen lepesnel mukodik, ketto utan mar nem
 * mondja meg, hol tartunk. A verziot az SQLite sajat `user_version` pragmaja
 * tarolja, es a lepesek SORSZAM szerint futnak.
 */

export interface Migration {
  /** Sorszam, 1-tol. A lepesek EBBEN a sorrendben futnak. */
  version: number;
  /** Mit csinal -- emberi szoveg, a naploba es ide, olvasasra. */
  name: string;
  sql: string;
}

/**
 * A LEPESEK. Uj lepes CSAK a vegere kerul, novekvo sorszammal -- egy meglevo
 * lepes atirasa azokon a keszulekeken, ahol mar lefutott, SOHA nem fut ujra.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "a sync_queue sorai allapotot kapnak",
    sql: `ALTER TABLE sync_queue ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';`,
  },
  {
    version: 2,
    name: "a sync_queue allapot szerint kereshetu",
    sql: `CREATE INDEX IF NOT EXISTS sync_queue_state ON sync_queue (state);`,
  },
];

/** A legmagasabb sorszam, amire a mai kod szamit. */
export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

/**
 * MI VAN MEG HATRA EGY ADOTT VERZIOROL.
 *
 * A visszaadott lista SORREND SZERINTI es HIANYTALAN: a nulladik verziorol a
 * masodikra menve MIND A KETTO benne van. Ez a fuggveny egesz letezese ezen az
 * egy tulajdonsagon all -- egy valtozat, ami csak az UTOLSO lepest adja vissza,
 * EGY lepesnel meg helyesnek latszik, es a masodiktol kezdve csendben hagy ki
 * oszlopokat.
 */
export function pendingMigrations(
  currentVersion: number,
  steps: readonly Migration[] = MIGRATIONS,
): Migration[] {
  return steps
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
}

/**
 * A LEPESEK EPSEGE: hezagmentes, 1-tol indulo, novekvo sorszamok.
 *
 * MIERT ELLENORIZZUK EGYALTALAN: egy kihagyott sorszam (1, 3) eseten egy
 * keszulek, ami a 2-es verzion all, a 3-ast lefuttatna, es a `user_version`
 * 3-ra ugrana -- vagyis a hianyzo 2-es lepes SOHA nem futna le rajta, es a hiba
 * csak akkor latszana, amikor egy lekerdezes nem talalja az oszlopot.
 */
export function firstBrokenStep(
  steps: readonly Migration[] = MIGRATIONS,
): string | null {
  const rendezett = [...steps].sort((a, b) => a.version - b.version);
  for (const [i, m] of rendezett.entries()) {
    if (m.version !== i + 1) {
      return `A(z) ${m.version}. lépés sorszáma hibás: ${i + 1} lenne a helyes.`;
    }
  }
  return null;
}
