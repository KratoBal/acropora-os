import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";

import { MemoryRedirectStore } from "../redirect/redirect-memory-store.js";
import { redirectInvariantViolations } from "../redirect/redirect-writer.js";
import {
  SlugTakenError,
  WebshopSlugService,
  type WebshopSlugStore,
} from "./webshop-slug.service.js";

/**
 * A WEBSHOP-SLUG SZOLGÁLTATÁS (SEO P0 PR 5; D2) egy memóriabeli tárolón, ami a
 * Prisma-tároló szerződését tartja: élő slug a WEBSHOP-sorban, régi slug a
 * `SlugHistory`-ban, és egy régi slug sem ad új gazdát.
 *
 * MI PIROSIT: a slug a név változását követi; ütközésnél nem a SKU-utótag jön; egy
 * régi slug újra kiosztódik; a kézi csere nem írja a régit az előzménybe, vagy
 * más termék (élő vagy régi) slugját elfogadja; egy versenyhelyzet nem számol újra.
 */
function memoria(
  termekek: Record<string, { name: string; primarySku: string | null }>,
) {
  const elo = new Map<string, string>();
  const regi = new Map<string, string>();
  const elozmeny: { productId: string; slug: string; userId: string }[] = [];
  let versenyEgyszer: string | null = null;
  const atiranyitas = new MemoryRedirectStore();
  const store: WebshopSlugStore = {
    currentSlug: async (id) => elo.get(id) ?? null,
    basis: async (id) => termekek[id] ?? null,
    takenWithPrefix: async (prefix) =>
      new Set(
        [...elo.values(), ...regi.keys()].filter((s) => s.startsWith(prefix)),
      ),
    owner: async (slug) => {
      for (const [id, s] of elo)
        if (s === slug) return { kind: "live", productId: id };
      const r = regi.get(slug);
      return r ? { kind: "history", productId: r } : null;
    },
    saveFirst: async (id, slug) => {
      if (versenyEgyszer === slug) {
        // valaki más közben ugyanezt a slugot mentette
        elo.set("masik-termek", slug);
        versenyEgyszer = null;
        throw new SlugTakenError(slug);
      }
      if ([...elo.values()].includes(slug) || regi.has(slug))
        throw new SlugTakenError(slug);
      elo.set(id, slug);
    },
    replace: async ({ productId, oldSlug, newSlug, userId }, redirects) => {
      await redirects(atiranyitas);
      if (regi.get(newSlug) === productId) regi.delete(newSlug);
      if (oldSlug) {
        regi.set(oldSlug, productId);
        elozmeny.push({ productId, slug: oldSlug, userId });
      }
      elo.set(productId, newSlug);
    },
  };
  return {
    store,
    elo,
    regi,
    elozmeny,
    atiranyitas,
    verseny: (slug: string) => {
      versenyEgyszer = slug;
    },
  };
}

describe("webshopSlug (D2: első kéréskor keletkezik)", () => {
  it("keletkezik a névből, és a név változása után ugyanaz marad", async () => {
    const termekek = {
      p1: { name: "Tropic Marin Pro-Reef só 25 kg", primarySku: "TM1" },
    };
    const m = memoria(termekek);
    const s = new WebshopSlugService(m.store);
    assert.equal(await s.webshopSlug("p1"), "tropic-marin-pro-reef-so-25-kg");
    termekek.p1.name = "Tropic Marin Pro-Reef tengeri só 25 kg";
    assert.equal(await s.webshopSlug("p1"), "tropic-marin-pro-reef-so-25-kg");
  });

  it("ütközésnél SKU-utótag; a régi (előzmény) slug is foglalt", async () => {
    const m = memoria({
      p1: { name: "Pumpa", primarySku: "A1" },
      p2: { name: "Pumpa", primarySku: "B 2" },
      p3: { name: "Szuro", primarySku: "C3" },
    });
    m.regi.set("szuro", "p9");
    const s = new WebshopSlugService(m.store);
    assert.equal(await s.webshopSlug("p1"), "pumpa");
    assert.equal(await s.webshopSlug("p2"), "pumpa-b-2");
    assert.equal(await s.webshopSlug("p3"), "szuro-c3");
  });

  it("versenyhelyzetnél újraszámol", async () => {
    const m = memoria({ p1: { name: "Pumpa", primarySku: "A1" } });
    m.verseny("pumpa");
    const s = new WebshopSlugService(m.store);
    assert.equal(await s.webshopSlug("p1"), "pumpa-a1");
  });
});

describe("changeSlug (kézi csere)", () => {
  const indulo = () => {
    const m = memoria({
      p1: { name: "Pumpa", primarySku: "A1" },
      p2: { name: "Szuro", primarySku: "B1" },
    });
    m.elo.set("p1", "pumpa");
    m.elo.set("p2", "szuro");
    return { m, s: new WebshopSlugService(m.store) };
  };

  it("a régi slug előzménybe kerül, és többé más nem kapja meg", async () => {
    const { m, s } = indulo();
    assert.equal(await s.changeSlug("p1", "uj-pumpa", "u1"), "uj-pumpa");
    assert.deepEqual(m.elozmeny, [
      { productId: "p1", slug: "pumpa", userId: "u1" },
    ]);
    await assert.rejects(s.changeSlug("p2", "pumpa", "u1"), ConflictException);
  });

  it("a termék a saját régi slugját visszakaphatja", async () => {
    const { m, s } = indulo();
    await s.changeSlug("p1", "uj-pumpa", "u1");
    assert.equal(await s.changeSlug("p1", "pumpa", "u1"), "pumpa");
    assert.equal(m.elo.get("p1"), "pumpa");
    assert.equal(m.regi.get("uj-pumpa"), "p1");
    assert.equal(m.regi.has("pumpa"), false);
  });

  it("más élő slugja 409; érvénytelen alak 400; ugyanaz a slug nem ír", async () => {
    const { m, s } = indulo();
    await assert.rejects(s.changeSlug("p1", "szuro", "u1"), ConflictException);
    for (const rossz of [
      "Pumpa",
      "pumpa/uj",
      "pumpa--uj",
      "-pumpa",
      "szűrő",
      5,
      "x".repeat(81),
    ])
      await assert.rejects(
        s.changeSlug("p1", rossz, "u1"),
        BadRequestException,
        String(rossz),
      );
    assert.equal(await s.changeSlug("p1", "pumpa", "u1"), "pumpa");
    assert.deepEqual(m.elozmeny, []);
  });
});

describe("changeSlug: az átirányítás (SEO P0 PR 6)", () => {
  const indulo = () => {
    const m = memoria({ p1: { name: "Pumpa", primarySku: "A1" } });
    m.elo.set("p1", "pumpa");
    return { m, s: new WebshopSlugService(m.store) };
  };
  const szabalyok = async (m: ReturnType<typeof memoria>) =>
    (await m.atiranyitas.listActive())
      .map((r) => `${r.sourcePath} -> ${r.destinationPath}`)
      .sort();

  it("a régi cím az újra mutat", async () => {
    const { m, s } = indulo();
    await s.changeSlug("p1", "uj-pumpa", "u1");
    assert.deepEqual(await szabalyok(m), [
      "/hu/termek/pumpa -> /hu/termek/uj-pumpa",
    ]);
    const [uj] = m.atiranyitas.created();
    assert.equal(uj?.reason, "SLUG_CHANGE");
    assert.equal(uj?.entityId, "p1");
    assert.equal(uj?.createdById, "u1");
  });

  it("két egymás utáni csere után nincs lánc", async () => {
    const { m, s } = indulo();
    await s.changeSlug("p1", "b", "u1");
    await s.changeSlug("p1", "c", "u1");
    assert.deepEqual(await szabalyok(m), [
      "/hu/termek/b -> /hu/termek/c",
      "/hu/termek/pumpa -> /hu/termek/c",
    ]);
    assert.deepEqual(await redirectInvariantViolations(m.atiranyitas), []);
  });

  it("a saját régi slug visszavétele: a visszavett cím élő, nem forrás, és nincs kör", async () => {
    const { m, s } = indulo();
    await s.changeSlug("p1", "uj-pumpa", "u1");
    await s.changeSlug("p1", "pumpa", "u1");
    assert.deepEqual(await szabalyok(m), [
      "/hu/termek/uj-pumpa -> /hu/termek/pumpa",
    ]);
    assert.deepEqual(await redirectInvariantViolations(m.atiranyitas), []);
  });

  it("ugyanarra a slugra nem ír szabályt", async () => {
    const { m, s } = indulo();
    await s.changeSlug("p1", "pumpa", "u1");
    assert.deepEqual(await szabalyok(m), []);
  });
});
