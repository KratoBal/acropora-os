import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CliOutput } from "./medusa-category.cli.js";
import {
  auditImageAddresses,
  describeImageAddressReport,
  runImageAuditCli,
} from "./medusa-image-audit.cli.js";
import type {
  MedusaImageLink,
  MedusaImageLinkListing,
} from "./medusa-image-link.repository.js";

const MOST = new Date("2026-09-04T18:00:00.000Z");

function link(
  productId: string,
  medusaUrl: string,
  sourceUrl = `https://shop.acropora.hu/img/${productId}.jpg`,
): MedusaImageLink {
  return {
    productId,
    sourceUrl,
    medusaFileId: `fajl_${productId}_${medusaUrl.length}`,
    medusaUrl,
    lastSyncedAt: MOST,
  };
}

const BELSO = "http://localhost:9000/static/1788516704783-156161.jpg";
const BELSO2 = "http://localhost:9000/static/1788516704999-195.jpg";
const NYILVANOS =
  "https://commerce-stage.acropora.hu/static/1788516704783-a.jpg";

function listing(
  links: MedusaImageLink[],
  broken: { entityId: string; externalId: string }[] = [],
): MedusaImageLinkListing {
  return { links, broken };
}

function gyujto() {
  const ki: string[] = [];
  const hiba: string[] = [];
  const out: CliOutput = {
    stdout: (v) => ki.push(v),
    stderr: (v) => hiba.push(v),
  };
  return { out, szoveg: () => ki.join(""), hibaSzoveg: () => hiba.join("") };
}

describe("a kép-címek számlálója", () => {
  it("megszámolja a belső címeket, és a termékeket egyszer sorolja fel", () => {
    const report = auditImageAddresses(
      listing([
        link("prod_a", BELSO),
        // UGYANAZ A TERMEK KET KEPPEL: ket SOR, egy TERMEK.
        link("prod_a", BELSO2),
        link("prod_b", BELSO),
        link("prod_c", NYILVANOS),
      ]),
    );

    assert.equal(report.rows, 4);
    assert.equal(report.internalRows, 3);
    assert.equal(report.publicRows, 1);
    assert.deepEqual(report.internalProductIds, ["prod_a", "prod_b"]);
  });

  /**
   * A KONTROLL AZ URES VILAG ELLEN. Egy "nulla belso cim" eredmenyt egy olyan
   * szamlalo is eloallit, ami SEMMIT nem lat. Ez az allitas azt koti le, hogy
   * a nulla mellett a tobbi sor MEGVAN.
   */
  it("tiszta adaton nulla a lelet, de a sorokat akkor is látja", () => {
    const report = auditImageAddresses(
      listing([link("prod_a", NYILVANOS), link("prod_b", NYILVANOS)]),
    );

    assert.equal(report.internalRows, 0);
    assert.equal(report.rows, 2);
    assert.equal(report.publicRows, 2);
    assert.deepEqual(report.internalProductIds, []);
  });

  it("a hoszt-bontás csökkenő sorrendben áll, és a besorolást is viszi", () => {
    const report = auditImageAddresses(
      listing([
        link("prod_a", NYILVANOS),
        link("prod_b", NYILVANOS),
        link("prod_c", BELSO),
      ]),
    );

    assert.deepEqual(
      report.origins.map((o) => [o.origin, o.rows, o.kind]),
      [
        ["https://commerce-stage.acropora.hu", 2, "public"],
        ["http://localhost:9000", 1, "internal"],
      ],
    );
  });

  /**
   * A TORT SOR NEM OLI MEG A MEREST, ES NEM IS TUNIK EL: sajat szama van.
   * A `links` tomb ezert NEM tartalmazza -- a tarolo valasztja szet.
   */
  it("a vissza nem olvasható sorokat külön számolja", () => {
    const report = auditImageAddresses(
      listing(
        [link("prod_a", NYILVANOS)],
        [{ entityId: "prod_x:https://shop/x.jpg", externalId: "fajl_x" }],
      ),
    );

    assert.equal(report.rows, 1);
    assert.equal(report.brokenRows, 1);
  });

  it("a jelentés kiírja a számokat, a termékeket és a mérés határát", () => {
    const szoveg = describeImageAddressReport(
      auditImageAddresses(
        listing([link("prod_a", BELSO), link("prod_b", NYILVANOS)]),
      ),
    );

    assert.match(szoveg, /Leképezés-sorok: 2/);
    assert.match(szoveg, /kívülről ELÉRHETETLEN címen: 1/);
    assert.match(szoveg, /prod_a/);
    assert.match(szoveg, /AMIT EZ A SZÁM NEM MOND MEG/);
    assert.match(szoveg, /semmit nem írt és nem törölt/);
    // A CIMEK NEM KERULNEK A FELSOROLASBA: termek-azonosito megy ki, nem URL.
    assert.equal(szoveg.includes(BELSO), false);
  });

  it("a lelet kilépési kódja 2, a tiszta futásé 0", async () => {
    const piszkos = gyujto();
    assert.equal(
      await runImageAuditCli([], piszkos.out, {
        listing: () => Promise.resolve(listing([link("prod_a", BELSO)])),
      }),
      2,
    );

    const tiszta = gyujto();
    assert.equal(
      await runImageAuditCli([], tiszta.out, {
        listing: () => Promise.resolve(listing([link("prod_a", NYILVANOS)])),
      }),
      0,
    );
    assert.equal(tiszta.hibaSzoveg(), "");
  });
});
