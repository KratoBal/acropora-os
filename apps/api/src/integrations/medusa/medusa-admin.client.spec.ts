import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXTERNAL_ID_LOOKUP_LIMIT,
  HttpMedusaAdminClient,
} from "./medusa-admin.client.js";

/**
 * A KÉRÉS ALAKJA mérve, mert a döntés csak annyit érhet, amennyit a kérés
 * visszahoz.
 *
 * Ezt a szolgáltatás tesztje nem foghatja meg: ott a találatok listája már
 * készen érkezik. A csonkolás a kliensben történne, tehát itt kell mérni.
 */

function clientReturning(rows: { id: string; deleted_at: string | null }[]) {
  const urls: string[] = [];
  /**
   * A hamisítvány BETARTJA a kért limitet, mert különben a teszt akkor is zöld
   * lenne, ha a kliens kettőt kérne: a csonkolás a kiszolgálón történik, és egy
   * hamisítvány, ami mindent visszaad, épp a mért hibát fedné el.
   */
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const limit = Number(
      new URL(String(url)).searchParams.get("limit") ?? rows.length,
    );
    return {
      ok: true,
      json: async () => ({ products: rows.slice(0, limit) }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    urls,
    client: new HttpMedusaAdminClient(
      { baseUrl: "https://példa.invalid", apiKey: "sk_teszt" },
      fetchImpl,
    ),
  };
}

describe("HttpMedusaAdminClient.findByExternalId", () => {
  /**
   * Három találat, kettő élő. Egy szűk limit ezek közül TETSZŐLEGES kettőt
   * adna vissza, mert a lista nem rendez - és akkor a hívó egy csonkolt
   * halmazon döntene, ami épp az ambiguous esetet fedné el.
   */
  it("brings back every match, not an arbitrary two of them", async () => {
    const { client, urls } = clientReturning([
      { id: "prod_egy", deleted_at: null },
      { id: "prod_ketto", deleted_at: null },
      { id: "prod_torolt", deleted_at: "2026-08-01T00:00:00.000Z" },
    ]);

    const result = await client.findByExternalId("os-1");

    assert.equal(result.rows.length, 3, "mindhárom találat jöjjön vissza");
    assert.equal(result.truncated, false);
    assert.match(urls[0]!, /limit=50/, "a limit tág, nem kettő");
    assert.match(urls[0]!, /with_deleted=true/);
    assert.match(urls[0]!, /external_id=os-1/);
  });

  /**
   * És ha mégis kimeríti a limitet: azt KÜLÖN jelezzük. A néma csonkolás
   * ugyanaz a hiba másképp - a hívó magabiztosan döntene egy részhalmazon.
   */
  it("says so when the answer fills the limit", async () => {
    const rows = Array.from({ length: EXTERNAL_ID_LOOKUP_LIMIT }, (_, i) => ({
      id: `prod_${i}`,
      deleted_at: null,
    }));
    const { client } = clientReturning(rows);

    const result = await client.findByExternalId("os-1");

    assert.equal(result.truncated, true);
  });
});
