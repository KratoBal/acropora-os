import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertPartnerCodeFree,
  mirroredBillingAddress,
  mirroredTaxNumber,
  syncWorksheetMirror,
} from "./suppliers.repository.js";

interface Call {
  table: string;
  action: string;
  args: Record<string, unknown>;
}

/**
 * A stub transaction that records what was asked of it. The real thing needs a
 * database, and the integration gate keeps those runs out of `pnpm test`, so
 * what is asserted here is the decision rather than the write: which call is
 * made, and with what.
 */
function stubTransaction(
  calls: Call[],
  createdId = "customer-new",
  /** the billing address the mirror already has (null: none), and how many addresses it holds */
  existingAddress: { id: string } | null = null,
  addressCount = 0,
) {
  return {
    customerAddress: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ table: "customerAddress", action: "findFirst", args });
        return existingAddress;
      },
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "customerAddress", action: "update", args });
        return {};
      },
      create: async (args: Record<string, unknown>) => {
        calls.push({ table: "customerAddress", action: "create", args });
        return {};
      },
      count: async () => addressCount,
    },
    customer: {
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "customer", action: "update", args });
        return {};
      },
      create: async (args: Record<string, unknown>) => {
        calls.push({ table: "customer", action: "create", args });
        return { id: createdId };
      },
    },
    supplier: {
      update: async (args: Record<string, unknown>) => {
        calls.push({ table: "supplier", action: "update", args });
        return {};
      },
    },
  } as never;
}

/**
 * A PARTNER ADÓSZÁMA A TÜKÖRBEN (kártya aaf4f09d; Balázs, 2026-11-04: az állatkert
 * minden számlája adószám nélkül ment ki). MI PIROSÍT: ha a mentés nem viszi át
 * az adószámot (sem frissítéskor, sem létrehozáskor); ha a külföldi partner
 * adószáma a magyar mezőbe kerül; ha egy üres partner-adószám törli a tükörét.
 */
describe("the partner's tax number on the mirror", () => {
  it("goes to taxNumber for a Hungarian partner and to euTaxNumber for a foreign one", () => {
    assert.deepEqual(
      mirroredTaxNumber({ taxNumber: " 15490658-2-42 ", country: "HU" }),
      {
        taxNumber: "15490658-2-42",
      },
    );
    assert.deepEqual(mirroredTaxNumber({ taxNumber: "15490658-2-42" }), {
      taxNumber: "15490658-2-42",
    });
    assert.deepEqual(
      mirroredTaxNumber({ taxNumber: "DE123456789", country: "de" }),
      {
        euTaxNumber: "DE123456789",
      },
    );
    for (const empty of [null, undefined, "", "   "])
      assert.deepEqual(
        mirroredTaxNumber({ taxNumber: empty, country: "HU" }),
        {},
        String(empty),
      );
  });

  it("without a country, a foreign country code makes a community tax number, a HU prefix makes none", () => {
    for (const country of [null, undefined, "", "  "]) {
      assert.deepEqual(
        mirroredTaxNumber({ taxNumber: "DE123456789", country }),
        { euTaxNumber: "DE123456789" },
        String(country),
      );
      // a HU-prefixed value fits neither field: the gate stops and names the reason
      assert.deepEqual(
        mirroredTaxNumber({ taxNumber: "hu12345678", country }),
        {},
        String(country),
      );
      assert.deepEqual(
        mirroredTaxNumber({ taxNumber: "15490658-2-42", country }),
        { taxNumber: "15490658-2-42" },
        String(country),
      );
    }
  });

  it("is carried on every save, on update and on create", async () => {
    const calls: Call[] = [];
    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Fővárosi Állat- és Növénykert",
      isService: true,
      customerId: "customer-7",
      taxNumber: "15490658-2-42",
      country: "HU",
    });
    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-2",
      name: "Zoo GmbH",
      isService: true,
      customerId: null,
      taxNumber: "DE123456789",
      country: "DE",
    });
    const update = calls.find(
      (c) => c.action === "update" && c.table === "customer",
    )!.args.data as Record<string, unknown>;
    assert.equal(update.taxNumber, "15490658-2-42");
    assert.equal("euTaxNumber" in update, false);
    const create = calls.find((c) => c.action === "create")!.args
      .data as Record<string, unknown>;
    assert.equal(create.euTaxNumber, "DE123456789");
    assert.equal("taxNumber" in create, false);
  });

  it("an empty partner tax number does not clear the mirror's", async () => {
    const calls: Call[] = [];
    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "X Kft.",
      isService: true,
      customerId: "customer-7",
      taxNumber: null,
    });
    const data = calls[0]!.args.data as Record<string, unknown>;
    assert.equal("taxNumber" in data, false);
    assert.equal("euTaxNumber" in data, false);
  });
});

describe("the service partner's mirror customer", () => {
  /**
   * The failure this guards against is silence: a partner renamed on the
   * partner screen, the mirror left alone, and every worksheet written
   * afterwards carrying the old name. Nothing errors, so nothing reports it.
   */
  it("carries a renamed partner's name and code over to the mirror", async () => {
    const calls: Call[] = [];

    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Új Név Kft.",
      isService: true,
      customerId: "customer-7",
      worksheetPartnerCode: "UJNV",
      paymentDueDays: 30,
    });

    assert.deepEqual(calls, [
      {
        table: "customer",
        action: "update",
        args: {
          where: { id: "customer-7" },
          data: {
            displayName: "Új Név Kft.",
            companyName: "Új Név Kft.",
            // The worksheet number is built from this copy, so a code left
            // behind here would number new sheets after the old abbreviation.
            worksheetPartnerCode: "UJNV",
            // The invoice is written to the mirror, so the partner's payment
            // term has to arrive here too.
            paymentDueDays: 30,
            // no e-mail given: the mirror's billing address is cleared, not left stale
            billingEmail: null,
          },
        },
      },
    ]);
  });

  /**
   * Balázs, 2026-10-26: one record, two addresses. The partner screen has ONE
   * e-mail field; it is the partner's billing address and travels to the record
   * the invoice is written to. The failure guarded against is the Állatkert one:
   * the invoice went to an old address while the partner screen showed the new.
   */
  it("carries the partner's e-mail to the mirror as its billing e-mail, trimmed, on update and on create", async () => {
    const dataOf = (calls: Call[]) =>
      (calls[0]?.args.data as { billingEmail?: string | null }).billingEmail;
    const updated: Call[] = [];
    await syncWorksheetMirror(stubTransaction(updated), {
      id: "supplier-1",
      name: "Állatkert",
      isService: true,
      customerId: "customer-7",
      email: "  penzugy@example.com ",
    });
    assert.equal(dataOf(updated), "penzugy@example.com");
    const created: Call[] = [];
    await syncWorksheetMirror(stubTransaction(created), {
      id: "supplier-2",
      name: "Új Partner",
      isService: true,
      customerId: null,
      email: "szamla@example.com",
    });
    assert.equal(dataOf(created), "szamla@example.com");
    const cleared: Call[] = [];
    await syncWorksheetMirror(stubTransaction(cleared), {
      id: "supplier-1",
      name: "Állatkert",
      isService: true,
      customerId: "customer-7",
      email: "   ",
    });
    assert.equal(dataOf(cleared), null);
  });

  /** A partner is recorded once, by hand. The row that carries its worksheets
   * is the system's job, so ticking "Szerviz" is enough to bring it into
   * being, and the partner is linked to it in the same transaction. */
  it("creates the mirror and links it when a partner becomes a service partner", async () => {
    const calls: Call[] = [];

    await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Szerviz Bt.",
      isService: true,
      customerId: null,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.action, "create");
    // The number is the one field that travels everywhere the row goes: an
    // invoice, an export, a spreadsheet somebody opens next year. It says what
    // the row is, so that whoever meets it there does not have to ask.
    const created = calls[0]?.args.data as { customerNumber: string };
    assert.match(created.customerNumber, /^PARTNER-/);
    assert.deepEqual(calls[1], {
      table: "supplier",
      action: "update",
      args: {
        where: { id: "supplier-1" },
        data: { customerId: "customer-new" },
      },
    });
  });

  /**
   * Un-ticking "Szerviz" must not drop the row. Worksheets may already point
   * at it, and the relation refuses the delete anyway -- but the reason to
   * assert it here is that the tempting cleanup would look tidy and would take
   * a partner's history with it.
   */
  it("leaves an existing mirror alone when the partner is no longer service", async () => {
    const calls: Call[] = [];

    const kept = await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Csak Beszállító Kft.",
      isService: false,
      customerId: "customer-7",
    });

    assert.deepEqual(calls, []);
    assert.equal(kept, "customer-7");
  });

  /**
   * A code taken by ANOTHER customer has to be caught here, not by the
   * database. It is the mirror that makes this possible at all: the partner's
   * code is copied onto a customer row where the same column is already
   * unique, so a check that only looked at the partner table would pass and
   * then fail on the write, with a message naming a constraint.
   */
  it("refuses a code another customer already holds, and names them", async () => {
    const tx = {
      supplier: { findFirst: async () => null },
      customer: { findFirst: async () => ({ displayName: "Fankó Kft." }) },
    } as never;

    await assert.rejects(
      () => assertPartnerCodeFree(tx, "FANK", "supplier-1"),
      /PARTNER_CODE_TAKEN:Fankó Kft\./,
    );
  });

  /** Saving a partner without changing its code must not trip over its own
   * row: the check excludes the partner being saved, on both sides. */
  it("lets a partner keep the code it already holds", async () => {
    const seen: string[] = [];
    const tx = {
      supplier: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          seen.push(JSON.stringify(args.where.NOT));
          return null;
        },
      },
      customer: { findFirst: async () => null },
    } as never;

    await assertPartnerCodeFree(tx, "FANK", "supplier-1");

    assert.deepEqual(seen, ['{"id":"supplier-1"}']);
  });

  /** A partner that was never a service partner gets no row at all: the point
   * of the mirror is worksheets, and a supplier we only buy from has none. */
  it("does not invent a mirror for a partner we only buy from", async () => {
    const calls: Call[] = [];

    const none = await syncWorksheetMirror(stubTransaction(calls), {
      id: "supplier-1",
      name: "Csak Beszállító Kft.",
      isService: false,
      customerId: null,
    });

    assert.deepEqual(calls, []);
    assert.equal(none, null);
  });
});

/**
 * A PARTNER CÍME A TÜKÖRBEN (acrobot, #2164 review: az állatkert számlája cím nélkül nem állhat meg). MI PIROSÍT: ha a
 * mentés nem viszi át a teljes címet (létrehozáskor a tükörrel együtt, frissítéskor a meglévő számlázási címre, vagy ha
 * nincs, új sorként); ha egy részleges vagy üres partner-cím ír félkész sort vagy törli a tükörét; ha az ország
 * üresen nem HU.
 */
describe("the partner's address on the mirror", () => {
  const full = {
    postalCode: " 1146 ",
    city: "Budapest",
    addressLine1: "Állatkerti krt. 6-12.",
    addressLine2: " ",
    country: "hu",
  };
  const partner = {
    id: "supplier-1",
    name: "Fővárosi Állat- és Növénykert",
    isService: true,
  };

  it("is the one billing address, trimmed, with an empty line 2 as null and the country upper case", () => {
    assert.deepEqual(mirroredBillingAddress(full), {
      country: "HU",
      postalCode: "1146",
      city: "Budapest",
      line1: "Állatkerti krt. 6-12.",
      line2: null,
    });
    assert.equal(
      mirroredBillingAddress({ ...full, country: "" })!.country,
      "HU",
    );
  });

  it("is nothing when the postal code, the city or the street is missing", () => {
    for (const missing of ["postalCode", "city", "addressLine1"])
      for (const empty of [null, undefined, "", "  "])
        assert.equal(
          mirroredBillingAddress({ ...full, [missing]: empty }),
          null,
          `${missing}=${String(empty)}`,
        );
  });

  it("is created together with a new mirror, as its default billing address", async () => {
    const calls: Call[] = [];
    await syncWorksheetMirror(stubTransaction(calls), {
      ...partner,
      customerId: null,
      ...full,
    });
    const data = calls.find(
      (c) => c.table === "customer" && c.action === "create",
    )!.args.data as { addresses: { create: Record<string, unknown>[] } };
    assert.deepEqual(data.addresses.create, [
      {
        country: "HU",
        postalCode: "1146",
        city: "Budapest",
        line1: "Állatkerti krt. 6-12.",
        line2: null,
        type: "BILLING",
        isDefault: true,
      },
    ]);
  });

  it("rewrites the mirror's existing billing address in place on every save", async () => {
    const calls: Call[] = [];
    await syncWorksheetMirror(stubTransaction(calls, "x", { id: "addr-1" }), {
      ...partner,
      customerId: "customer-7",
      ...full,
    });
    const update = calls.find(
      (c) => c.table === "customerAddress" && c.action === "update",
    )!;
    assert.deepEqual(update.args.where, { id: "addr-1" });
    assert.equal((update.args.data as { city: string }).city, "Budapest");
    assert.equal(
      calls.some((c) => c.table === "customerAddress" && c.action === "create"),
      false,
    );
  });

  it("gives a mirror without a billing address one (the default only when it holds none)", async () => {
    for (const [count, isDefault] of [
      [0, true],
      [2, false],
    ] as const) {
      const calls: Call[] = [];
      await syncWorksheetMirror(stubTransaction(calls, "x", null, count), {
        ...partner,
        customerId: "customer-7",
        ...full,
      });
      const create = calls.find(
        (c) => c.table === "customerAddress" && c.action === "create",
      )!;
      assert.equal(
        (
          create.args.data as {
            isDefault: boolean;
            type: string;
            customerId: string;
          }
        ).isDefault,
        isDefault,
      );
      assert.equal((create.args.data as { type: string }).type, "BILLING");
      assert.equal(
        (create.args.data as { customerId: string }).customerId,
        "customer-7",
      );
    }
  });

  it("an empty or partial partner address leaves the mirror's address alone", async () => {
    for (const address of [
      {},
      { postalCode: "1146", city: "Budapest" },
      { city: "Budapest", addressLine1: "Fő út 1." },
    ]) {
      const calls: Call[] = [];
      await syncWorksheetMirror(stubTransaction(calls, "x", { id: "addr-1" }), {
        ...partner,
        customerId: "customer-7",
        ...address,
      });
      assert.equal(
        calls.some((c) => c.table === "customerAddress"),
        false,
        JSON.stringify(address),
      );
      const created: Call[] = [];
      await syncWorksheetMirror(stubTransaction(created), {
        ...partner,
        customerId: null,
        ...address,
      });
      assert.equal(
        "addresses" in
          (created.find((c) => c.table === "customer" && c.action === "create")!
            .args.data as Record<string, unknown>),
        false,
      );
    }
  });
});

/**
 * A PARTNER EGYSZERI ÁTVEZETÉSE A TÖRZSBE (partnertörzs): a `register` kapcsolóval a nem szerviz-partnernek is készül vevő-sor.
 * MI PIROSÍT: ha kapcsoló nélkül egy nem szerviz-partnerhez sor készül (a szerviz-tükör szabálya törne); ha a kapcsolóval nem
 * készül; ha az új sor nem PARTNER- számú, nem COMPANY, vagy nem viszi a nevet, az adószámot és a címet; ha a partner nem kapja meg a
 * kötést.
 */
describe("the register option of syncWorksheetMirror", () => {
  const partner = {
    id: "supplier-9",
    name: "Beszállító Kft.",
    isService: false,
    customerId: null,
    taxNumber: "11111111-2-42",
    country: "HU",
    email: "szamla@beszallito.example",
    postalCode: "1146",
    city: "Budapest",
    addressLine1: "Fő út 1.",
  };

  it("does nothing for a non-service partner without the option, as before", async () => {
    const calls: Call[] = [];
    assert.equal(
      await syncWorksheetMirror(stubTransaction(calls), partner),
      null,
    );
    assert.deepEqual(calls, []);
  });

  it("creates a PARTNER- company row with the partner's name, tax number and address, and links the partner, with the option", async () => {
    const calls: Call[] = [];
    const id = await syncWorksheetMirror(
      stubTransaction(calls, "customer-reg"),
      partner,
      {
        register: true,
      },
    );
    assert.equal(id, "customer-reg");
    const create = calls.find(
      (c) => c.table === "customer" && c.action === "create",
    )!.args.data as Record<string, unknown>;
    assert.match(String(create.customerNumber), /^PARTNER-/);
    assert.equal(create.type, "COMPANY");
    assert.equal(create.displayName, "Beszállító Kft.");
    assert.equal(create.taxNumber, "11111111-2-42");
    assert.equal(create.billingEmail, "szamla@beszallito.example");
    assert.ok("addresses" in create);
    const link = calls.find(
      (c) => c.table === "supplier" && c.action === "update",
    )!;
    assert.deepEqual(link.args.data, { customerId: "customer-reg" });
  });
});
