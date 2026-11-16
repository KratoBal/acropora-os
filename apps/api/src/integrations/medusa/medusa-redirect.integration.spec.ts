import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";
import { prismaRedirectSource } from "./medusa-redirect.cli.js";

/**
 * A KIKÜLDÖTT ÁTIRÁNYÍTÁS-LISTA A VALÓDI SÉMÁN (d707cf5f, A9). A termék-szabály
 * döntése a lekérdezett mezőkön múlik (Medusa-kötés, aktív változat, UNAS-cím,
 * márka), és ezek közül a szűrőket (`isActive` a változaton, `UNAS` a csatornán)
 * csak az adatbázis méri.
 *
 * MI PIROSIT: a kötés nélküli termék a saját lapjára megy; az inaktív változat
 * aktívnak számít; a kifutott termék (nem kapható lap) elveszti a szabályát; a
 * márka nélküli termék nem 410; a kézi szabály átíródik.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "REDIRECT-TARGET-INT-";

describe(
  "A bolti átirányítás-lista, adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const forras = (nev: string) => `/${PREFIX}${suffix}-${nev}`;
    let markaSlug = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      markaSlug = `${PREFIX.toLowerCase()}${suffix}`;
      const marka = await prisma.brand.create({
        data: {
          name: `${PREFIX}${suffix}`,
          normalizedName: markaSlug,
          slug: markaSlug,
        },
        select: { id: true },
      });
      const termek = async (
        nev: string,
        o: {
          linked: boolean;
          sellable?: boolean;
          variantActive?: boolean;
          brand?: boolean;
          unasUrl?: string;
          manual?: boolean;
        },
      ) => {
        const p = await prisma.product.create({
          data: {
            name: `${PREFIX}${suffix}-${nev}`,
            catalogAuthority: "UNAS",
            isActive: true,
            webshopSellable: o.sellable ?? true,
            brandId: o.brand === false ? null : marka.id,
            variants: {
              create: {
                sku: `${PREFIX}${suffix}-${nev}`,
                isActive: o.variantActive ?? true,
              },
            },
            channelListings: o.unasUrl
              ? { create: { channel: "UNAS", productUrl: o.unasUrl } }
              : undefined,
          },
          select: { id: true },
        });
        if (o.linked)
          await prisma.externalReference.create({
            data: {
              ...MEDUSA_PRODUCT_REFERENCE,
              entityId: p.id,
              externalId: `prod_${PREFIX}${suffix}-${nev}`,
            },
          });
        const ut = forras(nev);
        const cel = `/hu/termek/${PREFIX.toLowerCase()}${suffix}-${nev}`;
        await prisma.urlRedirect.create({
          data: {
            sourcePath: ut,
            sourcePathLower: ut.toLowerCase(),
            destinationPath: cel,
            destinationPathLower: cel.toLowerCase(),
            reason: o.manual ? "MANUAL" : "UNAS_PRODUCT",
            entityType: "PRODUCT",
            entityId: p.id,
          },
        });
      };
      await termek("lap", { linked: true });
      await termek("kifutott", {
        linked: true,
        sellable: false,
        unasUrl: "https://www.acropora.hu/Kifutott",
      });
      await termek("inaktiv-valtozat", { linked: true, variantActive: false });
      await termek("kotes-nelkul", { linked: false });
      await termek("marka-nelkul", { linked: false, brand: false });
      await termek("kezi", { linked: false, manual: true });
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const termekek = await prisma.product.findMany({
        where: { name: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = termekek.map((t) => t.id);
      await prisma.urlRedirect.deleteMany({
        where: { sourcePath: { startsWith: `/${PREFIX}` } },
      });
      await prisma.externalReference.deleteMany({
        where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: ids } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.channelListing.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
      await prisma.brand.deleteMany({
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
          nev: "Brand",
          darab: await prisma.brand.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
      ]);
    }

    it("termékenként a lap, a márkalap vagy a 410", async () => {
      const sorok = (await prismaRedirectSource.activeRedirects())
        .filter((r) => r.sourcePath.startsWith(`/${PREFIX}${suffix}-`))
        .map((r) => [
          r.sourcePath.slice(forras("").length),
          r.httpStatus,
          r.destinationPath.startsWith("/hu/termek/")
            ? "termeklap"
            : r.destinationPath,
          r.target ?? "-",
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const marka = `/hu/marka/${markaSlug}`;
      assert.deepEqual(sorok, [
        ["inaktiv-valtozat", 301, marka, "brand"],
        ["kezi", 301, "termeklap", "-"],
        ["kifutott", 301, "termeklap", "page"],
        ["kotes-nelkul", 301, marka, "brand"],
        ["lap", 301, "termeklap", "page"],
        ["marka-nelkul", 410, forras("marka-nelkul"), "gone"],
      ]);
    });
  },
);
