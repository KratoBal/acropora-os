import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runShippingProfileLink } from "./medusa-shipping-profile-link.cli.js";

/*
  MI PIROSIT: ha szárazon is ír; ha a már kötött terméket újra írja; ha
  lapozáskor termék marad ki; ha az első írás rossz visszaolvasása után
  tovább ír; ha több alapértelmezett profil közül választ.
*/
function fake(
  products: { id: string; profile: string | null }[],
  opts: { readBack?: string | null; defaults?: string | null } = {},
) {
  const writes: string[] = [];
  const out: string[] = [];
  const client = {
    defaultShippingProfileId: async () =>
      opts.defaults === undefined ? "sp_default" : opts.defaults,
    listProductShippingProfiles: async (offset: number, limit: number) => ({
      products: products.slice(offset, offset + limit).map((p) => ({
        id: p.id,
        shipping_profile: p.profile ? { id: p.profile } : null,
      })),
      count: products.length,
    }),
    productShippingProfileId: async () =>
      opts.readBack === undefined ? "sp_default" : opts.readBack,
    setProductShippingProfile: async (id: string) => void writes.push(id),
  };
  const io = {
    stdout: (v: string) => void out.push(v),
    stderr: (v: string) => void out.push("ERR:" + v),
  };
  return { client, io, writes, text: () => out.join("") };
}
const items = (n: number, profile: string | null = null) =>
  Array.from({ length: n }, (_, i) => ({ id: `prod_${i}`, profile }));

describe("runShippingProfileLink", () => {
  it("dry by default: counts across pages, writes nothing", async () => {
    const f = fake([...items(5), { id: "kotott", profile: "sp_default" }]);
    assert.equal(await runShippingProfileLink(false, f.client, f.io, 2), 0);
    assert.deepEqual(f.writes, []);
    assert.match(
      f.text(),
      /6 termék a boltban; profil nélküli vagy más profilú: 5/,
    );
  });

  it("with --apply links every product without the default, and leaves the linked one alone", async () => {
    const f = fake([
      ...items(3),
      { id: "kotott", profile: "sp_default" },
      { id: "mas", profile: "sp_other" },
    ]);
    assert.equal(await runShippingProfileLink(true, f.client, f.io, 2), 0);
    assert.deepEqual(f.writes, ["prod_0", "prod_1", "prod_2", "mas"]);
  });

  it("stops after the first write when the read-back does not see the profile", async () => {
    const f = fake(items(4), { readBack: null });
    assert.equal(await runShippingProfileLink(true, f.client, f.io), 1);
    assert.deepEqual(f.writes, ["prod_0"]);
    assert.match(f.text(), /MEGÁLL az első írás után/);
  });

  it("does not choose when the shop has no single default profile", async () => {
    const f = fake(items(2), { defaults: null });
    assert.equal(await runShippingProfileLink(true, f.client, f.io), 1);
    assert.deepEqual(f.writes, []);
  });
});
