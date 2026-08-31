import type { DatasheetField } from "@acropora/database";

/**
 * A megtagadás-állapot EGYETLEN olyan hibája, amit a séma nem tud megfogni.
 *
 * A három állapot úgy áll, hogy az érték-oszlop NULL, és a megtagadást egy külön
 * sor jelenti. Ebből következik egy ellentmondó pár, amit adatbázis-szinten NEM
 * lehet kizárni: a mező KI VAN TÖLTVE, és közben ÁLL RÁ egy megtagadás-sor. A
 * `CHECK` feltétel nem hivatkozhat másik táblára, és a mező neve itt ADAT, nem
 * oszlop-hivatkozás.
 *
 * KÉT RÉTEG VÉDI, ÉS NEM UGYANAZT FEDIK LE (acrobot döntése, 2026-08-31):
 * az alkalmazás-oldali őrző MEGELŐZ, de csak a normál írást látja; ez az audit
 * nem előz meg, viszont MINDENT lát, ami a táblában áll, akárhogy került oda. És
 * épp ez kell: az első töltés a MIGRÁCIÓN át jön, tehát azon a csatornán, amit
 * az őrző nem lát.
 *
 * AMIT EZ A MODUL NEM CSINÁL, ÉS AMIT KÖNNYŰ FÉLREÉRTENI: a CI-ben lefutó
 * egység- vagy integrációs teszt azt bizonyítja, hogy a DETEKTOR MŰKÖDIK - nem
 * azt, hogy egy adatbázis tiszta. A CI adatbázisa frissen migrált és üres, tehát
 * ott az audit mindig zöld lenne, függetlenül attól, hogy jó-e. Ahhoz, hogy egy
 * VALÓDI adatbázisról mondjunk valamit, ezt a függvényt AZ ELLEN a adatbázis
 * ellen kell lefuttatni.
 */

/** Egy mezőhöz tartozó összes oszlop. Több oszlop is hordozhat egy mezőt. */
export type DatasheetColumns = readonly (keyof DatasheetValueColumns)[];

/**
 * Csak azok az oszlopok, amik ÉRTÉKET hordoznak - az `id`, a `productId` és az
 * időbélyegek nem tartoznak ide.
 */
export interface DatasheetValueColumns {
  magyarNev: string | null;
  angolNev: string | null;
  csaladTaxon: string | null;
  elohelySzoveg: string | null;
  akvariumMeretSzoveg: string | null;
  maxMeretSzoveg: string | null;
  kulleme: string | null;
  tartasa: string | null;
  viselkedese: string | null;
  ajanlottEleseg: string | null;
  erzekenyseg: string | null;
  tarsithatosag: string | null;
  erdekesseg: string | null;
  minLiter: unknown;
  literPerEgyed: unknown;
  meretKategoria: unknown;
  meretMin: unknown;
  meretMax: unknown;
  meretDimenzio: unknown;
  genus: string | null;
  species: string | null;
  kereskedelmiNev: string | null;
  careDifficulty: unknown;
  reefSafe: unknown;
  socialKeeping: unknown;
  originScope: unknown;
  feedingType: unknown[];
  aggression: unknown[];
  origin: string[];
  amitOVeszelyeztet: string | null;
  amiOtVeszelyezteti: string | null;
}

/**
 * MELYIK MEZŐT MELYIK OSZLOP(OK) HORDOZZÁK.
 *
 * `Record<DatasheetField, …>`, és ez szándékos: ha valaki új értéket vesz fel a
 * `DatasheetField` enumba, ez a fájl NEM FORDUL LE, amíg ide be nem kerül. Egy
 * hiányzó bejegyzés különben néma lenne - az audit egyszerűen nem nézné azt a
 * mezőt, és zöldet adna.
 */
export const DATASHEET_FIELD_COLUMNS: Record<DatasheetField, DatasheetColumns> =
  {
    MAGYAR_NEV: ["magyarNev"],
    ANGOL_NEV: ["angolNev"],
    CSALAD_TAXON: ["csaladTaxon"],
    ELOHELY: ["elohelySzoveg"],
    /** Négy oszlop hordozza: a két szám, a kategória és a magyarázó szöveg. */
    AKVARIUM_MERET: [
      "minLiter",
      "literPerEgyed",
      "meretKategoria",
      "akvariumMeretSzoveg",
    ],
    MAX_MERET: ["meretMin", "meretMax", "meretDimenzio", "maxMeretSzoveg"],
    KULLEME: ["kulleme"],
    TARTASA: ["tartasa"],
    VISELKEDESE: ["viselkedese"],
    AJANLOTT_ELESEG: ["ajanlottEleseg"],
    ERZEKENYSEG: ["erzekenyseg"],
    TARSITHATOSAG: ["tarsithatosag"],
    ERDEKESSEG: ["erdekesseg"],
    SCIENTIFIC_NAME: ["genus", "species", "kereskedelmiNev"],
    CARE_DIFFICULTY: ["careDifficulty"],
    REEF_SAFE: ["reefSafe"],
    FEEDING_TYPE: ["feedingType"],
    ORIGIN: ["origin"],
    ORIGIN_SCOPE: ["originScope"],
    AGGRESSION: ["aggression"],
    SOCIAL_KEEPING: ["socialKeeping"],
    AMIT_O_VESZELYEZTET: ["amitOVeszelyeztet"],
    AMI_OT_VESZELYEZTETI: ["amiOtVeszelyezteti"],
  };

/**
 * Egy oszlop ki van-e töltve.
 *
 * AZ ÜRES TÖMB NEM ÉRTÉK, és ez nem finomság: Postgres alatt a lista
 * alapértelmezése üres tömb, nem NULL. Ha az üres tömböt értéknek vennénk,
 * MINDEN adatlap minden tömb-mezője „kitöltöttnek" látszana a létrehozás
 * pillanatától, és az audit minden megtagadást ellentmondásnak jelentene.
 */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export interface RefusalConflict {
  datasheetId: string;
  mezo: DatasheetField;
  /** Melyik oszlop(ok) hordoznak értéket, holott a mező megtagadott. */
  kitoltottOszlopok: string[];
}

export interface AuditableDatasheet extends Partial<DatasheetValueColumns> {
  id: string;
  refusals: { mezo: DatasheetField }[];
}

/**
 * Minden ellentmondó pár: megtagadott mező, aminek MÉGIS van értéke.
 *
 * Tiszta függvény, adatbázis nélkül mérhető - a hívó adja az adatot. Így a
 * szabály akkor is tesztelhető, amikor nincs adatbázis, és a hívás helye
 * (parancssor, integrációs teszt, ütemezett audit) nem befolyásolja.
 */
export function findRefusalConflicts(
  datasheets: readonly AuditableDatasheet[],
): RefusalConflict[] {
  const conflicts: RefusalConflict[] = [];

  for (const sheet of datasheets)
    for (const refusal of sheet.refusals) {
      const columns = DATASHEET_FIELD_COLUMNS[refusal.mezo];
      /**
       * HANGOSAN, nem csendben. Ha egy mező nincs a térképen, az audit NEM
       * hagyhatja ki: pont az a mező maradna őrizetlen, amiről senki nem tud.
       */
      if (!columns)
        throw new Error(
          `A ${refusal.mezo} mező nincs a DATASHEET_FIELD_COLUMNS térképen, ` +
            `ezért az audit nem tudja megnézni. Vedd fel, ne hagyd ki.`,
        );
      const values = sheet as unknown as Record<string, unknown>;
      const filled = columns.filter((column) => hasValue(values[column]));
      if (filled.length)
        conflicts.push({
          datasheetId: sheet.id,
          mezo: refusal.mezo,
          kitoltottOszlopok: [...filled],
        });
    }

  return conflicts;
}

/** Ember számára olvasható jelentés, a parancssornak és a CI kimenetének. */
export function describeRefusalConflicts(
  conflicts: readonly RefusalConflict[],
): string {
  if (!conflicts.length)
    return "Nincs ellentmondó pár: minden megtagadott mező üres.";

  return [
    `${conflicts.length} ellentmondó pár: a mező MEGTAGADOTT, mégis van értéke.`,
    ...conflicts.map(
      (conflict) =>
        `  ${conflict.datasheetId} / ${conflict.mezo}: ` +
        `${conflict.kitoltottOszlopok.join(", ")}`,
    ),
  ].join("\n");
}
