/**
 * MELYIK TERMEKET KELL UJRA VETITENI: A JEL, ES AMIT NEM LAT.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO, ugyanabbol az okbol, amiert a
 * kategoria-, a marka- es a vonalkod-szabaly is kulon all: a parancssori felulet
 * torzse a `prisma`-t MODUL-SZINTU importbol veszi, tehat ami ott lakik, azt
 * csak eles adatbazissal lehetne megnezni.
 *
 * A VALASZTOTT JEL: A RELACIOKAT IS FIGYELO IDOBELYEG.
 *
 * Merve a semaban (2026-09-04, modell-hatarok szerint olvasva, nem nevre
 * keresve): a vetites bemenete HET relaciobol jon, es a `Product` sor akkor sem
 * mozdul, ha azok valtoznak. Ezert a jel nem a `Product.updatedAt`, hanem a
 * bemeneti tablak legkesobbi idobelyege:
 *
 *   Product.updatedAt
 *   ProductVariant.updatedAt        (kulon tabla, sajat updatedAt)
 *   ChannelListing.updatedAt        (kulon tabla, sajat updatedAt)
 *   UnasProductSnapshot.updatedAt   (kulon tabla, sajat updatedAt)
 *
 * ES A HALMAZ-VISZONY, AMI A VALASZTAST INDOKOLJA: ez a jel SZUKSEGKEPPEN
 * tartalmazza a puszta `Product.updatedAt` alapu halmazt, mert annak az
 * idobelyege az egyik tag a maximumban. A bovebb halmazt valasztottuk, mert a
 * ket teves irany ara nem egyforma: egy folosleges vetites ugyanazt az adatot
 * kuldi ki megegyszer, egy kimaradt viszont regi adatot hagy a boltban, es
 * SEMMI nem szol rola.
 *
 * AMIT EZ A JEL NEM LAT -- HAROM DOLOG, ES MINDHAROM MERT:
 *
 *   1. A KOD VALTOZASAT. Amikor a UNAS kliens kinyerese vagy a vetites
 *      lekepezese bovul, EGYETLEN adatbazis-sor sem valtozik, megis minden
 *      termek kimenete mas lesz. Erre nem idobelyeg kell, hanem egy teljes kor
 *      -- azt a #508 kapcsoloja teszi lehetove. A ket tetel nem alternativa:
 *      ez a jel a NAPI valtozast kezeli, a kapcsolo a SAJAT munkank hatasat.
 *   2. A KATEGORIA-HOZZARENDELES ES A KEP-LISTA valtozasat. A `ProductCategory`
 *      es a `ProductImage` tablan NINCS `updatedAt` (merve), tehat ott nincs mit
 *      osszehasonlitani. A kategoria-valtas ugyan a `Product.updatedAt` mezot is
 *      mozditja, ha a `categoryId` mezon at tortenik, de a kapcsolo-tablan
 *      keresztuli hozzaadas nem.
 *   3. A BOLT OLDALAN TORTENT VALTOZAST. Ha valaki a Medusaban ir at egy mezot,
 *      a mi idobelyegeink nem mozdulnak. Ezt csak visszaolvasas mutatna meg, es
 *      az mas feladat.
 */

/** A vetites bemeneti tablaibol vett legkesobbi idobelyeg egy termekre. */
export interface ProjectionDueInput {
  /** Mikor vetitettuk utoljara sikeresen. `null`, ha soha. */
  lastProjectedAt: Date | null;
  /** A bemeneti tablak idobelyegei. Ures elem megengedett: `null` kimarad. */
  sourceTimestamps: readonly (Date | null | undefined)[];
}

export type ProjectionDueReason =
  "NEVER_PROJECTED" | "SOURCE_CHANGED" | "UP_TO_DATE";

export interface ProjectionDueDecision {
  due: boolean;
  reason: ProjectionDueReason;
  /** A legkesobbi forras-idobelyeg, vagy `null`, ha egy sincs. */
  latestSourceChange: Date | null;
}

/**
 * A HAROM KIMENET, ES MIERT NEM KETTO.
 *
 * A `NEVER_PROJECTED` es a `SOURCE_CHANGED` a keres torzsere nezve ugyanaz
 * (mindketto vetitest ker), a JELENTESBEN viszont ellentetes: az elso azt
 * mondja, hogy a termek meg sosem jutott ki a boltba, a masodik azt, hogy kint
 * van, de elavult. Egy kozos "due" jelzes elrejtene, melyik esetbol hany van --
 * es epp az a szam mondana meg, hogy egy elso feltoltest latunk-e vagy napi
 * karbantartast.
 */
export function decideProjectionDue(
  input: ProjectionDueInput,
): ProjectionDueDecision {
  const latest = input.sourceTimestamps.reduce<Date | null>(
    (legkesobbi, jelolt) =>
      jelolt && (!legkesobbi || jelolt > legkesobbi) ? jelolt : legkesobbi,
    null,
  );
  if (!input.lastProjectedAt)
    return {
      due: true,
      reason: "NEVER_PROJECTED",
      latestSourceChange: latest,
    };
  if (latest && latest > input.lastProjectedAt)
    return { due: true, reason: "SOURCE_CHANGED", latestSourceChange: latest };
  return { due: false, reason: "UP_TO_DATE", latestSourceChange: latest };
}
