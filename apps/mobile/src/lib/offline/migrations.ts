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
  {
    version: 3,
    /**
     * MIKOR PROBALTUK UTOLJARA -- A VARAKOZTATAS EGYETLEN LEHETSEGES ALAPJA.
     *
     * A kiuritest nem idozito inditja, hanem esemeny (app-indulas, halozat
     * visszaterese). Egy "varj harminc masodpercet" szabaly tehat nem tud
     * varakozni: nincs, ami kesobb visszajon. Amit MEG LEHET tenni, az az,
     * hogy a KOVETKEZO alkalommal atugorjuk a sort, ha az elozo kiserlet ota
     * meg nem telt el eleg ido.
     *
     * Ehhez kell ez az oszlop: az `attempt_count` megmondja, HANYSZOR, de nem
     * azt, hogy MIKOR.
     *
     * SORSZAMOZOTT LEPESKENT, nem `CREATE TABLE IF NOT EXISTS` alakban: a
     * tabla mar letezik minden keszuleken, es az `IF NOT EXISTS` egy MEGLEVO
     * tablat nem modosit.
     */
    name: "a sync_queue sorai megjegyzik az utolso kiserlet idejet",
    sql: `ALTER TABLE sync_queue ADD COLUMN last_attempt_at TEXT;`,
  },
  {
    version: 4,
    /**
     * A HIBAJEGYEK MENTETT MASOLATA -- CSAK OLVASASRA.
     *
     * Ket tabla, ugyanabban az alakban, mint az eszkoze: a LISTASOR minden
     * lehuzott jegyrol megvan, a TELJES lap csak arrol, amit valaki megnyitott
     * tererovel. A ketto kulon all, mert a lista sokrol tud keveset, a lap
     * egyrol sokat -- egy tablaba gyurva minden lista-frissites eldobna a
     * reszleteket.
     *
     * AMI IDE NEM KERUL: sor a LEPTETESHEZ. A szerver a LATOTT allapotra ir
     * feltetelesen, tehat egy sorba tett lepes a kiuriteskor bukna el, orakkal
     * kesobb, amikor a szerelo mar nincs a gepnel. Amig ehhez nincs feloldo
     * keperno (az eszkoznek van), a jegy offline CSAK OLVASHATO -- es ezt a
     * sav ki is mondja.
     */
    name: "a hibajegyek mentett masolata",
    sql: `
      CREATE TABLE IF NOT EXISTS cached_service_jobs (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_service_job_details (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    /**
     * EGY SOR MEGVARHAT EGY MASIKAT -- ES EZ MA CSAK A KEPEKRE IGAZ, KEZZEL.
     *
     * A kep ma a rogzitesere var, de a szabaly a MUVELET TIPUSAHOZ van kotve
     * (`upload-photo` var `create`-re), es a varas tenye a payloadban all
     * (`recordingOperationId`). Egy harmadik szint -- munkalap a JEGY alatt,
     * ahol MIND A KETTO `create` -- ebbe nem fer bele: a `nextBatch` ma minden
     * `create` sort EGYUTT enged el, sorrend es fuggoseg nelkul.
     *
     * KET OSZLOP, NEM EGY. Az elso azt mondja meg, MIRE var; a masodik azt,
     * HOVA kerul a szulo szerver-azonositoja, amikor megjon:
     *
     *     `entityId`        -- a sor sajat cel-mezojebe (ma a kepek igy)
     *     barmi mas         -- a payload EZEN a kulcsan (a jovo jegy-lanca)
     *
     * MIERT NEM UL RA AZ `entity_id` OSZLOPRA: az MUVELETENKENT MAST JELENT --
     * a `worksheet-line` soron a SZULO azonositoja (indulaskor kitoltve), a
     * kepen a CEL azonositoja (utolag irja be a nyugtazas). Egy harmadik
     * jelentes ugyanoda csendben osszecsusztatna oket.
     *
     * A REGI SOROKON MIND A KETTO `NULL` MARAD, es ezt a `nextBatch` NEM veheti
     * "nincs fuggoseg"-nek: a keszuleken MAR sorban allo kepek a rogzitesuk
     * ELOTT indulnanak el. A kod ezert a payloadbol olvas vissza, amig ilyen
     * sor letezhet -- nevesitve, nem csendben.
     */
    name: "egy sorban allo muvelet megvarhat egy masikat",
    sql: `
      ALTER TABLE sync_queue ADD COLUMN depends_on_operation_id TEXT;
      ALTER TABLE sync_queue ADD COLUMN depends_on_target TEXT;
    `,
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
