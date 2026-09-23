import type { Prisma } from "@acropora/database";

/**
 * AZ EMBERI KERESO -- TOBB MEZORE EGYSZERRE, RESZLETRE IS.
 *
 * Kulon fajlban all, ugyanabbol az okbol, mint az `assetLabelWhere` es az
 * `assetCategoryWhere`: a `service-assets.repository.ts`-ben inline allva
 * ellenorizhetetlen volt Prisma-kliens nelkul, es epp az OR lista tagsaga az,
 * amit egy kesobbi atszervezes CSENDBEN elejthetne -- a lista-alapu vedelem
 * pont azt nem veszi eszre, ami kikerul belole.
 *
 * MIERT PONT EZEK A MEZOK, ES MIERT NEM `notes`/`description`: az utobbi
 * kettot senki nem irja be azzal a szandekkal, hogy azonositokent
 * visszakeresheto legyen. A lista tagjai mind AZONOSITO-jellegu mezok.
 */
export function assetSearchWhere(
  search: string | undefined,
): Prisma.AssetWhereInput {
  if (!search) return {};
  return {
    OR: [
      { assetNumber: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { manufacturer: { contains: search, mode: "insensitive" } },
      { model: { contains: search, mode: "insensitive" } },
      { serialNumber: { contains: search, mode: "insensitive" } },
      { partnerInternalCode: { contains: search, mode: "insensitive" } },
      { inventoryNumber: { contains: search, mode: "insensitive" } },
      /**
       * A TABLAZAT ELSO OSZLOPA ("MAT kod / Elektromos") IS KERESHETO.
       * Balazs kerese, 2026-09-23 (kanban 8c77cf3e), szo szerint "kapjon
       * sajat mezot" -- es EZ a mezo egesz ertelme: aki a
       * villanyszekrenynel a "30M" kodot latja, annak a keresobe irva meg
       * kell talalnia az eszkozt.
       */
      { electricalCode: { contains: search, mode: "insensitive" } },
      {
        customer: {
          displayName: { contains: search, mode: "insensitive" },
        },
      },
      {
        supplier: {
          name: { contains: search, mode: "insensitive" },
        },
      },
      /**
       * A MATRICAKOD IS KERESHETO -- ES EZ NEM UGYANAZ, MINT A `labelCode`
       * SZURO.
       *
       * MIERT KELL: Balazs ma kezdi az eszkozoket elore nyomtatott
       * matricakkal rogziteni. Ha a kodot beirja a KERESOBE, ma nulla
       * talalatot kap, holott a kod a rendszerben ott all.
       *
       * MIERT NEM VONHATO OSSZE A `labelCode` PARAMETERREL (#739): az GEPI
       * szuro, PONTOS egyezessel, a jegy eszkoz-valasztojanak. Ez EMBERI
       * kereso, ami RESZLETRE keres -- aki a matrica felet latja a cimken,
       * annak is talalnia kell. A ketto osszevonasa vagy a gepi utat tenne
       * pontatlanna, vagy ezt hasznalhatatlanna.
       *
       * A HATOKORT EZ NEM TAGITJA: az `OR` a `where` objektum EGYIK kulcsa,
       * a hatokor-feltetelek pedig a TESTVEREI -- a Prisma a testvér
       * kulcsokat ES-sel koti. Vagyis a kereso legfeljebb SZUKIT azon
       * belul, amit a nezo amugy is lathat.
       */
      {
        label: {
          code: { contains: search, mode: "insensitive" },
        },
      },
    ],
  };
}
