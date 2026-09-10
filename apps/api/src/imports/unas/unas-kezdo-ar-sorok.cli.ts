import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

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
 * A `UnasProductSnapshot.syncedAt` erteke, ha van: AKKOR volt igaz az az ar. Ha
 * nincs, a futas ideje -- es akkor a sor annyit allit, hogy "ekkor mar ez volt".
 * A ketto kulonbsege nem elhanyagolhato egy hatarido-szamitasnal, ezert nem
 * irunk egysegesen "most"-ot.
 *
 * KILEPESI KODOK
 *   0  lefutott (akar nulla uj sorral)
 *   1  a futas hibara futott
 */
export async function runKezdoArSorokCli(
  out: { stdout: (t: string) => void; stderr: (t: string) => void } = {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  },
): Promise<number> {
  try {
    const termekek = await prisma.product.findMany({
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
            syncedAt: true,
          },
        },
      },
    });

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

      await prisma.productPriceHistory.create({
        data: {
          productId: termek.id,
          currency: tukor?.currency ?? null,
          netPrice: tukor?.netPrice ?? null,
          grossPrice: tukor?.grossPrice ?? null,
          saleNetPrice: tukor?.saleNetPrice ?? null,
          saleGrossPrice: tukor?.saleGrossPrice ?? null,
          source: "INITIAL",
          observedAt: tukor?.syncedAt ?? most,
        },
      });
      irt += 1;
    }

    /**
     * A MERLEG MINDIG KIIRODIK, AKKOR IS, HA NULLA SOR KELETKEZETT.
     *
     * A "0 uj sor" ketfelet jelenthet: mar mindenkinek van kezdo sora, vagy a
     * lekerdezes nem talalt termeket. A ket szam egyutt eldontheto.
     */
    out.stdout(
      `${irt} kezdő ár-sor keletkezett | ${termekek.length} termék volt sor nélkül.\n`,
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
  const code = await runKezdoArSorokCli();
  await prisma.$disconnect();
  process.exit(code);
}
