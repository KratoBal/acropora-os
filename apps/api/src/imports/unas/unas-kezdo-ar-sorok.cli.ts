import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import { kezdoSorIdopontja } from "./unas-ar-tortenet.js";

/**
 * A KEZDO AR-SOROK FELVETELE -- EGYSZER, MINDEN TERMEKRE.
 *
 * === MIERT KELL, HOLOTT A SZINKRON IS IR ===
 *
 * A szinkron csak azokat a termekeket erinti, amik atmennek rajta, es a
 * VALTOZASHOZ koti a sort. Egy termek, aminek az ara harminc napig nem mozdul,
 * igy SOHA nem kapna sort -- es epp az a leggyakoribb eset. Az Omnibus-kerdes
 * ("mi volt a legalacsonyabb az elmult 30 napban") pontosan ott nem lenne
 * megvalaszolhato.
 *
 * Ezert minden terméknek kell egy KEZDO sor, es azt ez a parancs adja meg.
 *
 * === AMIT NEM CSINAL ===
 *
 * Nem ir felul es nem torol semmit: kizarolag azoknak a termekeknek ad sort,
 * amiknek MEG EGY sem all. Tobbszor lefuttatva a masodik futas nulla sort ir --
 * es ezt ki is mondja, mert egy "0 sor" onmagaban ketfelet jelenthetne.
 *
 * === AZ IDOPONT, AMIT A KEZDO SOR VISEL ===
 *
 * A dontest a `kezdoSorIdopontja` hozza, es az INDOKA ott all: a tukor-sor
 * `updatedAt` erteke, ha van, kulonben a futas ideje.
 *
 * ITT KORABBAN `syncedAt` ALLT, ES AZ A MEZO NEM LETEZIK. A parancs ezert soha
 * nem futott le (`Unknown field \`syncedAt\``), es a kezdo sorok felvetele el
 * sem kezdodott. A tipusellenorzes NEM fogta meg -- a `select` blokk ismeretlen
 * kulcsait a Prisma tipusai nem utasitjak el --, es egy forras-szovegre mero
 * allitas meg ROGZITETTE is a hibas nevet. Mind a kettore orzo all ma
 * (`unas-ar-tortenet.spec.ts`).
 *
 * KILEPESI KODOK
 *   0  lefutott (akar nulla uj sorral)
 *   1  a futas hibara futott
 */
export interface CliOutput {
  stdout: (t: string) => void;
  stderr: (t: string) => void;
}

/** Egy termek, ahogy a parancs latja: az azonosito es a tukor ar-kepe. */
export interface KezdoSorJelolt {
  id: string;
  unasSnapshot: {
    currency: string | null;
    netPrice: Prisma.Decimal | null;
    grossPrice: Prisma.Decimal | null;
    saleNetPrice: Prisma.Decimal | null;
    saleGrossPrice: Prisma.Decimal | null;
    updatedAt: Date;
  } | null;
}

export interface KezdoSorDeps {
  /** A sor nelkuli termekek, EGY pillanatban. */
  jeloltek(): Promise<KezdoSorJelolt[]>;
  /**
   * VAN-E MAR SORA -- KOZVETLENUL AZ IRAS ELOTT, TERMEKENKENT.
   *
   * A `jeloltek()` PILLANATKEPET vesz. Az eles szinkron tizenot percenkent ir,
   * es egy nagy futas percekig tart: ha kozben sor keletkezik, a parancs
   * INITIAL-t tenne egy MAR TORTENETTEL BIRO termekre.
   *
   * A HATARA KIMONDVA: ez SZUKITI az ablakot a teljes futasrol egy termekere,
   * NEM ZARJA BE. Teljes kizarashoz reszleges egyedi index kell a semaban
   * (`WHERE source = 'INITIAL'`), az viszont migracio es kulon dontes.
   */
  vanMarSora(productId: string): Promise<boolean>;
  /** A tenyleges iras. CSAK `--apply` mellett hivodik. */
  ir(sor: {
    productId: string;
    currency: string | null;
    netPrice: Prisma.Decimal | null;
    grossPrice: Prisma.Decimal | null;
    saleNetPrice: Prisma.Decimal | null;
    saleGrossPrice: Prisma.Decimal | null;
    source: "INITIAL";
    observedAt: Date;
  }): Promise<void>;
}

export async function runKezdoArSorokCli(
  argv: readonly string[],
  out: CliOutput,
  deps: KezdoSorDeps,
): Promise<number> {
  /**
   * TERV ALAPBOL, IRAS CSAK KERESRE -- a repo bevett alakja (lasd a marka- es
   * a kategoria-parancsot).
   *
   * ES ITT KULONOSEN INDOKOLT: ez a parancs ELES ar-tortenetbe ir, egy olyan
   * tabla melle, ahova tizenot percenkent egy szinkron is ir. Egy elso futas,
   * amit nem lehet elotte megnezni, olyan allitast tenne veglegesse, amit
   * senki nem olvasott el.
   */
  const apply = argv.includes("--apply");
  try {
    const termekek = await deps.jeloltek();

    const most = new Date();
    let irt = 0;
    let tukorNelkul = 0;
    /**
     * HANY KEZDO SOR ALL URES ARRAL -- SZAMKENT, ES NEM MEGJEGYZESKENT.
     *
     * Egy ures aru sor azt allitja, hogy AKKOR nem ismertunk arat -- nem azt,
     * hogy ingyen volt. Ha ez a szam nagy, akkor a tortenet ELSO PONTJA nem
     * kiindulas, hanem hianyjelzes: az Omnibus-ablak elso napjan nincs mihez
     * merni.
     *
     * Ezt MOST kell tudni, nem harminc nap mulva, amikor visszanezunk rá.
     * (acrobot kerese, 2026-09-10.)
     */
    let uresArral = 0;
    /**
     * HANY TERMEK KAPOTT SORT A LEKERDEZES OTA -- vagyis hanyszor fogott meg
     * valamit az iras elotti ujraellenorzes. Nulla a varhato ertek; ha nem az,
     * akkor a futas alatt irt valaki mas, es EZ a szam mondja meg, hany sort
     * NEM irtunk fole.
     */
    let kozbenKapott = 0;

    for (const termek of termekek) {
      const tukor = termek.unasSnapshot;
      if (!tukor) tukorNelkul += 1;

      /*
        AZ URESSEG A NEGY AR-MEZORE SZOL, NEM A TUKOR MEGLETERE.

        A ketto NEM ugyanaz, es ezert ket kulon szamlalo: egy termeknek lehet
        UNAS-tukre ar NELKUL is (a tukor sor all, az ar-mezoi `null`-ok). Egy
        kozos szam a ket esetet osszemosna, es epp a rosszabbat rejtene el.
      */
      const nincsAr =
        tukor?.netPrice == null &&
        tukor?.grossPrice == null &&
        tukor?.saleNetPrice == null &&
        tukor?.saleGrossPrice == null;
      if (nincsAr) uresArral += 1;

      /*
        AZ UJRAELLENORZES A TERV-FUTASBAN IS LEFUT, es ez szandekos: a terv
        szama kulonben TOBBET igerne, mint amennyit egy kesobbi `--apply`
        tenyleg irna, es a ketto kozotti elteres ugy nezne ki, mint hiba.
      */
      if (await deps.vanMarSora(termek.id)) {
        kozbenKapott += 1;
        continue;
      }

      if (apply) {
        await deps.ir({
          productId: termek.id,
          currency: tukor?.currency ?? null,
          netPrice: tukor?.netPrice ?? null,
          grossPrice: tukor?.grossPrice ?? null,
          saleNetPrice: tukor?.saleNetPrice ?? null,
          saleGrossPrice: tukor?.saleGrossPrice ?? null,
          source: "INITIAL",
          observedAt: kezdoSorIdopontja(tukor, most),
        });
      }
      irt += 1;
    }

    /**
     * A MERLEG MINDIG KIIRODIK, AKKOR IS, HA NULLA SOR KELETKEZETT.
     *
     * A "0 uj sor" ketfelet jelenthet: mar mindenkinek van kezdo sora, vagy a
     * lekerdezes nem talalt termeket. A ket szam egyutt eldontheto.
     */
    out.stdout(
      apply
        ? `${irt} kezdő ár-sor keletkezett | ${termekek.length} termék volt sor nélkül.\n`
        : `${irt} kezdő ár-sor KELETKEZNE | ${termekek.length} termék volt sor nélkül.\n`,
    );
    if (kozbenKapott)
      out.stdout(
        `${kozbenKapott} termék a lekérdezés ÓTA kapott sort, ezeket kihagytuk. ` +
          `Ha ez a szám nem nulla, a futás alatt írt más is.\n`,
      );
    /**
     * A KET SZAM KULON ALL, ES MINDIG KIIRODIK.
     *
     * A `tukorNelkul` azt mondja, hogy a termeknek NINCS UNAS-tukre; az
     * `uresArral` azt, hogy a tukor allhat, de ar nelkul. A masodik a nagyobb
     * halmaz, es a fontosabb: a tortenet elso pontjanak hasznalhatosagat AZ
     * mondja meg.
     */
    out.stdout(
      `Ebből ${uresArral} sor ÜRES árakkal áll: ezek azt állítják, hogy AKKOR ` +
        `nem ismertünk árat -- nem azt, hogy ingyen volt. Ha ez a szám nagy, a ` +
        `történet első pontja nem kiindulás, hanem hiányjelzés.\n`,
    );
    if (tukorNelkul)
      out.stdout(
        `Ebből ${tukorNelkul} terméknek egyáltalán NINCS UNAS-tükre -- ez a ` +
          `fenti halmaz része, és külön áll, mert más a teendő: ott nem az ár ` +
          `hiányzik, hanem a tükör.\n`,
      );

    return 0;
  } catch (error) {
    out.stderr(`A kezdő ár-sorok felvétele elhasalt: ${String(error)}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  /**
   * ITT KOTODIK OSSZE A PARANCS A VALODI ADATBAZISSAL, es CSAK itt.
   *
   * A torzs semmit nem tud a Prismarol: ezert lehet fixture-on merni, es
   * ezert bizonyithato, hogy `--apply` nelkul nem ir -- az `ir` varratot nem
   * hivjuk meg. A stage-en ezt NEM lehetne bizonyitani: ott a celhalmaz ma
   * URES, tehat egy "nulla sort irnek" kiiras akkor is helyesnek latszana, ha
   * a terv-ag maga hibas. (acrobot merese, 2026-09-15.)
   */
  const code = await runKezdoArSorokCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      jeloltek: () =>
        prisma.product.findMany({
          where: { priceHistory: { none: {} } },
          select: {
            id: true,
            unasSnapshot: {
              select: {
                currency: true,
                netPrice: true,
                grossPrice: true,
                saleNetPrice: true,
                saleGrossPrice: true,
                updatedAt: true,
              },
            },
          },
        }),
      vanMarSora: async (productId) =>
        (await prisma.productPriceHistory.count({
          where: { productId },
          take: 1,
        })) > 0,
      ir: async (sor) => {
        await prisma.productPriceHistory.create({ data: sor });
      },
    },
  );
  await prisma.$disconnect();
  process.exit(code);
}
