import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  MedusaBrandImportRefusedError,
  type MedusaBrandImportService,
} from "./medusa-brand-import.service.js";
import type { OurBrand } from "./medusa-brand-plan.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { runBrandCli, describeBrandVerification } from "./medusa-brand.cli.js";

const brand: OurBrand = {
  id: "brand-1",
  name: "Tunze",
  slug: "tunze",
  isActive: true,
  archivedAt: null,
};

const URES_TERV = {
  create: [],
  mapOnly: [],
  skip: [],
  staleMapping: [],
  conflict: [],
  skipArchived: [],
};

function harness(
  input: {
    plan?: unknown;
    report?: unknown;
    refuse?: string;
    credentialError?: boolean;
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];

  const service = {
    plan: async () => {
      calls.push("plan");
      if (input.refuse) throw new MedusaBrandImportRefusedError(input.refuse);
      return input.plan ?? URES_TERV;
    },
    run: async () => {
      calls.push("run");
      if (input.refuse) throw new MedusaBrandImportRefusedError(input.refuse);
      return (
        input.report ?? {
          created: 1,
          linkedOnly: 0,
          relinked: 0,
          skipped: 0,
          skippedArchived: [],
          conflicts: [],
          verification: {
            carryingOurId: 1,
            mappingRowsHere: 1,
            expected: 1,
          },
        }
      );
    },
  } as unknown as MedusaBrandImportService;

  return {
    stdout,
    stderr,
    calls,
    run: (argv: readonly string[]) =>
      runBrandCli(
        argv,
        {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        },
        {
          client: async () => {
            if (input.credentialError)
              throw new MedusaConnectionError(
                "MEDUSA_CONNECTION_NOT_CONFIGURED",
              );
            return {} as MedusaAdminClient;
          },
          brands: async () => [brand],
          service: () => service,
          now: () => new Date("2026-09-04T03:00:00.000Z"),
        },
      ),
  };
}

describe("runBrandCli", () => {
  /**
   * EZ AZ ALLITAS AZ EGESZ PARANCS LETEZESENEK OKA.
   *
   * Az `--apply` nelkuli futas utan CSAK TUDAS marad. Ha az alapertelmezes
   * irna, egy "megnezem, mit csinalna" szandeku futas gyujtemenyeket hozna
   * letre egy kulso rendszerben -- es a hivas sikerrel terne vissza.
   *
   * Ezert a `run` HIVASANAK HIANYAT allitjuk, nem a kimenet szoveget: egy
   * szoveg-allitas akkor is zold maradna, ha a betoltes kozben lefut.
   */
  it("--apply nelkul CSAK tervez, es a betoltest el sem inditja", async () => {
    const h = harness();

    const code = await h.run([]);

    assert.equal(code, 0);
    assert.deepEqual(h.calls, ["plan"]);
    assert.ok(h.stdout.join("").includes("semmit nem írt"));
  });

  it("--apply hatasara lefut a betoltes", async () => {
    const h = harness();

    const code = await h.run(["--apply"]);

    assert.equal(code, 0);
    assert.ok(h.calls.includes("run"));
  });

  /**
   * AZ UTKOZES NEM BUKAS, DE NEM IS SIKER. A futas tobbi resze lement; az
   * utkozes ember dontese. Ezert 2, es ezert nem 0 vagy 1.
   */
  it("utkozesnel 2-vel lep ki, nem 0-val es nem 1-gyel", async () => {
    const h = harness({
      report: {
        created: 0,
        linkedOnly: 0,
        relinked: 0,
        skipped: 0,
        skippedArchived: [],
        conflicts: ["brand-1"],
        verification: { carryingOurId: 0, mappingRowsHere: 0, expected: 1 },
      },
    });

    assert.equal(await h.run(["--apply"]), 2);
  });

  it("a megtagadast a stderr-re irja, es 1-gyel lep ki", async () => {
    const h = harness({ refuse: "a lista csonkolt" });

    const code = await h.run(["--apply"]);

    assert.equal(code, 1);
    assert.ok(h.stderr.join("").includes("csonkolt"));
    assert.deepEqual(h.stdout, []);
  });

  it("hitelesitesi hibanal meg a markakat sem kerdezi le", async () => {
    const h = harness({ credentialError: true });

    const code = await h.run(["--apply"]);

    assert.equal(code, 1);
    assert.deepEqual(h.calls, []);
  });
});

describe("describeBrandVerification", () => {
  it("kimondja az iteletet, ha a ket szam egyezik", () => {
    const sor = describeBrandVerification({
      carryingOurId: 3,
      mappingRowsHere: 3,
      expected: 3,
    });

    assert.ok(sor.includes("A két szám egyezik."));
  });

  /**
   * A HIANYZO LEKEPEZES-SOR A NEMA HIBA: a gyujtemeny all a Medusan, a marka
   * megis kimarad a vetitesbol, es semmi nem szol rola. Ezert a mondat NEM azt
   * mondja, hogy "eltérés", hanem megnevezi a KOVETKEZMENYT.
   */
  it("megnevezi a kovetkezmenyt, ha nalunk kevesebb lekepezes-sor all", () => {
    const sor = describeBrandVerification({
      carryingOurId: 3,
      mappingRowsHere: 1,
      expected: 3,
    });

    assert.ok(!sor.includes("A két szám egyezik."));
    assert.ok(sor.includes("gyűjtemény nélkül menne ki"));
  });
});
