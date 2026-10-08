import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@acropora/types";

import { MemoryRedirectStore } from "./redirect-memory-store.js";
import {
  UrlRedirectService,
  type RedirectTransactor,
} from "./url-redirect.service.js";

/**
 * A KÉZI ÁTIRÁNYÍTÁS (SEO P0 PR 6, D2). MI PIROSIT: egy más célú meglévő szabály
 * `replace` nélkül felülíródik; egy kör vagy egy betűméret-ütközés 2xx-et ad; a
 * jogot a MANAGER is megkapja.
 */
function szolgaltatas(store = new MemoryRedirectStore()) {
  const transactor: RedirectTransactor = (fn) => fn(store);
  return { store, s: new UrlRedirectService(transactor) };
}

describe("UrlRedirectService.create", () => {
  it("ír, MANUAL okkal és a létrehozóval", async () => {
    const { store, s } = szolgaltatas();
    const eredmeny = await s.create(
      { source: "/Regi-Akcio", destination: "/hu/termek/pumpa" },
      "u1",
    );
    assert.equal(eredmeny.status, "created");
    const [sor] = store.created();
    assert.equal(sor?.reason, "MANUAL");
    assert.equal(sor?.createdById, "u1");
  });

  it("más célú meglévő: 409 replace nélkül, replace-szel felülír", async () => {
    const { store, s } = szolgaltatas(
      new MemoryRedirectStore([
        { id: "r1", sourcePath: "/a", destinationPath: "/b", isActive: true },
      ]),
    );
    await assert.rejects(
      s.create({ source: "/a", destination: "/c" }, "u1"),
      ConflictException,
    );
    assert.deepEqual(store.updated(), []);
    assert.equal(
      (await s.create({ source: "/a", destination: "/c", replace: true }, "u1"))
        .status,
      "updated",
    );
  });

  it("kör és önmagára mutatás 400, betűméret-ütközés 409, hibás törzs 400", async () => {
    const { s } = szolgaltatas(
      new MemoryRedirectStore([
        { id: "r1", sourcePath: "/A", destinationPath: "/b", isActive: true },
      ]),
    );
    await assert.rejects(
      s.create({ source: "/b", destination: "/A" }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      s.create({ source: "/x", destination: "/x" }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      s.create({ source: "/a", destination: "/z" }, "u1"),
      ConflictException,
    );
    await assert.rejects(
      s.create({ source: 5, destination: "/z" }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      s.create({ source: "/q", destination: "/z", replace: "igen" }, "u1"),
      BadRequestException,
    );
  });
});

describe("seo.redirects.manage (D2)", () => {
  it("csak OWNER és ADMIN kapja, a MANAGER nem", () => {
    const kapja = Object.entries(ROLE_PERMISSIONS)
      .filter(([, jogok]) =>
        (jogok as readonly string[]).includes(PERMISSIONS.SEO_REDIRECTS_MANAGE),
      )
      .map(([szerep]) => szerep)
      .sort();
    assert.deepEqual(kapja, ["ADMIN", "OWNER"]);
  });
});
