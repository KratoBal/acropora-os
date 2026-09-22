import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";
import type { CreateServiceJobDto } from "./dto.js";

/**
 * IDEGEN HELYSZINRE NEM LEHET HIBAJEGYET NYITNI.
 *
 * Balazs dontese, 2026-09-22: a helyszin-lista a kiosztott helyszinekre
 * szukul, ES "idegen helyszinre nem is tud jegyet nyitni". A masodik fele
 * KULON allitas: a valaszto szukitese onmagaban csak a FELULETET zarja, egy
 * kozvetlen hivas atmenne rajta.
 *
 * A HARMADIK ALLITAS ITT A LEGFONTOSABB: a belsos felhasznalot NEM zarja ki.
 * A belsos fiokok NULLA hozzarendelessel dolgoznak (elesben mind a hat ilyen),
 * tehat egy hatokor nelkuli szukites a SAJAT szerelonket zarna ki mindenhonnan
 * -- vagyis a rendszer nalunk allna meg, nem a partnernel.
 */

const HELYSZIN = "unit-kro";
const UGYFEL = "customer-1";

function serviceWith(assignedUnitIds: string[]) {
  const hivasok: string[] = [];
  const repository = {
    byClientOperationId: async () => null,
    lastNumberOfYear: async () => null,
    departmentBelongsToCustomer: async () => true,
    assignedUnitIds: async () => {
      hivasok.push("assignedUnitIds");
      return assignedUnitIds;
    },
    create: async () => {
      hivasok.push("create");
      return { id: "job-1" } as never;
    },
  };
  return {
    hivasok,
    service: new ServiceJobsService(
      repository as unknown as ServiceJobsRepository,
    ),
  };
}

const bemenet = {
  title: "Szivattyú hibás",
  customerId: UGYFEL,
  departmentId: HELYSZIN,
} as CreateServiceJobDto;

const partnerFiok = {
  id: "user-partner",
  customerId: UGYFEL,
  supplierId: null,
} as AuthenticatedUser;

describe("hibajegy nyitása helyszínre", () => {
  it("a partner NEM nyithat idegen helyszínre", async () => {
    const { service, hivasok } = serviceWith(["unit-akv"]);

    await assert.rejects(
      () => service.create(bemenet, partnerFiok),
      /nincs hozzád rendelve/,
    );
    assert.ok(
      !hivasok.includes("create"),
      "a tároló `create` metódusa NEM hívódhat meg",
    );
  });

  /**
   * KONTROLL: a SAJAT helyszinere nyithat. Enelkul a fenti allitas egy olyan
   * megvalositason is zold lenne, ami MINDEN helyszint elutasit.
   */
  it("KONTROLL: a saját helyszínére nyithat", async () => {
    const { service, hivasok } = serviceWith([HELYSZIN, "unit-akv"]);

    await service.create(bemenet, partnerFiok);

    assert.ok(hivasok.includes("create"));
  });

  /**
   * ES A MASIK IRANY: a BELSOS felhasznalo NULLA hozzarendelessel is nyithat.
   * Ez az allitas azt a hibat fogja meg, ami a rendszert NALUNK allitana meg.
   */
  it("a belsős felhasználót NEM zárja ki, holott nulla a hozzárendelése", async () => {
    const { service, hivasok } = serviceWith([]);

    await service.create(bemenet, "belsos-user-id");

    assert.ok(hivasok.includes("create"));
    assert.ok(
      !hivasok.includes("assignedUnitIds"),
      "belsős hatókörnél a hozzárendelést meg sem kérdezzük",
    );
  });
});
