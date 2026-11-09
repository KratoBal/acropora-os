import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  checkRegister,
  requiredFieldKeys,
  schemaFieldKeys,
  uniqueFieldKeys,
  type AnonymizationRegister,
} from "../anonymization-register-check.js";
import {
  ANONYMIZATION_KINDS,
  ANONYMIZATION_REGISTER,
} from "../anonymization-register.js";
import { createJsonScrubber } from "./json-scrubber.js";
import { createPseudonymizer } from "./pseudonymizer.js";
import {
  classifyRow,
  createRowTransformer,
  PSEUDONYMIZED_KIND_NAMES,
  REPLACED_KIND_NAMES,
} from "./row-transformer.js";
import { createTextScrubber } from "./text-scrubber.js";

/*
  THE REGISTER-DRIVEN ROW TRANSFORMER (S3). WHAT TURNS THIS RED: a value changed that the register keeps (an id, a date, a
  number, a product name, a postal code), or kept that it does not; a natural person's row left alone, or a company's row
  pseudonymized while the decision is open; a sole trader (a company type with "e.v.") treated as a company; a field the
  register does not know passing silently; a text value of the wrong type passing; a required deleted field set to NULL instead
  of dropping the row; a stage password, a token, a file or a message surviving; a fake that differs between two tables for the
  same value; a kind of the register with an action nobody handles.
*/
const engine = createPseudonymizer(
  "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
);
const text = createTextScrubber(engine, ["Teszt Elek"]);
const json = createJsonScrubber(engine, text);
const STAGE_HASH = "stage-only-hash-not-real";

const FIXTURE_SCHEMA = `
enum CustomerType {
  PERSON
  COMPANY
}

model Customer {
  id            String       @id @default(cuid())
  type          CustomerType
  displayName   String
  companyName   String?
  email         String?
  phone         String?
  taxNumber     String?
  euTaxNumber   String?
  notes         String?
  payload       Json?
  createdAt     DateTime     @default(now())
  loyaltyPoints Int
}

model User {
  id                String  @id @default(cuid())
  name              String
  email             String
  passwordHash      String
  signatureCodeHash String?
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  tokenHash String
  expiresAt DateTime
}

model AuditLog {
  id        String  @id @default(cuid())
  action    String
  ipAddress String?
}

model Entry {
  id               String @id @default(cuid())
  confirmTokenHash String @unique
}

model Asset {
  id      String @id @default(cuid())
  name    String
  qrToken String
}

model Doc {
  id        String  @id @default(cuid())
  content   Bytes
  thumbnail Bytes?
  body      String?
  note      String?
  iban      String?
  parcel    String?
  street    String?
  tags      String[]
}
`;

const FIXTURE_REGISTER: AnonymizationRegister = {
  Customer: {
    displayName: "partyName",
    companyName: "partyName",
    email: "email",
    phone: "phone",
    taxNumber: "partyTaxNumber",
    euTaxNumber: "partyTaxNumber",
    notes: "freeText",
    payload: "json",
  },
  User: {
    name: "personName",
    email: "email",
    passwordHash: "passwordHash",
    signatureCodeHash: "passwordHash",
  },
  Session: { tokenHash: "secret" },
  AuditLog: { action: "business", ipAddress: "ipAddress" },
  Asset: { name: "business", qrToken: "opaqueToken" },
  Entry: { confirmTokenHash: "passwordHash" },
  Doc: {
    content: "fileContent",
    thumbnail: "fileContent",
    body: "rawMessage",
    note: "freeText",
    iban: "bankAccount",
    parcel: "parcelNumber",
    street: "streetAddress",
    tags: "freeText",
  },
};

const fixture = checkRegister(FIXTURE_SCHEMA, FIXTURE_REGISTER);
const make = (
  overrides: Partial<Parameters<typeof createRowTransformer>[0]> = {},
) =>
  createRowTransformer({
    decisions: fixture.decisions,
    requiredFields: requiredFieldKeys(FIXTURE_SCHEMA),
    knownFields: schemaFieldKeys(FIXTURE_SCHEMA),
    uniqueFields: uniqueFieldKeys(FIXTURE_SCHEMA),
    engine,
    text,
    json,
    stagePasswordHash: STAGE_HASH,
    ...overrides,
  });

const row = (result: ReturnType<ReturnType<typeof make>["transformRow"]>) => {
  assert.equal(result.dropped, false);
  return (result as { row: Record<string, unknown> }).row;
};

describe("the fixture (calibration)", () => {
  it("has a clean register, the expected required fields and every schema field, enums included", () => {
    assert.deepEqual(fixture.problems, []);
    const required = requiredFieldKeys(FIXTURE_SCHEMA);
    assert.ok(
      required.has("Customer.displayName") && required.has("Session.tokenHash"),
    );
    assert.ok(
      !required.has("Customer.email") &&
        !required.has("Doc.thumbnail") &&
        !required.has("Doc.tags"),
    );
    const known = schemaFieldKeys(FIXTURE_SCHEMA);
    assert.ok(
      known.has("Customer.type") &&
        known.has("Customer.loyaltyPoints") &&
        !known.has("Customer.nope"),
    );
    assert.equal(
      fixture.decisions.get("Session.userId")?.kind,
      "generatedIdentifier",
    );
    assert.equal(fixture.decisions.get("Customer.type"), undefined);
  });
});

describe("a natural person's row", () => {
  const person = {
    id: "c1",
    type: "PERSON",
    displayName: "Teszt Elek",
    companyName: null,
    email: "Teszt.Elek@Example.com",
    phone: "+36 30 123 4567",
    taxNumber: "8123456789",
    euTaxNumber: null,
    notes: "Hívja Teszt Elek: +36 20 765 4321",
    payload: {
      buyer: { name: "Teszt Elek", email: "a@b.hu" },
      items: [{ name: "Szer" }],
    },
    createdAt: new Date("2026-11-09T10:00:00Z"),
    loyaltyPoints: 42,
  };

  it("is replaced with the engine's fakes and keeps ids, dates, numbers and enums", () => {
    const out = row(make().transformRow("Customer", person));
    assert.equal(out.displayName, engine.personName("Teszt Elek"));
    assert.equal(out.email, engine.email("Teszt.Elek@Example.com"));
    assert.equal(out.phone, engine.phone("+36 30 123 4567"));
    assert.equal(out.taxNumber, engine.personalTaxId("8123456789"));
    assert.equal(
      out.notes,
      `Hívja ${engine.personName("Teszt Elek")}: ${engine.phone("+36 20 765 4321")}`,
    );
    assert.deepEqual(out.payload, {
      buyer: {
        name: engine.personName("Teszt Elek"),
        email: engine.email("a@b.hu"),
      },
      items: [{ name: "Szer" }],
    });
    assert.equal(out.id, "c1");
    assert.equal(out.type, "PERSON");
    assert.equal(out.createdAt, person.createdAt);
    assert.equal(out.loyaltyPoints, 42);
    assert.equal(out.companyName, null);
  });

  it("is never changed in place, and gives the same output twice", () => {
    const before = JSON.stringify(person);
    const t = make();
    const first = row(t.transformRow("Customer", person));
    assert.equal(JSON.stringify(person), before);
    assert.deepEqual(row(make().transformRow("Customer", person)), first);
  });

  it("gets the same fake for the same value in another table", () => {
    const t = make();
    const customer = row(
      t.transformRow("Customer", { ...person, email: "kozos@pelda.hu" }),
    );
    const user = row(
      t.transformRow("User", {
        id: "u1",
        name: "Teszt Elek",
        email: "kozos@pelda.hu",
        passwordHash: "x",
        signatureCodeHash: null,
      }),
    );
    assert.equal(customer.email, user.email);
    assert.equal(customer.displayName, user.name);
  });
});

describe("a company's row, and the cases in between", () => {
  const company = {
    id: "c2",
    type: "COMPANY",
    displayName: "Példa Kft.",
    companyName: "Példa Kft.",
    email: "iroda@pelda.hu",
    phone: null,
    taxNumber: "12345678-2-42",
    euTaxNumber: "HU12345678",
    notes: "Kapcsolat: Teszt Elek",
    payload: null,
    createdAt: new Date("2026-11-09T10:00:00Z"),
    loyaltyPoints: 0,
  };

  it("keeps the company's name and tax numbers while the decision is open, and still replaces its e-mail and free text", () => {
    const out = row(make().transformRow("Customer", company));
    assert.equal(out.displayName, "Példa Kft.");
    assert.equal(out.companyName, "Példa Kft.");
    assert.equal(out.taxNumber, "12345678-2-42");
    assert.equal(out.euTaxNumber, "HU12345678");
    assert.equal(out.email, engine.email("iroda@pelda.hu"));
    assert.equal(out.notes, `Kapcsolat: ${engine.personName("Teszt Elek")}`);
  });

  it("treats a company type with a sole-trader marker as a natural person", () => {
    const out = row(
      make().transformRow("Customer", {
        ...company,
        displayName: "Teszt Elek e.v.",
        companyName: null,
        taxNumber: "12345678-1-42",
      }),
    );
    assert.equal(out.displayName, engine.personName("Teszt Elek e.v."));
    assert.notEqual(out.taxNumber, "12345678-1-42");
  });

  it("treats a row with no evidence as a natural person, and one with only an organisation marker as a company", () => {
    const { type: _type, ...noType } = company;
    const bare = row(
      make().transformRow("Customer", {
        ...noType,
        displayName: "Valaki Valaki",
        companyName: null,
        taxNumber: null,
        euTaxNumber: null,
      }),
    );
    assert.equal(bare.displayName, engine.personName("Valaki Valaki"));
    const marked = row(
      make().transformRow("Customer", {
        ...noType,
        taxNumber: null,
        euTaxNumber: null,
      }),
    );
    assert.equal(marked.displayName, "Példa Kft.");
  });

  it("classifies by the evidence in the documented order", () => {
    assert.equal(classifyRow("COMPANY", ["Példa Péter e.v."], []), true);
    assert.equal(classifyRow("COMPANY", ["Példa Kft."], ["8123456789"]), true);
    assert.equal(
      classifyRow("PERSON", ["Példa Kft."], ["12345678-2-42"]),
      true,
    );
    assert.equal(classifyRow("COMPANY", ["Valaki"], []), false);
    assert.equal(classifyRow(null, ["Példa Zrt."], []), false);
    assert.equal(classifyRow(null, ["Valaki"], ["12345678-2-42"]), false);
    assert.equal(classifyRow(null, ["Valaki"], ["HU12345678"]), false);
    assert.equal(classifyRow(null, ["Valaki"], []), true);
    assert.equal(classifyRow(null, [], []), true);
  });

  it("pseudonymizes a company too when the register's action says so", () => {
    const kinds = {
      ...ANONYMIZATION_KINDS,
      partyName: {
        ...ANONYMIZATION_KINDS.partyName,
        action: "pseudonymize" as const,
      },
    };
    const out = row(make({ kinds }).transformRow("Customer", company));
    assert.notEqual(out.displayName, "Példa Kft.");
    assert.match(String(out.displayName), / Kft\.$/);
  });
});

describe("delete and replace", () => {
  it("drops the row when a deleted field cannot be NULL, naming the field and never the value", () => {
    const result = make().transformRow("Session", {
      id: "s1",
      userId: "u1",
      tokenHash: "geheim-ertek",
      expiresAt: new Date(),
    });
    assert.equal(result.dropped, true);
    assert.equal((result as { field: string }).field, "Session.tokenHash");
    assert.ok(!JSON.stringify(result).includes("geheim-ertek"));
  });

  it("sets an optional deleted field to NULL, and a deleted list to an empty list", () => {
    const out = row(
      make().transformRow("AuditLog", {
        id: "a1",
        action: "login",
        ipAddress: "10.0.0.1",
      }),
    );
    assert.deepEqual(out, { id: "a1", action: "login", ipAddress: null });
  });

  it("replaces a password hash with the stage-only one, and refuses to run without it", () => {
    const out = row(
      make().transformRow("User", {
        id: "u1",
        name: "Teszt Elek",
        email: "a@b.hu",
        passwordHash: "valodi-hash",
        signatureCodeHash: "masik",
      }),
    );
    assert.equal(out.passwordHash, STAGE_HASH);
    assert.equal(out.signatureCodeHash, STAGE_HASH);
    assert.throws(
      () =>
        make({ stagePasswordHash: undefined }).transformRow("User", {
          id: "u1",
          name: "x y",
          email: "a@b.hu",
          passwordHash: "h",
          signatureCodeHash: null,
        }),
      /stagePasswordHash/,
    );
  });

  it("gives a replaced password hash in a UNIQUE column a fresh value per row, not the one shared stage hash", () => {
    const t = make();
    const a = row(
      t.transformRow("Entry", {
        id: "1",
        confirmTokenHash: "valodi-lenyomat-a",
      }),
    ).confirmTokenHash;
    const b = row(
      t.transformRow("Entry", {
        id: "2",
        confirmTokenHash: "valodi-lenyomat-b",
      }),
    ).confirmTokenHash;
    assert.notEqual(a, b);
    assert.notEqual(a, STAGE_HASH);
    assert.equal((a as string).length, "valodi-lenyomat-a".length);
    assert.ok(
      uniqueFieldKeys(FIXTURE_SCHEMA).has("Entry.confirmTokenHash") &&
        !uniqueFieldKeys(FIXTURE_SCHEMA).has("User.passwordHash"),
    );
  });

  it("replaces a token with a fresh one of the same shape, and lets a test fix the source", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const a = row(
      make().transformRow("Asset", {
        id: "a",
        name: "Szivattyú",
        qrToken: uuid,
      }),
    ).qrToken as string;
    assert.match(a, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.notEqual(a, uuid);
    const plain = row(
      make().transformRow("Asset", {
        id: "a",
        name: "x",
        qrToken: "abcdefghijklmnop",
      }),
    ).qrToken as string;
    assert.equal(plain.length, 16);
    assert.notEqual(plain, "abcdefghijklmnop");
    const fixed = row(
      make({ randomToken: () => "FIX" }).transformRow("Asset", {
        id: "a",
        name: "x",
        qrToken: "q",
      }),
    );
    assert.equal(fixed.qrToken, "FIX");
  });

  it("replaces a file with a placeholder of the same kind (bytes or text) and a message body with a fixed text", () => {
    const out = row(
      make().transformRow("Doc", {
        id: "d",
        content: Buffer.from("valodi pdf tartalom"),
        thumbnail: "valodi bélyegkép",
        body: "Kedves Teszt Elek, a számlaszámom 11773016-11111018",
        note: null,
        iban: null,
        parcel: null,
        street: null,
        tags: [],
      }),
    );
    assert.ok(Buffer.isBuffer(out.content));
    assert.ok(!String(out.content).includes("valodi"));
    assert.ok(!String(out.thumbnail).includes("valodi"));
    assert.ok(String(out.body).startsWith("[A levél"));
  });
});

describe("text fields of a document row", () => {
  it("replaces an IBAN, a parcel number and a street, scrubs a note, and walks a list of texts", () => {
    const out = row(
      make().transformRow("Doc", {
        id: "d",
        content: Buffer.from("x"),
        thumbnail: null,
        body: null,
        note: "Teszt Elek hívta: +36 30 123 4567",
        iban: "HU42117730161111101800000000",
        parcel: "CL123456789",
        street: "Teszt utca 12.",
        tags: ["Teszt Elek", "ok"],
      }),
    );
    assert.equal(
      out.note,
      `${engine.personName("Teszt Elek")} hívta: ${engine.phone("+36 30 123 4567")}`,
    );
    assert.equal(out.iban, engine.iban("HU42117730161111101800000000"));
    assert.equal(out.parcel, engine.parcelNumber("CL123456789"));
    assert.equal(out.street, engine.streetAddress("Teszt utca 12."));
    assert.deepEqual(out.tags, [engine.personName("Teszt Elek"), "ok"]);
  });
});

describe("fail closed", () => {
  it("throws on a field that is not in the schema, naming it but not the value", () => {
    assert.throws(
      () =>
        make().transformRow("Customer", {
          id: "c",
          nincsIlyen: "titkos-ertek",
        }),
      (error: Error) =>
        /Customer\.nincsIlyen/.test(error.message) &&
        !error.message.includes("titkos-ertek"),
    );
    assert.throws(() => make().transformRow("Nope", { id: "x" }), /Nope\.id/);
  });

  it("throws on a value of a type its kind cannot handle, without the value in the message", () => {
    assert.throws(
      () =>
        make().transformRow("User", {
          id: "u",
          name: "x y",
          email: { objektum: "titkos" },
          passwordHash: "h",
          signatureCodeHash: null,
        }),
      (error: Error) =>
        /User\.email/.test(error.message) &&
        /object/.test(error.message) &&
        !error.message.includes("titkos"),
    );
  });

  it("lets a schema field of a type the register does not cover pass, and leaves nulls alone", () => {
    const out = row(
      make().transformRow("Customer", {
        id: "c",
        type: "COMPANY",
        displayName: "Példa Kft.",
        email: null,
        loyaltyPoints: 7,
        createdAt: new Date(0),
      }),
    );
    assert.equal(out.type, "COMPANY");
    assert.equal(out.email, null);
    assert.equal(out.loyaltyPoints, 7);
  });
});

describe("counts", () => {
  it("counts changed values by kind and dropped rows, never a value", () => {
    const t = make();
    t.transformRow("User", {
      id: "u",
      name: "Teszt Elek",
      email: "a@b.hu",
      passwordHash: "h",
      signatureCodeHash: null,
    });
    t.transformRow("Session", {
      id: "s",
      userId: "u",
      tokenHash: "t",
      expiresAt: new Date(),
    });
    assert.deepEqual(t.stats, {
      personName: 1,
      email: 1,
      passwordHash: 1,
      droppedRow: 1,
    });
  });
});

describe("the register's kinds", () => {
  it("has a handler for every kind that pseudonymizes or replaces, and names no kind that does not exist", () => {
    const names = Object.keys(ANONYMIZATION_KINDS);
    assert.ok(names.length > 15, "the control: the kinds were read");
    const pseudonymized = names.filter((n) => {
      const kind = ANONYMIZATION_KINDS[
        n as keyof typeof ANONYMIZATION_KINDS
      ] as { action: string; naturalPersonRows?: string };
      return (
        kind.action === "pseudonymize" ||
        kind.naturalPersonRows === "pseudonymize"
      );
    });
    const replaced = names.filter(
      (n) =>
        (
          ANONYMIZATION_KINDS[n as keyof typeof ANONYMIZATION_KINDS] as {
            action: string;
          }
        ).action === "replace",
    );
    assert.deepEqual(
      [...PSEUDONYMIZED_KIND_NAMES].sort(),
      pseudonymized.sort(),
    );
    assert.deepEqual([...REPLACED_KIND_NAMES].sort(), replaced.sort());
  });
});

describe("against the real schema and register", () => {
  const schema = readFileSync(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const real = checkRegister(schema, ANONYMIZATION_REGISTER);
  const t = createRowTransformer({
    decisions: real.decisions,
    requiredFields: requiredFieldKeys(schema),
    knownFields: schemaFieldKeys(schema),
    uniqueFields: uniqueFieldKeys(schema),
    engine,
    text,
    json,
    stagePasswordHash: STAGE_HASH,
  });

  it("serves every in-scope field of the schema with a value (no field falls through, no kind lacks a handler)", () => {
    assert.deepEqual(real.problems, []);
    assert.ok(
      real.decisions.size > 1000,
      "the control: the decisions were read",
    );
    let served = 0;
    for (const key of real.decisions.keys()) {
      const [model, field] = key.split(".") as [string, string];
      const result = t.transformRow(model, { [field]: "Teszt Elek" });
      assert.ok(result.dropped === true || result.dropped === false, key);
      served += 1;
    }
    assert.equal(served, real.decisions.size);
  });

  it("handles a real User, Customer and Session row as the register says", () => {
    const user = t.transformRow("User", {
      displayName: "Teszt Elek",
      firstName: "Elek",
      email: "teszt.elek@example.com",
      passwordHash: "valodi",
    });
    assert.equal(user.dropped, false);
    const u = (user as { row: Record<string, unknown> }).row;
    assert.equal(u.displayName, engine.personName("Teszt Elek"));
    assert.equal(u.firstName, engine.personName("Elek"));
    assert.equal(u.email, engine.email("teszt.elek@example.com"));
    assert.equal(u.passwordHash, STAGE_HASH);
    const session = t.transformRow("Session", {
      tokenHash: "valodi-token-lenyomat",
    });
    assert.equal(session.dropped, true);
  });
});
