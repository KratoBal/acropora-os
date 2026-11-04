import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CompletionCertificatesRepository } from "./completion-certificates.repository.js";

/**
 * A PORTÁL CSAK A MUNKALAPOS TIG-ET LÁTJA (barracuda, #2155 review). MI PIROSÍT: ha a
 * portál lekérdezése nem zárja ki a munkalap nélküli (megrendeléses) TIG-et, mert akkor
 * egy üres `visibility` (a belső hatókör) a megrendelés igazolásait is átengedné.
 */
function repositoryCapturing() {
  const wheres: unknown[] = [];
  const repository = new CompletionCertificatesRepository();
  (repository as unknown as { database: unknown }).database = {
    completionCertificate: {
      findMany: async (args: { where: unknown }) => {
        wheres.push(args.where);
        return [];
      },
      findFirst: async (args: { where: unknown }) => {
        wheres.push(args.where);
        return null;
      },
    },
  };
  return { repository, wheres };
}

describe("a portál TIG-lekérdezése", () => {
  it("a lista és a részlet is csak munkalapos TIG-et ad, üres láthatóságnál is", async () => {
    const { repository, wheres } = repositoryCapturing();
    await repository.portalListForVisibility({});
    await repository.portalDetail("cert-1", {});
    assert.deepEqual(wheres[0], {
      serviceJobId: { not: null },
      serviceJob: {},
    });
    assert.deepEqual(wheres[1], {
      AND: [
        { id: "cert-1" },
        { serviceJobId: { not: null } },
        { serviceJob: {} },
      ],
    });
  });
});
