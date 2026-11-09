import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkRegister,
  requiredFieldKeys,
  schemaFieldKeys,
  uniqueFieldKeys,
  type AnonymizationRegister,
} from "../anonymization-register-check.js";
import { ANONYMIZATION_KINDS } from "../anonymization-register.js";
import { createPseudonymizer } from "./pseudonymizer.js";
import {
  assertTemporaryDatabase,
  runAnonymization,
  type Row,
  type RunnerDatabase,
  type RunnerOptions,
} from "./runner.js";
import { REQUIRED_SECTIONS } from "./verification-gate.js";

/*
  THE RUNNER (S5). WHAT TURNS THIS RED: a run against a database whose name is not a temporary anonymization name (and any
  reading before that refusal); a real value left in a column the transform keeps; a gate that passes without the working trial, or
  with a repeated fake in a unique column; a company's kept name or tax number taken for a leak (the dictionary holds natural
  persons only); dropped rows not accounted for in the counts; an aggregate that moved; a report that carries a real value; a row
  written back that did not change, or a changed one not written.
*/
const FIXTURE_SCHEMA = `
enum CustomerType {
  PERSON
  COMPANY
}

model Customer {
  id            String       @id @default(cuid())
  type          CustomerType
  displayName   String
  email         String?
  phone         String?
  taxNumber     String?
  iban          String?
  notes         String?
  loyaltyPoints Int
}

model User {
  id           String @id @default(cuid())
  displayName  String
  email        String @unique
  passwordHash String
}

model Session {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id])
  tokenHash String
}

model Order {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  note       String?
  total      Int
}

model AuditLog {
  id      String @id @default(cuid())
  action  String
  payload Json?
}
`;

const FIXTURE_REGISTER: AnonymizationRegister = {
  Customer: {
    displayName: "partyName",
    email: "email",
    phone: "phone",
    taxNumber: "partyTaxNumber",
    iban: "bankAccount",
    notes: "freeText",
  },
  User: {
    displayName: "personName",
    email: "email",
    passwordHash: "passwordHash",
  },
  Session: { tokenHash: "secret" },
  Order: { note: "freeText" },
  AuditLog: { action: "business", payload: "json" },
};

const checked = checkRegister(FIXTURE_SCHEMA, FIXTURE_REGISTER);

/** An in-memory database: tables of rows, the adapter's whole contract. */
class MemoryDatabase implements RunnerDatabase {
  readonly reads: string[] = [];
  constructor(
    readonly name: string,
    readonly tables: Record<string, Row[]>,
  ) {}
  models() {
    return Object.keys(this.tables);
  }
  async countRows(model: string) {
    return this.tables[model]!.length;
  }
  async *rows(model: string) {
    this.reads.push(model);
    for (const row of [...this.tables[model]!]) yield { ...row };
  }
  async replaceRow(model: string, original: Row, replacement: Row) {
    const index = this.tables[model]!.findIndex((r) => r.id === original.id);
    assert.ok(index >= 0);
    this.tables[model]![index] = { ...replacement };
  }
  async deleteRow(model: string, original: Row) {
    this.tables[model] = this.tables[model]!.filter(
      (r) => r.id !== original.id,
    );
  }
  async orphanCounts() {
    const users = new Set(this.tables.User!.map((u) => u.id));
    const customers = new Set(this.tables.Customer!.map((c) => c.id));
    return {
      "Session.userId -> User": this.tables.Session!.filter(
        (s) => !users.has(s.userId),
      ).length,
      "Order.customerId -> Customer": this.tables.Order!.filter(
        (o) => !customers.has(o.customerId),
      ).length,
    };
  }
  async invariants() {
    return {
      "customers PERSON": this.tables.Customer!.filter(
        (c) => c.type === "PERSON",
      ).length,
      "customers COMPANY": this.tables.Customer!.filter(
        (c) => c.type === "COMPANY",
      ).length,
      "loyalty points": this.tables.Customer!.reduce(
        (n, c) => n + (c.loyaltyPoints as number),
        0,
      ),
      "orders total": this.tables.Order!.reduce(
        (n, o) => n + (o.total as number),
        0,
      ),
    };
  }
  async correlations() {
    return {
      "orders with a customer": this.tables.Order!.filter((o) =>
        this.tables.Customer!.some((c) => c.id === o.customerId),
      ).length,
    };
  }
  async migrationsClean() {
    return true;
  }
  async healthOk() {
    return true;
  }
}

const REAL = {
  person: "Teszt Elek",
  personEmail: "teszt.elek@example.com",
  phone: "+36 30 123 4567",
  personalTaxId: "8123456789",
  iban: "HU42117730161111101800000000",
  company: "Példa Kft.",
  companyTax: "12345676-2-42",
  userEmail: "admin.valaki@example.com",
};

const source = (): Record<string, Row[]> => ({
  Customer: [
    {
      id: "c1",
      type: "PERSON",
      displayName: REAL.person,
      email: REAL.personEmail,
      phone: REAL.phone,
      taxNumber: REAL.personalTaxId,
      iban: REAL.iban,
      notes: `Hívja ${REAL.person}`,
      loyaltyPoints: 10,
    },
    {
      id: "c2",
      type: "COMPANY",
      displayName: REAL.company,
      email: "iroda@pelda.hu",
      phone: null,
      taxNumber: REAL.companyTax,
      iban: null,
      notes: null,
      loyaltyPoints: 5,
    },
  ],
  User: [
    {
      id: "u1",
      displayName: "Admin Valaki",
      email: REAL.userEmail,
      passwordHash: "valodi-hash",
    },
  ],
  Session: [
    { id: "s1", userId: "u1", tokenHash: "valodi-token" },
    { id: "s2", userId: "u1", tokenHash: "masik-token" },
  ],
  Order: [
    { id: "o1", customerId: "c1", note: `Átvette ${REAL.person}`, total: 1000 },
    { id: "o2", customerId: "c2", note: null, total: 2500 },
  ],
  AuditLog: [
    { id: "a1", action: "login", payload: { ok: 1, resetToken: "x" } },
  ],
});

const options = (
  database: RunnerDatabase,
  over: Partial<RunnerOptions> = {},
): RunnerOptions => ({
  database,
  decisions: checked.decisions,
  requiredFields: requiredFieldKeys(FIXTURE_SCHEMA),
  knownFields: schemaFieldKeys(FIXTURE_SCHEMA),
  uniqueFields: uniqueFieldKeys(FIXTURE_SCHEMA),
  pseudonymizationKey: "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
  scanKey: "proba-futas-kulcs-nem-valodi-0123456789-abcdef",
  stagePasswordHash: "stage-only-hash",
  trial: async () => ({ passed: true }),
  ...over,
});

const NAME = "stage_anon_tmp_20261109";

describe("the guard", () => {
  it("accepts only a temporary anonymization database name", () => {
    assertTemporaryDatabase("stage_anon_tmp_20261109");
    assertTemporaryDatabase("stage_anon_tmp_a");
    for (const refused of [
      "acropora",
      "acropora_stage",
      "production",
      "stage",
      "STAGE_ANON_TMP_1",
      "stage_anon_tmp_",
      "stage_anon_tmp_x-y",
      "xstage_anon_tmp_1",
      "stage_anon_tmp_1; drop",
      "",
    ]) {
      assert.throws(
        () => assertTemporaryDatabase(refused),
        /temporary database/,
        refused,
      );
    }
  });

  it("refuses before reading anything, and the message never repeats the name", async () => {
    const db = new MemoryDatabase("acropora_prod_secret_name", source());
    await assert.rejects(
      runAnonymization(options(db)),
      (error: Error) =>
        /temporary database/.test(error.message) &&
        !error.message.includes("acropora_prod"),
    );
    assert.deepEqual(db.reads, []);
  });
});

describe("a clean run", () => {
  it("replaces the personal values, drops the secret rows, keeps the business data, and the gate passes", async () => {
    const db = new MemoryDatabase(NAME, source());
    const result = await runAnonymization(options(db));
    assert.deepEqual(
      result.report.sections
        .filter((s) => !s.passed)
        .map((s) => [s.name, s.problems]),
      [],
    );
    assert.equal(result.swapAllowed, true);
    assert.equal(result.report.passed, true);
    const engine = createPseudonymizer(
      "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
    );
    const c1 = db.tables.Customer![0]!;
    assert.equal(c1.displayName, engine.personName(REAL.person));
    assert.equal(c1.email, engine.email(REAL.personEmail));
    assert.equal(c1.taxNumber, engine.personalTaxId(REAL.personalTaxId));
    assert.equal(c1.notes, `Hívja ${engine.personName(REAL.person)}`);
    assert.equal(c1.loyaltyPoints, 10);
    // the company keeps its name and tax number (the open decision), its e-mail goes
    const c2 = db.tables.Customer![1]!;
    assert.equal(c2.displayName, REAL.company);
    assert.equal(c2.taxNumber, REAL.companyTax);
    assert.equal(c2.email, engine.email("iroda@pelda.hu"));
    assert.equal(db.tables.User![0]!.passwordHash, "stage-only-hash");
    assert.deepEqual(db.tables.Session, []);
    assert.equal(
      db.tables.Order![0]!.note,
      `Átvette ${engine.personName(REAL.person)}`,
    );
    assert.deepEqual(db.tables.AuditLog![0]!.payload, { ok: 1 });
    assert.equal(result.rowsDropped, 2);
    assert.ok(result.rowsTransformed >= 5);
    assert.deepEqual(result.dictionarySizes, {
      email: 3,
      phone: 1,
      taxNumber: 1,
      iban: 1,
      name: 4,
    });
  });

  it("leaves no real value anywhere in the database, and none in the report", async () => {
    const db = new MemoryDatabase(NAME, source());
    const result = await runAnonymization(options(db));
    const everything = JSON.stringify(db.tables) + JSON.stringify(result);
    for (const real of [
      REAL.person,
      REAL.personEmail,
      "123 4567",
      REAL.personalTaxId,
      REAL.userEmail,
      "valodi-hash",
      "valodi-token",
      "resetToken",
    ]) {
      assert.ok(!everything.includes(real), real);
    }
  });

  it("accounts for the dropped rows in the counts, and an aggregate or a pairing never moves", async () => {
    const db = new MemoryDatabase(NAME, source());
    const result = await runAnonymization(options(db));
    const counts = result.report.sections.find((s) => s.name === "rowCounts")!;
    assert.deepEqual(counts, { name: "rowCounts", passed: true, problems: [] });
    for (const name of [
      "invariants",
      "correlations",
      "referentialIntegrity",
      "formats",
      "uniqueColumns",
    ]) {
      assert.equal(
        result.report.sections.find((s) => s.name === name)!.passed,
        true,
        name,
      );
    }
  });

  it("hands the gate every required section exactly once (no gateStructure problem), and the gate defaults need a sample of each format kind", async () => {
    const result = await runAnonymization(
      options(new MemoryDatabase(NAME, source())),
    );
    const names = result.report.sections.map((s) => s.name);
    for (const required of REQUIRED_SECTIONS)
      assert.equal(names.filter((n) => n === required).length, 1, required);
    assert.ok(!names.includes("gateStructure"));
  });

  it("fails the gate when a required format kind was never sampled (a source with no IBAN), and passes when the caller names a narrower list", async () => {
    const noIban = (): Record<string, Row[]> => ({
      ...source(),
      Customer: source().Customer!.map((row) => ({ ...row, iban: null })),
    });
    const refused = await runAnonymization(
      options(new MemoryDatabase(NAME, noIban())),
    );
    assert.equal(refused.swapAllowed, false);
    assert.deepEqual(
      refused.report.sections.find((s) => s.name === "formats")!.problems,
      ["iban: no sample was given, so nothing was checked"],
    );
    const narrowed = await runAnonymization(
      options(new MemoryDatabase(NAME, noIban()), {
        requiredFormatKinds: ["fakeEmail", "phone", "personalTaxId"],
      }),
    );
    assert.equal(narrowed.swapAllowed, true);
  });

  it("requires a company tax number sample only when the kinds table makes company fakes (while the company data is kept, none exist)", async () => {
    // the table as it stands: a company's tax number is KEPT, so the default list leaves companyTaxNumber out and the run passes
    assert.equal(ANONYMIZATION_KINDS.partyTaxNumber.action, "keep");
    const pseudonymizing = {
      ...ANONYMIZATION_KINDS,
      partyTaxNumber: {
        ...ANONYMIZATION_KINDS.partyTaxNumber,
        action: "pseudonymize" as const,
      },
    };
    const withCompany = await runAnonymization(
      options(new MemoryDatabase(NAME, source()), { kinds: pseudonymizing }),
    );
    assert.equal(
      withCompany.report.sections.find((s) => s.name === "formats")!.passed,
      true,
    );
    // no company row, so no company fake: the format check now names the kind
    const noCompany = await runAnonymization(
      options(
        new MemoryDatabase(NAME, {
          ...source(),
          Customer: source().Customer!.slice(0, 1),
          Order: source().Order!.slice(0, 1),
        }),
        { kinds: pseudonymizing },
      ),
    );
    assert.deepEqual(
      noCompany.report.sections.find((s) => s.name === "formats")!.problems,
      ["companyTaxNumber: no sample was given, so nothing was checked"],
    );
  });

  it("writes back only the rows that changed", async () => {
    const db = new MemoryDatabase(NAME, {
      ...source(),
      AuditLog: [{ id: "a2", action: "login", payload: null }],
    });
    const writes: string[] = [];
    const original = db.replaceRow.bind(db);
    db.replaceRow = async (model, row, replacement) => {
      writes.push(`${model}.${String(row.id)}`);
      await original(model, row, replacement);
    };
    await runAnonymization(options(db));
    assert.ok(!writes.includes("AuditLog.a2"));
    assert.ok(writes.includes("Customer.c1") && writes.includes("User.u1"));
  });
});

describe("the gate refuses", () => {
  it("does not pass without the working trial, or with a failed one", async () => {
    const none = await runAnonymization(
      options(new MemoryDatabase(NAME, source()), { trial: undefined }),
    );
    assert.equal(none.swapAllowed, false);
    assert.deepEqual(
      none.report.sections.find((s) => s.name === "workingTrial")!.problems,
      ["the working trial did not run"],
    );
    const failed = await runAnonymization(
      options(new MemoryDatabase(NAME, source()), {
        trial: async () => ({ passed: false }),
      }),
    );
    assert.equal(failed.swapAllowed, false);
  });

  it("finds a real value a kept column carries, naming the column and the kind", async () => {
    const tables = source();
    tables.AuditLog = [
      { id: "a1", action: `login: ${REAL.personEmail}`, payload: null },
    ];
    const result = await runAnonymization(
      options(new MemoryDatabase(NAME, tables)),
    );
    assert.equal(result.swapAllowed, false);
    const residual = result.report.sections.find(
      (s) => s.name === "residualPersonalData",
    )!;
    assert.deepEqual(residual.problems, [
      "AuditLog.action: 1 value(s) with a real email",
    ]);
    assert.ok(!JSON.stringify(result.report).includes(REAL.personEmail));
  });

  it("fails on a repeated fake in a unique column, naming the column", async () => {
    const real = createPseudonymizer(
      "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
    );
    const stub = { ...real, email: () => "ugyanaz@teszt.acropora.invalid" };
    const tables = source();
    tables.User = [
      ...tables.User!,
      {
        id: "u2",
        displayName: "Masik Valaki",
        email: "masik@example.com",
        passwordHash: "h2",
      },
    ];
    const result = await runAnonymization(
      options(new MemoryDatabase(NAME, tables), { engine: stub }),
    );
    assert.equal(result.swapAllowed, false);
    assert.deepEqual(
      result.report.sections.find((s) => s.name === "uniqueColumns")!.problems,
      ["User.email: 1 repeated fake value(s) in a unique column"],
    );
  });

  it("does not take a company's kept name or tax number for a leak (the dictionary holds natural persons only)", async () => {
    const result = await runAnonymization(
      options(new MemoryDatabase(NAME, source())),
    );
    assert.equal(
      result.report.sections.find((s) => s.name === "residualPersonalData")!
        .passed,
      true,
    );
    assert.ok(
      result.dictionarySizes.taxNumber === 1 &&
        result.dictionarySizes.name === 4,
    );
  });
});
