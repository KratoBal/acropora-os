import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planContractBillingLinks,
  runContractBillingLinkCli,
  type LinkDeps,
  type LinkInvoiceLine,
} from "./contract-billing-link.cli.js";

/**
 * A MÚLTBELI SZERZŐDÉSES SZÁMLASOROK ÖSSZEKÖTÉSE (feladat d510). Élő adatba ír,
 * ezért a parancs alakja maga a védelem. MI PIROSÍT: terv-futás ír; az --apply
 * --approval nélkül ír; egy nem egyértelmű sor (nulla vagy több egyező tétel)
 * összekötődik; a leírás vagy az egységár eltérése ellenére köt; a terv nem a
 * számlázottnak számító sorokból számolja az utána várható állapotot.
 */
const items = [
  {
    id: "ci-1",
    position: 1,
    description: "Kitalált szivattyú",
    unitNet: "1000",
    quantity: "3",
  },
  {
    id: "ci-2",
    position: 2,
    description: "Kitalált só",
    unitNet: "500",
    quantity: "2",
  },
  {
    id: "ci-3",
    position: 3,
    description: "Kitalált só",
    unitNet: "500",
    quantity: "1",
  },
];
const line = (
  id: string,
  description: string,
  unitNet: string,
  quantity: string,
  counts = true,
): LinkInvoiceLine => ({
  id,
  invoiceLabel: "E-1 (INVOICE, ISSUED)",
  position: 1,
  description,
  unitNet,
  quantity,
  counts,
});

describe("planContractBillingLinks", () => {
  it("LINK-PLAN: only an unambiguous match (description and net unit price) links", () => {
    const plan = planContractBillingLinks(items, [
      line("l1", " Kitalált  szivattyú ", "1000.0000", "2"),
      line("l2", "Kitalált só", "500", "1"),
      line("l3", "Kitalált szivattyú", "999", "1"),
    ]);
    assert.deepEqual(
      plan.links.map((l) => [l.line.id, l.item.id]),
      [["l1", "ci-1"]],
    );
    assert.deepEqual(
      plan.skipped.map((s) => [s.line.id, s.reason]),
      [
        ["l2", "2 tétel egyezik, nem egyértelmű"],
        ["l3", "nincs egyező tétel (leírás és nettó egységár)"],
      ],
    );
  });
});

function deps(written: string[]): LinkDeps {
  return {
    contract: async () => ({ id: "contract-1", kind: "PURCHASE", items }),
    unlinkedLines: async () => [
      line("l1", "Kitalált szivattyú", "1000", "2"),
      line("l4", "Kitalált szivattyú", "1000", "5", false),
    ],
    billedLines: async () => [],
    link: async (lineId, itemId) => {
      written.push(`${lineId}->${itemId}`);
      return 1;
    },
  };
}
const capture = () => {
  const out = { text: "", err: "" };
  return {
    out,
    io: {
      stdout: (t: string) => (out.text += t),
      stderr: (t: string) => (out.err += t),
    },
  };
};

describe("runContractBillingLinkCli", () => {
  it("LINK-PLAN-ONLY: without --apply nothing is written, and the state after counts only billed invoices", async () => {
    const written: string[] = [];
    const { out, io } = capture();
    assert.equal(
      await runContractBillingLinkCli(["SZ-1"], io, deps(written)),
      0,
    );
    assert.deepEqual(written, []);
    assert.match(out.text, /TERV: semmi nem íródott/);
    // l1 (2, counts) links; l4 (5) links too but its invoice does not count
    assert.match(out.text, /1\. tétel: szerződés 3, számlázva 2, maradék 1/);
  });

  it("LINK-APPLY-NEEDS-APPROVAL: --apply without --approval writes nothing (exit 2)", async () => {
    const written: string[] = [];
    const { out, io } = capture();
    assert.equal(
      await runContractBillingLinkCli(["SZ-1", "--apply"], io, deps(written)),
      2,
    );
    assert.deepEqual([written, /--approval/.test(out.err)], [[], true]);
  });

  it("LINK-APPLY: with an approval it writes the planned links and prints the approval", async () => {
    const written: string[] = [];
    const { out, io } = capture();
    assert.equal(
      await runContractBillingLinkCli(
        ["SZ-1", "--apply", "--approval", "Balázs, teszt"],
        io,
        deps(written),
      ),
      0,
    );
    assert.deepEqual(written, ["l1->ci-1", "l4->ci-1"]);
    assert.match(out.text, /ÍRÁS, hivatkozás: Balázs, teszt/);
  });
});
