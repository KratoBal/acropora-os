import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  checkRegister,
  parseSchemaModels,
  type AnonymizationRegister,
} from "./anonymization-register-check.js";
import {
  ANONYMIZATION_KINDS,
  ANONYMIZATION_REGISTER,
} from "./anonymization-register.js";

const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("anonymization register against prisma/schema.prisma", () => {
  const result = checkRegister(schema, ANONYMIZATION_REGISTER);

  /**
   * THE GUARD. A new String, Json or Bytes column without a decision lands
   * here, with its model, field and schema line in the message.
   */
  it("decides every text, JSON and binary field exactly once", () => {
    assert.deepEqual(result.problems, []);
    assert.equal(result.decisions.size, result.inScopeFieldCount);
  });

  /**
   * An empty world also has no unclassified field. These two counts are taken
   * with plain regular expressions over the file, independently of the
   * parser, so a parser that skipped models or fields cannot pass as a clean
   * register.
   */
  it("sees every model and every in-scope field the file declares", () => {
    const modelCount = schema.match(/^model \w+ \{/gm)?.length ?? 0;
    const fieldCount =
      schema.match(
        /^[ \t]+\w+[ \t]+(String|Json|Bytes|Unsupported\("[^"]*"\))(\[\])?\??([ \t]|$)/gm,
      )?.length ?? 0;

    assert.equal(parseSchemaModels(schema).length, modelCount);
    assert.equal(result.inScopeFieldCount, fieldCount);
    assert.ok(fieldCount > 1000, `only ${fieldCount} fields found`);
  });

  it("keeps the open company-data decision visible on its kinds", () => {
    const pending = Object.entries(ANONYMIZATION_KINDS)
      .filter(([, kind]) => "pendingDecision" in kind)
      .map(([name]) => name)
      .sort();
    assert.deepEqual(pending, ["partyName", "partyTaxNumber"]);
  });
});

/**
 * The checker on small schemas, so each failure mode is shown to be caught
 * on its own rather than only "nothing reported" on the real schema.
 */
describe("anonymization register check", () => {
  const base = `
model Customer {
  id    String @id @default(cuid())
  email String
  note  String?
  score Int
}

model Order {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
}
`;
  const complete: AnonymizationRegister = {
    Customer: { email: "email", note: "freeText" },
  };

  it("accepts a complete register", () => {
    const result = checkRegister(base, complete);
    assert.deepEqual(result.problems, []);
    assert.equal(result.inScopeFieldCount, 5);
    assert.deepEqual(result.decisions.get("Order.customerId"), {
      kind: "generatedIdentifier",
      source: { by: "foreign-key", references: "Customer.id" },
    });
  });

  it("reports a field without a decision", () => {
    const result = checkRegister(base, { Customer: { email: "email" } });
    assert.equal(result.problems.length, 1);
    assert.match(
      result.problems[0] ?? "",
      /^Customer\.note \(String, schema\.prisma:5\) has no anonymization decision$/,
    );
  });

  it("reports rows that point to a missing model, a missing field or a non-text field", () => {
    const result = checkRegister(base, {
      ...complete,
      Customer: {
        ...complete.Customer,
        nickname: "personName",
        score: "business",
      },
      Invoice: { number: "identifier" },
    });
    assert.deepEqual(result.problems, [
      "register row for Customer.nickname, which does not exist",
      "register row for Customer.score, which is Int, not a text, JSON or binary field",
      "register row for model Invoice, which does not exist",
    ]);
  });

  it("reports a row for a field a structural rule already decides", () => {
    const result = checkRegister(base, {
      Customer: { ...complete.Customer, id: "identifier" },
      Order: { customerId: "identifier" },
    });
    assert.deepEqual(result.problems, [
      "Customer.id is decided twice: it is a generated @id, and it also has a register row",
      "Order.customerId is decided twice: it is a foreign key to Customer.id, and it also has a register row",
    ]);
  });

  /**
   * A foreign key to a natural key carries the referenced value, so it must
   * be treated like that value, not like an opaque id.
   */
  it("lets a foreign key inherit the decision of a natural key", () => {
    const result = checkRegister(
      `
model Person {
  email String @id
}

model Visit {
  id          String @id @default(uuid())
  personEmail String
  person      Person @relation(fields: [personEmail], references: [email], onDelete: Cascade)
}
`,
      { Person: { email: "email" } },
    );
    assert.deepEqual(result.problems, []);
    assert.equal(result.decisions.get("Visit.personEmail")?.kind, "email");
  });

  it("does not keep an @id that is not generated by the database", () => {
    const result = checkRegister("model Setting {\n  id String @id\n}\n", {});
    assert.deepEqual(result.problems, [
      "Setting.id (String, schema.prisma:2) has no anonymization decision",
    ]);
  });

  it("does not keep a non-id field just because it has a generated default", () => {
    const result = checkRegister(
      "model Link {\n  id    String @id @default(cuid())\n  token String @unique @default(uuid())\n}\n",
      {},
    );
    assert.deepEqual(result.problems, [
      "Link.token (String, schema.prisma:3) has no anonymization decision",
    ]);
  });

  it("counts lists, JSON, bytes and unsupported types as in scope", () => {
    const result = checkRegister(
      `
model Doc {
  id     String                   @id @default(cuid())
  tags   String[]
  data   Json?
  file   Bytes
  search Unsupported("tsvector")? @default(dbgenerated())
  size   Int
}
`,
      {},
    );
    assert.equal(result.inScopeFieldCount, 5);
    assert.equal(result.problems.length, 4);
  });

  it("skips comments, including block comments and // inside a string", () => {
    const models = parseSchemaModels(`
model Page {
  /**
   * url String
   */
  // title String
  /// note String
  id  String @id @default(cuid())
  url String @default("https://example.invalid") // a comment
  @@index([url])
}
`);
    assert.deepEqual(
      models[0]?.fields.map((field) => [field.name, field.attributes]),
      [
        ["id", "@id @default(cuid())"],
        ["url", '@default("https://example.invalid")'],
      ],
    );
  });

  it("refuses a top-level block it does not know", () => {
    assert.throws(
      () => parseSchemaModels("view CustomerView {\n  email String\n}\n"),
      /unknown block "view CustomerView"/,
    );
  });

  it("refuses a line inside a model it cannot read as a field", () => {
    assert.throws(
      () => parseSchemaModels("model Broken {\n  email: String\n}\n"),
      /schema\.prisma:2: cannot read this line as a field/,
    );
  });
});
