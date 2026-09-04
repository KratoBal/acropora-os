import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeMedusaFailure,
  EXTERNAL_ID_LOOKUP_LIMIT,
  HttpMedusaAdminClient,
  MedusaAdminHttpError,
  medusaFailureField,
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

/**
 * A MEZŐ NEVE ÁTMEGY, A VÁLASZ TÖBBI RÉSZE NEM.
 *
 * Mérve 2026-09-04: huszonegy cikkszámból tizenkilenc elakadt HTTP 400-zal, és
 * a naplóban ennyi állt: „a Medusa HTTP 400 választ adott". Az ok sehol. Ezek
 * az állítások arra állnak, hogy a MEZŐ eljut a naplóig -- és hogy semmi más
 * nem jut el vele.
 */
describe("a Medusa hibaüzenete megnevezi a mezőt", () => {
  const VALODI =
    '{"type":"invalid_data","message":"Invalid request: Field \'variants, 0, prices\' is required"}';

  it("a MÉRT alakból kiemeli a mező-útvonalat", () => {
    /*
      A pelda a kliens sajat megjegyzesebol jon, a stage-en 2026-08-25-en merve.
      MI PIROSIT: a mai kod. Az csak a statuszkodot adja vissza, mezot nem --
      ez az allitas EPP AZT meri, ami ma hianyzik.
    */
    assert.equal(medusaFailureField(VALODI), "variants, 0, prices");
  });

  it("a leírásba is bekerül, a státusz MELLÉ", () => {
    assert.equal(
      describeMedusaFailure(new MedusaAdminHttpError(400, VALODI)),
      "a Medusa HTTP 400 választ adott (a hibás mező: variants, 0, prices)",
    );
  });

  it("a válasz TÖBBI része NEM kerül bele", () => {
    /*
      EZ A VEDELEM, es nem a mezo kiemelese. A `describeMedusaFailure` a
      jelentesbe es a parancssori kimenetre kerul, es onnantol nem tudjuk, ki
      olvassa. Amit atengedunk, az egy mezo-UTVONAL, nem ertek.
    */
    const kimenet = describeMedusaFailure(
      new MedusaAdminHttpError(400, VALODI),
    );
    assert.equal(kimenet.includes("invalid_data"), false);
    assert.equal(kimenet.includes("Invalid request"), false);
    assert.equal(kimenet.includes("is required"), false);
  });

  it("egy VISSZHANGZOTT ÉRTÉK nem tud átcsúszni a mezőn", () => {
    /*
      A MEGENGEDO LISTA ITT MERHETO. A karakterkeszlet nem enged idezojelet,
      kapcsos zarojelet, egyenlosegjelet -- tehat ha a Medusa valaha
      visszhangozna egy ERTEKET a `Field '...'` alakban, az nem illeszkedne.

      MI PIROSIT: a minta kiszelesitese barmilyen karakterre (peldaul `[^']+`).
    */
    const gyanus =
      '{"message":"Invalid request: Field \'apiKey=sk_test_titok123\' is required"}';
    assert.equal(medusaFailureField(gyanus), null);
  });

  it("ismeretlen alaknál a MAI viselkedés marad: csak a státusz", () => {
    /*
      NEM probalunk "valamit" kiirni. Egy uj Medusa-verzio uj hibaalakot hozhat,
      es akkor ez a fuggveny annyit mond, hogy nem ismerte fel -- ez HANGOS, es
      jobb, mint egy felig felismert szoveg.
    */
    assert.equal(medusaFailureField('{"message":"Unauthorized"}'), null);
    assert.equal(
      describeMedusaFailure(
        new MedusaAdminHttpError(401, '{"message":"Unauthorized"}'),
      ),
      "a Medusa HTTP 401 választ adott",
    );
  });

  it("a NEM HTTP hiba üzenete változatlanul megmarad", () => {
    /*
      ISMERT POZITIV KONTROLL: a fenti allitasok akkor is teljesulnenek, ha a
      fuggveny MINDENT elnyelne. Ez az ag azt meri, hogy a futtatokornyezet
      hibaja (idotullepes, nevfeloldas) tovabbra is atmegy -- az nem a Medusa
      valaszabol jon, tehat nem visszhangozhat semmit.
    */
    assert.equal(
      describeMedusaFailure(new Error("fetch failed: ETIMEDOUT")),
      "fetch failed: ETIMEDOUT",
    );
  });
});

/**
 * A MASODIK FELISMERT ALAK: A HANDLE ELUTASITASA.
 *
 * Merve 2026-09-04 a telepitett 2.19.0 forrasan: a termek `handle` mezojenek
 * SAJAT ellenorzese van, sajat uzenettel -- a `Field '...'` mintara NEM
 * illeszkedik. Epp ez a hibaosztaly allitja meg ma a migraciot: az 1813
 * SefUrl-bol 1799-et a NAGYBETU miatt utasitana el a Medusa.
 */
describe("a handle elutasítása is megnevezi a mezőt, de az ÉRTÉKET nem", () => {
  const HANDLE_HIBA =
    '{"type":"invalid_data","message":"Invalid product handle \'Aqua-Illumination-Prime-HD-LED-panel\'. It must contain URL safe characters"}';

  it("felismeri az alakot, és `handle`-t mond", () => {
    /*
      MI PIROSIT: a mai kod. Az csak a `Field '...'` alakot ismeri, tehat erre
      `null`-t ad, es a naplo csak a statuszkodot mutatna -- pontosan az az
      allapot, ami ma megallitja a migraciot.
    */
    assert.equal(medusaFailureField(HANDLE_HIBA), "handle");
  });

  it("a KONKRET CIM nem kerul a kimenetre", () => {
    /*
      EZ A VEDELEM, ES SZERKEZETI, NEM SZURESI. A mezonevet a lista MAGA ADJA;
      az uzenetben allo erteket nem is olvassuk ki. Egy kiemeles-plusz-szures
      alak ugyanezt igerne, de akkor a vedelem egy mintan mulna.

      MI PIROSIT: ha valaki a nevesitett alakot is kiemelesse alakitja.
    */
    const kimenet = describeMedusaFailure(
      new MedusaAdminHttpError(400, HANDLE_HIBA),
    );
    assert.equal(
      kimenet,
      "a Medusa HTTP 400 választ adott (a hibás mező: handle)",
    );
    assert.equal(kimenet.includes("Aqua-Illumination"), false);
    assert.equal(kimenet.includes("URL safe"), false);
  });

  it("a `Field '...'` alak TOVABBRA IS elsobbseget elvez", () => {
    /*
      ISMERT POZITIV KONTROLL: a masodik lista nem takarhatja el az elsot. Ha
      egy valasz mindkettot hordozna, a pontosabb (mezo-UTVONALAT ado) alak kell.
    */
    const mindketto =
      "{\"message\":\"Invalid request: Field 'variants, 0, prices' is required. Invalid product handle 'x'.\"}";
    assert.equal(medusaFailureField(mindketto), "variants, 0, prices");
  });

  it("egy MASIK entitas handle-hibaja NEM illeszkedik", () => {
    /*
      CSAK AMIT MERTUNK. A kategoria es a gyujtemeny handle-je mas uton megy, es
      amig azt nem neztuk meg, ide sem kerul -- egy "biztos ez is olyan"
      bejegyzes pontosan az a fajta bovites, ami ellen a megengedo lista szol.
    */
    assert.equal(
      medusaFailureField(
        '{"message":"Invalid category handle \'valami\'. It must contain URL safe characters"}',
      ),
      null,
    );
  });
});
