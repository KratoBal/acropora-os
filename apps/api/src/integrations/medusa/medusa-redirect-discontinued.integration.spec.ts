import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { MEDUSA_STORE_CATEGORY_REFERENCE } from "./medusa-category.policy.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";
import { prismaRedirectSource } from "./medusa-redirect.cli.js";

/**
 * A VÉGLEGESEN MEGSZŰNTNEK JELÖLT TERMÉK ÁTIRÁNYÍTÁSA A VALÓDI SÉMÁN (V4.2, kártya 9d0523fa). A cél a lekérdezett
 * mezőkön múlik (a jelölő, a helyettesítő Medusa-kötése és állapota, a webshop-slug, az elsődleges bolti kategória
 * és annak Medusa-kötése), és ezeket csak az adatbázis méri.
 *
 * MI PIROSIT: a jelölt termék régi címe és saját lapja nem a megvehető helyettesítőre megy; a helyettesítő nélküli
 * jelölt nem a kategóriára megy; a cél nélküli jelölt (nincs helyettesítő, nincs kategória) elveszti a mai
 * szabályát; a jelölt termék saját lapja nem kap sort.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "REDIRECT-DISC-INT-";

describe(
  "A véglegesen megszűnt termék átirányítása, adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const low = (nev: string) => `${PREFIX.toLowerCase()}${suffix}-${nev}`;
    const regiCim = (nev: string) => `/${PREFIX}${suffix}-${nev}`;
    const lapCim = (nev: string) => `/hu/termek/${low(nev)}`;
    const kategoriaSlug = `${PREFIX.toLowerCase()}${suffix}-kategoria`;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const kategoria = await prisma.storeCategory.create({
        data: { name: `${PREFIX}${suffix}`, slug: kategoriaSlug },
        select: { id: true },
      });
      await prisma.externalReference.create({
        data: {
          ...MEDUSA_STORE_CATEGORY_REFERENCE,
          entityId: kategoria.id,
          externalId: `cat_${PREFIX}${suffix}`,
        },
      });
      const termek = async (
        nev: string,
        o: {
          megvehetoe: boolean;
          kategoriaban?: boolean;
          jelolt?: { helyettesito: string | null };
          regiLap?: boolean;
        },
      ) => {
        const p = await prisma.product.create({
          data: {
            name: `${PREFIX}${suffix}-${nev}`,
            catalogAuthority: "UNAS",
            isActive: o.megvehetoe,
            webshopSellable: o.megvehetoe,
            variants: {
              create: { sku: `${PREFIX}${suffix}-${nev}`, isActive: true },
            },
            channelListings: {
              create: [
                { channel: "WEBSHOP", slug: low(nev) },
                ...(o.regiLap === false
                  ? []
                  : [
                      {
                        channel: "UNAS" as const,
                        productUrl: `https://www.acropora.hu/${PREFIX}${nev}`,
                      },
                    ]),
              ],
            },
          },
          select: { id: true },
        });
        await prisma.externalReference.create({
          data: {
            ...MEDUSA_PRODUCT_REFERENCE,
            entityId: p.id,
            externalId: `prod_${PREFIX}${suffix}-${nev}`,
          },
        });
        if (o.kategoriaban)
          await prisma.storeCategoryProduct.create({
            data: {
              productId: p.id,
              storeCategoryId: kategoria.id,
              isPrimary: true,
            },
          });
        const forras = regiCim(nev);
        const cel = lapCim(nev);
        await prisma.urlRedirect.create({
          data: {
            sourcePath: forras,
            sourcePathLower: forras.toLowerCase(),
            destinationPath: cel,
            destinationPathLower: cel.toLowerCase(),
            reason: "UNAS_PRODUCT",
            entityType: "PRODUCT",
            entityId: p.id,
          },
        });
        return { id: p.id, jelolt: o.jelolt };
      };
      const ujTermek = await termek("uj", { megvehetoe: true });
      const rossz = await termek("rossz", { megvehetoe: false });
      const a = await termek("a", {
        megvehetoe: false,
        kategoriaban: true,
        jelolt: { helyettesito: ujTermek.id },
      });
      const b = await termek("b", {
        megvehetoe: false,
        kategoriaban: true,
        jelolt: { helyettesito: null },
      });
      const c = await termek("c", {
        megvehetoe: false,
        jelolt: { helyettesito: null },
      });
      // a helyettesítője nem megvehető: a kategória a cél
      const d = await termek("d", {
        megvehetoe: false,
        kategoriaban: true,
        jelolt: { helyettesito: rossz.id },
      });
      for (const t of [a, b, c, d])
        await prisma.productDiscontinuation.create({
          data: {
            productId: t.id,
            replacementProductId: t.jelolt?.helyettesito ?? null,
          },
        });
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const termekek = await prisma.product.findMany({
        where: { name: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = termekek.map((t) => t.id);
      const kategoriak = await prisma.storeCategory.findMany({
        where: { name: { startsWith: PREFIX } },
        select: { id: true },
      });
      await prisma.urlRedirect.deleteMany({
        where: { sourcePath: { startsWith: `/${PREFIX}` } },
      });
      await prisma.externalReference.deleteMany({
        where: {
          OR: [
            { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: ids } },
            {
              ...MEDUSA_STORE_CATEGORY_REFERENCE,
              entityId: { in: kategoriak.map((k) => k.id) },
            },
          ],
        },
      });
      await prisma.productDiscontinuation.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.storeCategoryProduct.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.channelListing.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
      await prisma.storeCategory.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      nincsMaradek([
        {
          nev: "UrlRedirect (sourcePath)",
          darab: await prisma.urlRedirect.count({
            where: { sourcePath: { startsWith: `/${PREFIX}` } },
          }),
        },
        {
          nev: "Product",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "StoreCategory",
          darab: await prisma.storeCategory.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
      ]);
    }

    it("a jelölt termék régi címe és saját lapja a megvehető helyettesítőre vagy a kategóriára megy; cél nélkül a mai szabály marad", async () => {
      const sorok = (await prismaRedirectSource.activeRedirects()).filter(
        (r) =>
          r.sourcePath
            .toLowerCase()
            .startsWith(`/${PREFIX.toLowerCase()}${suffix}-`) ||
          r.sourcePath
            .toLowerCase()
            .startsWith(`/hu/termek/${PREFIX.toLowerCase()}${suffix}-`),
      );
      const kat = `/hu/categories/${kategoriaSlug}`;
      const forrasok = new Set(sorok.map((r) => r.sourcePath.toLowerCase()));
      // egy ugrás: egyik sor célja sem forrás
      for (const r of sorok)
        assert.equal(
          forrasok.has(r.destinationPath.toLowerCase()),
          false,
          `lánc: ${r.sourcePath} -> ${r.destinationPath}`,
        );
      const keres = (forras: string) =>
        sorok.find((r) => r.sourcePath === forras);
      // a: a megvehető helyettesítő (régi cím ÉS saját lap)
      for (const forras of [regiCim("a"), lapCim("a")]) {
        assert.equal(keres(forras)?.destinationPath, lapCim("uj"), forras);
        assert.equal(keres(forras)?.target, "moved", forras);
      }
      // b: nincs helyettesítő, az elsődleges bolti kategória
      for (const forras of [regiCim("b"), lapCim("b")])
        assert.equal(keres(forras)?.destinationPath, kat, forras);
      // d: a helyettesítője nem megvehető, ugyanúgy a kategória
      for (const forras of [regiCim("d"), lapCim("d")])
        assert.equal(keres(forras)?.destinationPath, kat, forras);
      // c: nincs cél, a mai szabály marad (a kifutott termék lapja), és a lapjának nincs sora
      assert.equal(keres(regiCim("c"))?.destinationPath, lapCim("c"));
      assert.equal(keres(regiCim("c"))?.target, "page");
      assert.equal(keres(lapCim("c")), undefined);
      // a megvehető helyettesítő és a nem megvehető termék lapja nem forrás
      assert.equal(keres(lapCim("uj")), undefined);
      assert.equal(keres(lapCim("rossz")), undefined);
    });
  },
);
