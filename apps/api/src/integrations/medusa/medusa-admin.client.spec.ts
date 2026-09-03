import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXTERNAL_ID_LOOKUP_LIMIT,
  HttpMedusaAdminClient,
  type MedusaFileUpload,
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

/**
 * A VÁLTOZAT-KERESÉS KÉRÉSE, ugyanazzal az indokkal, mint a termék-keresésé.
 *
 * A törlés puha, és az alapértelmezett szűrő kizárja a törölteket. Enélkül egy
 * eltemetett változat cikkszáma láthatatlan, a hívó pedig a „nincs ilyen" és
 * az „el van temetve" esetet nem tudja szétválasztani - holott a kettő MÁS
 * teendő, és Balázs döntése óta az egyikük megállás.
 *
 * Ezt a szolgáltatás tesztje nem foghatja meg: ott a sorok már készen
 * érkeznek, és egy hamisítvány örömmel visszaad törölt sorokat akkor is, ha a
 * valódi kérés sosem kérte őket.
 */
describe("HttpMedusaAdminClient.listProductVariants", () => {
  it("a törölteket is kéri, és a törlés bélyegét is lekéri", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ variants: [] }),
      };
    }) as unknown as typeof fetch;
    const client = new HttpMedusaAdminClient(
      { baseUrl: "http://medusa.teszt", apiKey: "kulcs" },
      fetchImpl,
    );

    await client.listProductVariants("prod_1");

    assert.match(urls[0]!, /with_deleted=true/);
    /**
     * A `fields` nélkül a bélyeg nem jönne meg, és a hívó minden sort élőnek
     * látna - vagyis a `with_deleted` önmagában CSENDBEN rosszabb lenne a
     * mainál: több sort hozna, és mind élőnek látszana.
     */
    assert.match(urls[0]!, /deleted_at/);
  });
});

/**
 * A FELTOLTES KERES-ALAKJA, ES NEM AZ, HOGY "MUKODIK".
 *
 * MIERT EZ A HAT ALLITAS: a multipart hiba NEMA. Ha a `content-type` rossz, a
 * keres MEGERKEZIK, a bolt `multer` retege nem talal benne fajlt, es a hiba ugy
 * nez ki, mintha a kepfajllal lenne baj. Egy allitas, ami csak a visszakapott
 * URL-t nezi, egy HAMISITVANY mellett akkor is zold, ha a valodi bolt
 * elutasitana -- ezert a KERES alakjat merjuk, nem a valaszt.
 *
 * Ugyanez a hiba mar megharapott minket a mobil kliensben: ott is minden torzsre
 * `application/json` ment.
 */
function uploadClient(valasz: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  szoveg?: string;
}) {
  const keresek: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    keresek.push({ url: String(url), init });
    return {
      ok: valasz.ok ?? true,
      status: valasz.status ?? 200,
      json: async () => valasz.body ?? { files: [] },
      text: async () => valasz.szoveg ?? "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    keresek,
    client: new HttpMedusaAdminClient(
      { baseUrl: "https://példa.invalid", apiKey: "sk_teszt" },
      fetchImpl,
    ),
  };
}

const KEP: MedusaFileUpload = {
  filename: "korall.jpg",
  content: Buffer.from("kép-bájtok"),
  contentType: "image/jpeg",
};

describe("HttpMedusaAdminClient.uploadFile", () => {
  it("a boltnak a fajl-kulcsot ES az URL-t adja vissza", async () => {
    const { client } = uploadClient({
      body: {
        files: [{ id: "1787744818-korall.jpg", url: "https://bolt/x.jpg" }],
      },
    });

    const eredmeny = await client.uploadFile(KEP);

    assert.deepEqual(eredmeny, {
      id: "1787744818-korall.jpg",
      url: "https://bolt/x.jpg",
    });
  });

  /**
   * A LEGFONTOSABB ALLITAS, ES A LEGKONNYEBB KIHAGYNI.
   *
   * A kliens kozos `headers()` metodusa MINDEN keresre `application/json`-t
   * tesz. Ha a feltoltes azon az uton menne, ez a fejlec rairodna a multipart
   * torzsre, es a `FormData` sajat hatarolo-erteke sosem allna be.
   */
  it("NEM ir sajat content-type fejlecet a multipart torzsre", async () => {
    const { client, keresek } = uploadClient({
      body: { files: [{ id: "kulcs", url: "https://bolt/x.jpg" }] },
    });

    await client.uploadFile(KEP);

    const fejlecek = keresek[0]?.init.headers as Record<string, string>;
    assert.ok(fejlecek, "nem ment ki keres");
    assert.deepEqual(
      Object.keys(fejlecek),
      ["authorization"],
      "a multipart torzson CSAK a hitelesito fejlec allhat",
    );
  });

  /**
   * ES A HATAROLO-ERTEK TENYLEGES MEGLETE, nem csak a fejlec hianya.
   *
   * A ketto nem ugyanaz: a fejlec hianya a MI oldalunk dontese, a hatarolo-ertek
   * viszont a `FormData`-e. Ha valaki a torzset egy nyers stringre cserelne, az
   * elso allitas ZOLD maradna, es a bolt megsem talalna fajlt a keresben.
   */
  it("a torzs valodi multipart, hatarolo-ertekkel", async () => {
    const { client, keresek } = uploadClient({
      body: { files: [{ id: "kulcs", url: "https://bolt/x.jpg" }] },
    });

    await client.uploadFile(KEP);

    const torzs = keresek[0]?.init.body;
    assert.ok(torzs instanceof FormData, "a torzs nem FormData");
    /**
     * SZANDEKOSAN NEM a `files` mezore kerdez: azt a KOVETKEZO allitas meri.
     * Ha ez a sor a mezonevet is nezne, egy elgepelt mezonev KET allitast
     * dontene pirosra, es a diagnozis nem mondana meg, melyik romlott el.
     */
    const elso = [...torzs.values()][0];
    assert.ok(elso instanceof Blob, "a torzsben nem fajl all");
    assert.equal(
      new Request("https://példa.invalid", {
        method: "POST",
        body: torzs,
      }).headers
        .get("content-type")
        ?.startsWith("multipart/form-data; boundary="),
      true,
    );
  });

  /**
   * A MEZONEV A BOLT OLDALAROL KOTOTT: a vegpont `upload.array("files")`
   * alakban olvas, es ures listanal `No files were uploaded` hibat dob. Egy
   * egyes szamu mezonev tehat nem elgepeles, hanem URES feltoltes lenne.
   */
  it("a mezo neve `files`, tobbes szamban", async () => {
    const { client, keresek } = uploadClient({
      body: { files: [{ id: "kulcs", url: "https://bolt/x.jpg" }] },
    });

    await client.uploadFile(KEP);

    const torzs = keresek[0]?.init.body as FormData;
    assert.deepEqual([...torzs.keys()], ["files"]);
  });

  /**
   * ES A KET ALLITAS, AMI A NEMA VALASZT FOGJA MEG.
   *
   * Egy hianyzo URL kesobb, a termek kep-mezojeben jelenne meg -- ott mar semmi
   * nem mondana meg, hogy a feltoltes volt hianyos.
   */
  it("hibat dob, ha a valasz nem hoz URL-t", async () => {
    const { client } = uploadClient({ body: { files: [{ id: "kulcs" }] } });

    await assert.rejects(() => client.uploadFile(KEP), /nem hozott azonosítót/);
  });

  it("hibat dob, ha a valasz URES fajl-listat hoz", async () => {
    const { client } = uploadClient({ body: { files: [] } });

    await assert.rejects(() => client.uploadFile(KEP), /nem hozott azonosítót/);
  });
});
