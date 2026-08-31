import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import {
  partnerScopeOf,
  rowBelongsToScope,
  rowIsScopeOwner,
  scopeMaySeeDocumentType,
  scopeWhereForAndBranch,
} from "./partner-scope.util.js";

const user = (over: Partial<AuthenticatedUser>): AuthenticatedUser =>
  ({
    id: "u1",
    email: "a@b.hu",
    displayName: "A",
    role: "VIEWER",
    customerId: null,
    supplierId: null,
    ...over,
  }) as AuthenticatedUser;

describe("partnerScopeOf", () => {
  it("partner-kötés nélkül BELSŐS, tehát mindent lát", () => {
    assert.deepEqual(partnerScopeOf(user({})), { kind: "internal" });
  });

  it("vevő-kötésből customer hatókör lesz", () => {
    assert.deepEqual(partnerScopeOf(user({ customerId: "c1" })), {
      kind: "customer",
      customerId: "c1",
    });
  });

  it("szállító-kötésből supplier hatókör lesz", () => {
    assert.deepEqual(partnerScopeOf(user({ supplierId: "s1" })), {
      kind: "supplier",
      supplierId: "s1",
    });
  });

  /**
   * A KETTOS KOTES NEM VALASZTAS KERDESE. Ha valamelyiket valasztanank, a masik
   * fel adatat mutatnank meg egy olyan felhasznalonak, akirol nem tudjuk,
   * melyik oldalon all. Ezert dob, es nem donti el.
   */
  it("mindkét kötés esetén DOB, nem választ", () => {
    assert.throws(
      () => partnerScopeOf(user({ customerId: "c1", supplierId: "s1" })),
      /hatóköre/,
    );
  });
});

describe("rowBelongsToScope", () => {
  it("belsős kérőnek minden sor a sajátja", () => {
    const scope = { kind: "internal" } as const;
    assert.equal(rowBelongsToScope({ customerId: "c1" }, scope), true);
    assert.equal(rowBelongsToScope({ supplierId: "s9" }, scope), true);
    assert.equal(rowBelongsToScope({}, scope), true);
  });

  it("vevő csak a saját sorát látja", () => {
    const scope = { kind: "customer", customerId: "c1" } as const;
    assert.equal(rowBelongsToScope({ customerId: "c1" }, scope), true);
    assert.equal(rowBelongsToScope({ customerId: "c2" }, scope), false);
  });

  it("szállító csak a sajátját, és a vevő-oldali kötés nem nyitja meg", () => {
    const scope = { kind: "supplier", supplierId: "s1" } as const;
    assert.equal(rowBelongsToScope({ supplierId: "s1" }, scope), true);
    assert.equal(rowBelongsToScope({ supplierId: "s2" }, scope), false);
    assert.equal(rowBelongsToScope({ customerId: "s1" }, scope), false);
  });

  /**
   * EZ A LEGFONTOSABB ESET. Egy hianyzo tulajdonos NEM szabad kapu: ha a NULL
   * atengedne, akkor egy tulajdonos nelkuli sor MINDEN partnernek latszana, ami
   * pont forditva van, mint amit egy hianyzo ertektol varnank.
   */
  it("a NULL tulajdonos NEM szabad kapu", () => {
    assert.equal(
      rowBelongsToScope(
        { customerId: null },
        { kind: "customer", customerId: "c1" },
      ),
      false,
    );
    assert.equal(
      rowBelongsToScope({}, { kind: "customer", customerId: "c1" }),
      false,
    );
    assert.equal(
      rowBelongsToScope(
        { supplierId: null },
        { kind: "supplier", supplierId: "s1" },
      ),
      false,
    );
    assert.equal(
      rowBelongsToScope({}, { kind: "supplier", supplierId: "s1" }),
      false,
    );
  });
});

describe("rowIsScopeOwner", () => {
  it("belsős kérőnek minden partner látszik", () => {
    assert.equal(
      rowIsScopeOwner({ id: "s1" }, { kind: "internal" }, "supplier"),
      true,
    );
  });

  it("a szállító a saját sorát látja, másét nem", () => {
    const scope = { kind: "supplier", supplierId: "s1" } as const;
    assert.equal(rowIsScopeOwner({ id: "s1" }, scope, "supplier"), true);
    assert.equal(rowIsScopeOwner({ id: "s2" }, scope, "supplier"), false);
  });

  /** DÖNTÉS, nem mérés: a két oldal nem lát át egymáshoz. Lásd a helper jegyzetét. */
  it("a vevő NEM látja a szállítót, még azonos azonosító mellett sem", () => {
    assert.equal(
      rowIsScopeOwner(
        { id: "x" },
        { kind: "customer", customerId: "x" },
        "supplier",
      ),
      false,
    );
    assert.equal(
      rowIsScopeOwner(
        { id: "x" },
        { kind: "supplier", supplierId: "x" },
        "customer",
      ),
      false,
    );
  });
});

describe("scopeMaySeeDocumentType", () => {
  const partner = { kind: "customer", customerId: "c1" } as const;

  it("belsős kérő minden típust lát", () => {
    for (const t of ["INVOICE", "WARRANTY", "MANUAL", "OTHER"] as const) {
      assert.equal(scopeMaySeeDocumentType(t, { kind: "internal" }), true);
    }
  });

  /** Balázs döntése, szó szerint: „szamlat nem". */
  it("a partner a SAJÁT eszközén sem látja a számlát", () => {
    assert.equal(scopeMaySeeDocumentType("INVOICE", partner), false);
  });

  it("garancia és kézikönyv látható", () => {
    assert.equal(scopeMaySeeDocumentType("WARRANTY", partner), true);
    assert.equal(scopeMaySeeDocumentType("MANUAL", partner), true);
  });

  /** Az OTHER definíció szerint az, amit nem soroltak be: nincs róla állításunk. */
  it("az OTHER alapból NEM látható", () => {
    assert.equal(scopeMaySeeDocumentType("OTHER", partner), false);
  });
});

describe("scopeWhereForAndBranch", () => {
  it("belsős kérőnél üres feltétel: nem szűkít semmit", () => {
    assert.deepEqual(scopeWhereForAndBranch({ kind: "internal" }), {});
  });

  it("vevőnél a customerId, szállítónál a supplierId kerül bele", () => {
    assert.deepEqual(
      scopeWhereForAndBranch({ kind: "customer", customerId: "c1" }),
      {
        customerId: "c1",
      },
    );
    assert.deepEqual(
      scopeWhereForAndBranch({ kind: "supplier", supplierId: "s1" }),
      {
        supplierId: "s1",
      },
    );
  });

  /**
   * A visszaadott objektum CSAK a hatokort tartalmazza. Ha valaha tobbet adna
   * vissza, egy AND-agban az is feltetelle valna, amit senki nem kert.
   */
  it("csak a hatókört adja vissza, semmi mást", () => {
    assert.deepEqual(
      Object.keys(
        scopeWhereForAndBranch({ kind: "customer", customerId: "c1" }),
      ),
      ["customerId"],
    );
  });
});
