import { prisma } from "@acropora/database";

import { type KapcsolatFajta } from "./unas-kapcsolat-hivatkozasok.js";
import {
  runKapcsolatUjraepitesCli,
  meglevoKulcs,
  type CliOutput,
  type UjraepitesDeps,
} from "./unas-kapcsolat-ujraepites.cli.js";

/**
 * A KAPCSOLAT-UJRAEPITES VALODI ADATBAZIS-BEKOTESE, EGY HELYEN.
 *
 * KET HIVOJA VAN, ES EZERT KERULT KI A PARANCS TORZSEBOL: a parancssori alak
 * (`unas-kapcsolat-ujraepites.cli.ts` vege) es az utemezo. Ket kulon
 * osszeallitas az elso napon egyezne, es utana elcsuszna -- ugyanaz az ok,
 * amiert a futas SORAT is egy helyen allitjuk ossze.
 *
 * A MINTA A REPOE: a `medusa-projection.runner.ts` ugyanigy all kulon a sajat
 * parancsatol es utemezojetol.
 */

/**
 * A GYORSITOTAR FUTASONKENT AL, NEM MODUL-SZINTEN -- ES EZ A KOLTOZES LENYEGI
 * RESZE, NEM STILUS.
 *
 * A parancs egyszer fut es kilep, tehat ott egy modul-szintu gyorsitotar
 * artalmatlan volt. Az utemezo viszont EGY HOSSZU ELETU folyamatban lakik: egy
 * modul-szintu gyorsitotar a MASODIK naptol a tegnapi kulso azonositokkal
 * dolgozna, es az uj termekek hivatkozasai csendben feloldatlanok maradnanak.
 *
 * A hiba alakja pontosan az, amirol a lapunk szol: nem hibazna, nem allna meg,
 * csak MAST csinalna -- es a `feloldatlan` szam hihetoen nezne ki.
 */
export function prismaUjraepitesDeps(): UjraepitesDeps {
  let kulsoSorokGyorsitotar:
    Promise<Array<{ externalId: string; entityId: string }>> | undefined;
  const kulsoAzonositoSorok = () =>
    (kulsoSorokGyorsitotar ??= prisma.externalReference.findMany({
      where: { system: "UNAS", entityType: "Product" },
      select: { externalId: true, entityId: true },
    }));

  return {
    /**
     * A KULSO AZONOSITO NEM A PILLANATKEPEN ALL.
     *
     * Az elso valtozat `externalId`-t kert a `UnasProductSnapshot` modelltol,
     * es a parancs EL SEM INDULT: `Unknown field externalId for select
     * statement`. A modellen `productId` all (unique); a kulso azonosito az
     * `ExternalReference` tablan lakik -- pontosan ott, ahonnan a terkep is
     * olvas.
     *
     * EZERT EGY LEKERDEZES SZOLGALJA MIND A KETTOT: a sorokbol elore-terkep
     * lesz a feloldashoz, es FORDITOTT terkep a jeloltek sajat azonositojahoz.
     */
    jeloltek: async () => {
      const [pillanatkepek, kulsoSorok] = await Promise.all([
        prisma.unasProductSnapshot.findMany({
          select: { productId: true, rawPayload: true },
        }),
        kulsoAzonositoSorok(),
      ]);
      const forditott = new Map(
        kulsoSorok.map((sor) => [sor.entityId, sor.externalId]),
      );
      return pillanatkepek.map((sor) => ({
        productId: sor.productId,
        externalId: forditott.get(sor.productId) ?? null,
        rawPayload: sor.rawPayload,
      }));
    },
    terkep: async () =>
      new Map(
        (await kulsoAzonositoSorok()).map((sor) => [
          sor.externalId,
          sor.entityId,
        ]),
      ),
    /*
        EGY OSSZESITES, NEM TERMEKENKENTI LEKERDEZES: ketezer termeknel a
        masodik alak negyezer kort jelentene, es a parancs epp azert letezik,
        hogy EGYSZER fusson le.
      */
    meglevoKapcsolatok: async () =>
      new Map(
        (
          await prisma.productRelation.groupBy({
            by: ["sourceProductId", "relationType"],
            where: { source: "UNAS" },
            _count: { _all: true },
          })
        ).map((sor) => [
          meglevoKulcs(sor.sourceProductId, sor.relationType as KapcsolatFajta),
          sor._count._all,
        ]),
      ),
    rogzit: async (sor) => {
      await prisma.unasRelationRebuildRun.create({
        data: { ...sor, completedAt: new Date() },
      });
    },
    ir: async ({ sourceProductId, fajta, celProductIdk }) =>
      prisma.$transaction(async (tx) => {
        /**
         * TOROL, MAJD UJRAIR -- ugyanaz a sorrend, amit a szinkron hasznal.
         *
         * A torles a SAJAT forrasunkra szukit (`source: "UNAS"`): egy kezzel
         * felvett kapcsolatot nem viszunk el.
         */
        const torolt = await tx.productRelation.deleteMany({
          where: { sourceProductId, relationType: fajta, source: "UNAS" },
        });
        if (celProductIdk.length === 0) return { torolt: torolt.count, irt: 0 };
        const created = await tx.productRelation.createMany({
          data: celProductIdk.map((targetProductId, index) => ({
            sourceProductId,
            targetProductId,
            relationType: fajta,
            sortOrder: index,
            source: "UNAS",
          })),
          skipDuplicates: true,
        });
        return { torolt: torolt.count, irt: created.count };
      }),
  };
}

/**
 * EGY KOR, VALODI ADATBAZISSAL. A visszateresi ertek a parancs kilepesi kodja:
 * 0 rendben, 1 hiba, 2 megalltunk a nagy valtozas hataran.
 */
export function runKapcsolatUjraepites(
  argv: readonly string[],
  out: CliOutput,
): Promise<number> {
  return runKapcsolatUjraepitesCli(argv, out, prismaUjraepitesDeps());
}
