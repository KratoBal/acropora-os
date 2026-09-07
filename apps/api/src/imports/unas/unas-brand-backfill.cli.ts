import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { BrandsRepository } from "../../brands/brands.repository.js";
import {
  brandValueFromParameters,
  describeBrandBackfillPlan,
  planBrandBackfill,
  type BrandBackfillPlan,
  type BrandBackfillRow,
  type ExistingBrand,
} from "./unas-brand-backfill.js";

/**
 * MARKA A TAROLT PILLANATKEPBOL A TERMEKRE, VISSZAMENOLEG -- EGYSZER FUTO PARANCS.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api unas:brand-backfill            # TERV, iras nelkul
 *   pnpm --filter @acropora/api unas:brand-backfill --apply    # a tenyleges iras
 *
 * === AZ ALAPERTELMEZES A TERV, ES EZ NEM KENYELMI DONTES ===
 *
 * Ugyanaz az indok, mint a kategoria- es marka-parancsnal: egy `--apply` nelkuli
 * futas utan CSAK TUDAS marad; utana viszont marka-rekordok allnak az
 * adatbazisban es 683 termeken egy mezo. A ketto nem ugyanaz a muvelet, tehat
 * nem szabad, hogy ugyanaz a parancs legyen.
 *
 * A vetitesnel ma pont az hianyzik, hogy nincs proba-alakja. Ne ismereljuk meg.
 *
 * === MIERT NEM A BrandImportAssistantService ===
 *
 * Az a szolgaltatas KOTEGHEZ van kotve: `batchId`, sor-azonosito,
 * `expectedUpdatedAt`, es a sor `classification` erteke `MISSING_BRAND` kell
 * legyen. A mi 683 termekunk API-SZINKRONON jott be, ahol nincs koteg es nincs
 * atnezes-sor -- azokat eloszor gyartani kellene, ami epp a C) ut.
 *
 * Ezert a KOTEG NELKULI, mar letezo utat hasznalja: `BrandsRepository.create`.
 * Ez nem uj marka-letrehozo kod, hanem a masik meglevo.
 */

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/**
 * A MENET KOZBEN SZAMOLT EREDMENY -- A HIVO BIRTOKOLJA, A VEGREHAJTO TOLTI.
 *
 * === MIERT NEM VISSZATERESI ERTEK ===
 *
 * Egy visszateresi ertek CSAK a sikeres futasrol tud beszelni. Ha az iras a
 * harmadik markanal dob, a ket szam a vegrehajto belsejeben marad, es a hivo
 * annyit lat, hogy "hiba tortent" -- azt nem, hogy MENNYI keszult el.
 *
 * === ES MIERT NEM MINDKETTO ===
 *
 * A kezenfekvo alak az lett volna, hogy a vegrehajto TOLTI ezt az objektumot
 * ES vissza is adja a szamokat. Az ket forras ugyanarra az egy tenyre, ami
 * elterhet -- es a siker-ag olvasna a visszateresi erteket, a bukas-ag ezt.
 * Egy dupla, ami az objektumot nem tolti ki, a bukas-agon HALLGATNA, a
 * siker-agon meg helyesen szamolna: pont az a fajta nema hiba, amit ez a
 * kartya be akar zarni.
 *
 * Ezert MIND A KET ag ebbol az egy objektumbol ir. Ha egy dupla nem tolti ki,
 * a MAR MEGLEVO siker-teszt is pirosra megy -- vagyis a hiba hangos lesz.
 */
export interface BackfillProgress {
  created: number;
  assigned: number;
}

/** A pillanatkeppel rendelkezo termekek, a nyers marka-ertekkel. */
export async function backfillRows(): Promise<BrandBackfillRow[]> {
  const termekek = await prisma.product.findMany({
    where: { unasSnapshot: { isNot: null } },
    select: {
      id: true,
      brandId: true,
      unasSnapshot: { select: { parameters: true } },
    },
  });

  const sorok: BrandBackfillRow[] = [];
  for (const termek of termekek) {
    const brandValue = brandValueFromParameters(
      termek.unasSnapshot?.parameters,
    );
    if (!brandValue) continue;
    sorok.push({
      productId: termek.id,
      brandValue,
      currentBrandId: termek.brandId,
    });
  }
  return sorok;
}

/** A MA letezo markak, a parositashoz szukseges ket mezovel. */
export async function existingBrands(): Promise<ExistingBrand[]> {
  const markak = await prisma.brand.findMany({
    where: { isActive: true },
    select: {
      id: true,
      normalizedName: true,
      aliases: { select: { normalizedAlias: true } },
    },
  });
  return markak.map((marka) => ({
    id: marka.id,
    normalizedName: marka.normalizedName,
    normalizedAliases: marka.aliases.map((alias) => alias.normalizedAlias),
  }));
}

export async function runBrandBackfillCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    rows(): Promise<BrandBackfillRow[]>;
    brands(): Promise<ExistingBrand[]>;
    actorExists(actorId: string): Promise<boolean>;
    apply(
      plan: BrandBackfillPlan,
      actorId: string,
      progress: BackfillProgress,
    ): Promise<void>;
  },
): Promise<number> {
  const apply = argv.includes("--apply");
  const actorIndex = argv.indexOf("--actor");
  const actorId =
    actorIndex >= 0 && actorIndex + 1 < argv.length
      ? argv[actorIndex + 1]!
      : null;

  const plan = planBrandBackfill(await deps.rows(), await deps.brands());

  out.stdout(describeBrandBackfillPlan(plan));

  if (!apply) {
    out.stdout("\nEz a futás semmit nem írt. A végrehajtáshoz: --apply\n");
    return 0;
  }

  /**
   * A SZEREPLO KOTELEZO AZ IRASHOZ, ES LETEZNIE KELL -- MIELOTT BARMI TORTENIK.
   *
   * === A MERT HIBA ===
   *
   * Az elso valtozat a `"unas-backfill"` SZOVEGET adta at a tarolonak
   * `actorId` gyanant. Az az ertek a `DomainEvent.actorUserId` oszlopba megy,
   * aminek IDEGEN KULCSA van a `User` tablara -- ilyen azonositoju felhasznalo
   * pedig nincs. A teszt gepen az iras az ELSO markanal elhasalt (P2003); a
   * visszagorgetes rendben volt, de a futas semmit nem vegzett el.
   *
   * === MIERT A HIVO ADJA AT, ES MIERT NEM NULLAZHATOVA TESSZUK A MEZOT ===
   *
   * A mezo nullazhatova tetele lenne a legolcsobb, es epp azt venne el, ami egy
   * 683 soros irasnal a legfontosabb: hogy KI inditotta. Az a veszteseg NEMA es
   * TARTOS, mert a `brands.repository.ts` KOZOS tipusa szelesedne -- onnantol
   * minden jovobeli hivo is atadhatna nullat, csendben.
   *
   * Egy nevesitett rendszer-felhasznalo letrehozasa viszont uj rekord az ELES
   * adatbazisban is, tehat maga is engedelykoteles: egy javitas, ami uj
   * engedelyt igenyel, nem javitas.
   *
   * Marad a hivo: egy VALODI felhasznalo felel a 683 sorert, a hiba HANGOS, es
   * a kozos tipusokhoz nem kell nyulni.
   *
   * === ES AZ ELLENORZES ELOL ALL, NEM AZ ELSO IRASNAL ===
   *
   * Egy nem letezo azonosito ugyanugy elhasalna, mint a szoveges ertek -- csak
   * epp az elso marka letrehozasakor, felbehagyott futassal. A legolcsobb
   * ellenorzes ezert elore kerul: a bukas ELOTT legyen, ne KOZBEN.
   */
  if (!actorId) {
    out.stderr(
      "Az íráshoz meg kell nevezni, KI indítja: --actor <felhasználó azonosítója>. " +
        "Az írás naplóba kerül, és a naplónak van felelőse.\n",
    );
    return 1;
  }
  if (!(await deps.actorExists(actorId))) {
    out.stderr(
      `Nincs ilyen felhasználó: ${actorId}. Az írás EL SEM INDULT. ` +
        "A napló idegen kulcsa a User táblára mutat, tehát egy nem létező " +
        "azonosító az első márkánál hasalna el, félbehagyott futással.\n",
    );
    return 1;
  }

  /**
   * A SZAMOK A BUKAS UTAN IS KIMENNEK, ES A HIBA MEGIS TOVABB MEGY.
   *
   * === A MERT LELET ===
   *
   * Az elso valtozatban a ket zaro sor az `await deps.apply(...)` UTAN allt,
   * `try` sehol. Ha az iras kozben dobott, a hivo egy stack trace-t kapott, a
   * ket szamot nem -- pedig epp azok mondjak meg, hol tart a felbehagyott
   * futas.
   *
   * === AMIT EZ VISSZAAD, ES AMIT NEM ===
   *
   * KENYELMET ad vissza, nem bizonyitekot: az allapot a bukas utan is
   * lekerdezheto (`count(*) WHERE "brandId" IS NOT NULL`). Ezert nem is
   * blokkolo javitas. A kulonbseg azert all itt, mert "a bizonyitek elveszik"
   * alakban tovabbadva surgossegnek latszana, es nem az.
   *
   * === ES A HIBA TOVABB DOBODIK ===
   *
   * Egy felig lefutott iras NEM sikeres futas. Ha itt elnyelnenk, a parancs
   * nulla kilepesi koddal allna meg, es a hivo -- ember vagy szkript -- kesz
   * munkanak olvasna. Az ujradobas a stack trace-t is megtartja: az mondja
   * meg, MIERT allt meg, a ket szam pedig, HOL.
   */
  const progress: BackfillProgress = { created: 0, assigned: 0 };
  try {
    await deps.apply(plan, actorId, progress);
  } catch (hiba) {
    out.stderr(
      `\nA futás FÉLBEHAGYVA: az írás közben hiba történt.\n` +
        `Eddig létrehozott márka-rekord: ${progress.created}\n` +
        `Eddig márkát kapott termék: ${progress.assigned}\n` +
        "Az állapot helyrehozható: az újrafuttatás kihagyja azokat a sorokat, " +
        "amiken már áll márka.\n",
    );
    throw hiba;
  }

  out.stdout(
    `\nLétrehozott márka-rekord: ${progress.created}\n` +
      `Termék, amire márka került: ${progress.assigned}\n`,
  );
  return 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runBrandBackfillCli`. */
async function applyPlan(
  plan: BrandBackfillPlan,
  actorId: string,
  progress: BackfillProgress,
): Promise<void> {
  const repository = new BrandsRepository();

  /**
   * ELOSZOR A REKORDOK, AZTAN A HOZZARENDELES, es a sorrend kotott: a
   * hozzarendeles a most szuletett azonositokat hasznalja. Forditva a masodik
   * lepes egy meg nem letezo markara mutatna.
   */
  const ujAzonositok = new Map<string, string>();
  for (const marka of plan.createBrands) {
    /**
     * AZ `aliases` URES TOMBKENT MEGY: a DTO kotelezo mezoje, es a
     * `BrandsRepository.create` epp ezt olvassa. Egy `undefined` itt csendben
     * mas agra vinne a letrehozast.
     */
    const brand = await repository.create(
      { name: marka.name, aliases: [] },
      actorId,
    );
    progress.created += 1;
    ujAzonositok.set(marka.name, brand.id);
  }

  const frissBrands = await existingBrands();
  const ujraTervezve = planBrandBackfill(await backfillRows(), frissBrands);

  for (const tetel of ujraTervezve.assign) {
    await prisma.product.update({
      where: { id: tetel.productId },
      data: { brandId: tetel.brandId },
    });
    progress.assigned += 1;
  }
}

async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runBrandBackfillCli(process.argv.slice(2), out, {
    rows: backfillRows,
    brands: existingBrands,
    actorExists: async (actorId: string) =>
      (await prisma.user.count({ where: { id: actorId } })) === 1,
    apply: applyPlan,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
