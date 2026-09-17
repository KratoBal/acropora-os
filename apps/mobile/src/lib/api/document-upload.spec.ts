import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDocumentUpload,
  MAX_FILES_PER_UPLOAD,
  UPLOAD_FIELD_NAME,
  uploadPart,
} from "./document-upload";

function file(name: string, type = "image/jpeg") {
  return { uri: `file:///tmp/${name}`, name, type };
}

describe("a feltöltés törzsének összeállítása", () => {
  it("minden fájl ugyanazt a mezőnevet kapja, és a típus külön mezőben megy", () => {
    const result = buildDocumentUpload({
      type: "OTHER",
      files: [file("elso.jpg"), file("masodik.jpg")],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // A `getAll` a mezőnévre szűr: ha bármelyik fájl más néven menne, ez
    // kevesebbet adna vissza, és a szerver csak az egyiket látná.
    assert.equal(result.body.getAll(UPLOAD_FIELD_NAME).length, 2);
    assert.equal(result.body.get("type"), "OTHER");
  });

  /**
   * A KÉT ELUTASÍTÁS A KÜLDÉS ELŐTT TÖRTÉNIK, és ez a lényegük: mindkettő
   * elmenne a szerverig is, csak lassabban, és a szerelő addig a töltés-jelzőt
   * nézné egy olyan hibáért, amit a telefon már tudott.
   */
  it("üres válogatásra nem épít törzset", () => {
    const result = buildDocumentUpload({ type: "OTHER", files: [] });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /legalább egy/);
  });

  it("a felső határ fölött megnevezi a határt", () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) =>
      file(`kep-${i}.jpg`),
    );

    const result = buildDocumentUpload({ type: "OTHER", files });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(String(MAX_FILES_PER_UPLOAD)));
  });

  it("pontosan a határon még átmegy", () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD }, (_, i) =>
      file(`kep-${i}.jpg`),
    );

    const result = buildDocumentUpload({ type: "OTHER", files });

    assert.equal(result.ok, true);
  });
});

/**
 * A RÉSZ ALAKJA -- EZ AZ, AMI MIATT SOHA EGY FÉNYKÉP SEM MENT FEL A TELEFONRÓL.
 *
 * A futtató globális `fetch`-e (Expo 57 `winter/fetch`) HÁROM alakot fogad el, és
 * a React Native szokásos `{uri, name, type}` objektuma EGYIKRE SEM illeszkedik:
 * az utolsó ágra esik és dob. A dobás a `fetch`-ből jön vissza, tehát a kérés el
 * sem indul, a szerver naplójában nulla nyoma marad, és a telefonon "a szerver
 * jelenleg nem érhető el" látszik.
 *
 * MIÉRT NEM ELÉG A `buildDocumentUpload` EREDMÉNYÉT MÉRNI: `node --test` alatt a
 * Node saját `FormData`-ja fut, ami a nem-Blob objektumot `String(value)`-vel
 * `"[object Object]"`-té alakítja -- a RÉGI és az ÚJ alak onnan visszaolvasva
 * BETŰRE AZONOS. Ezért van a rész-építés külön, exportált függvényben: az alakot
 * csak ott lehet megnézni.
 */
describe("a többrészes törzs egy fájl-része", () => {
  const bajtok = new Uint8Array([1, 2, 3]);

  it("NEM `uri`-alakú többé: pontosan ezt dobta el a futtató fetch-e", () => {
    const part = uploadPart(file("kep.jpg"), async () => bajtok);

    assert.equal("uri" in part, false);
  });

  /**
   * A FOGADÓ OLDAL FELTÉTELÉT MÁSOLJA, NEM A MIÉNKET.
   *
   * Az ágak betűre az `expo/src/winter/fetch/convertFormData.ts`-ből valók
   * (Expo 57.0.11). Ez BEÉGETETT MÁSOLAT egy idegen csomagból, és ezt ki kell
   * mondani: ha az Expo egyszer átírja a sorrendet vagy az elfogadott alakokat,
   * EZ AZ ÁLLÍTÁS NEM FOG SZÓLNI. Amit véd, az a visszaírás a MI oldalunkon --
   * hogy valaki a kényelmesebb `{uri, ...}` alakot tegye vissza.
   */
  it("a futtató fetch-e HARMADIK ága fogadja el, nem az eldobó ág", () => {
    const entry: unknown = uploadPart(file("kep.jpg"), async () => bajtok);

    assert.equal(typeof entry === "string", false);
    assert.equal(entry instanceof Blob, false);
    assert.equal(
      typeof entry === "object" && entry !== null && "bytes" in entry,
      true,
      "a rész az eldobó ágra esne: 'Unsupported FormDataPart implementation'",
    );
  });

  /**
   * A NÉV ÉS A TÍPUS A MIÉNK MARAD. A fejléceket ugyanaz a modul az OBJEKTUMRÓL
   * olvassa, tehát a `picked-image.ts` ellenőrzött értékei mennek ki. Az
   * `expo-file-system` saját `File` példánya is átmenne a `bytes` ágon, de a
   * neve a gyorsítótárbeli fájlnév lenne, a típusa natív MIME-felismerés -- és a
   * szerver a bejelentett típust ÉS az első bájtokat EGYÜTT nézi.
   */
  it("a nevet és a típust a választótól viszi tovább, nem a fájlrendszertől", () => {
    const part = uploadPart(
      {
        uri: "file:///tmp/cache/ABC123.tmp",
        name: "sarult-cso.png",
        type: "image/png",
      },
      async () => bajtok,
    );

    assert.equal(part.name, "sarult-cso.png");
    assert.equal(part.type, "image/png");
  });

  it("a bájtokat a megadott URI-ról kéri", async () => {
    const kertek: string[] = [];
    const part = uploadPart(file("kep.jpg"), async (uri) => {
      kertek.push(uri);
      return bajtok;
    });

    assert.deepEqual(
      kertek,
      [],
      "a törzs összeállítása még nem olvashat fájlt",
    );
    assert.deepEqual(await part.bytes(), bajtok);
    assert.deepEqual(kertek, ["file:///tmp/kep.jpg"]);
  });

  /**
   * A LUSTASÁG NEM APRÓSÁG: egy elutasított válogatás (üres lista, tíz fölött)
   * így EGYETLEN bájtot sem olvas fel a lemezről. Tíz fénykép beolvasása egy
   * olyan kérés kedvéért, ami el sem indul, a telefonon percekig tartó némaság.
   */
  it("az elutasított válogatás egyetlen fájlt sem olvas be", () => {
    let olvasasok = 0;
    const result = buildDocumentUpload({
      type: "OTHER",
      files: [],
      readBytes: async () => {
        olvasasok += 1;
        return bajtok;
      },
    });

    assert.equal(result.ok, false);
    assert.equal(olvasasok, 0);
  });
});

/**
 * A BEKÖTÉS -- ezt csak a forrásból lehet megnézni, a fenti okból (a Node
 * `FormData` a részt visszaolvasva `"[object Object]"`, tehát a régi és az új
 * alak megkülönböztethetetlen).
 *
 * A HATÁRA KIMONDVA: azt állítja, hogy a törzs-építő a rész-építőt HÍVJA, nem
 * azt, hogy a kérés a készüléken végigmegy. Az utóbbi innen nem mérhető: nincs
 * telefon, és a dobás a futtató saját `fetch`-ében történik.
 */
const TORZS_EPITO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "api",
  "document-upload.ts",
);

describe("a törzs-építő a rész-építőt használja", () => {
  function forras(): string {
    try {
      return readFileSync(TORZS_EPITO, "utf8");
    } catch {
      throw new Error(
        `Nem tudtam elolvasni: ${TORZS_EPITO}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
      );
    }
  }

  it("POZITÍV KONTROLL: a forrás olvasható és nem üres", () => {
    assert.ok(forras().length > 2000, "a forrás üres vagy gyanúsan rövid");
  });

  it("a fájl-részt a rész-építő HÍVÁSA adja", () => {
    // A HÍVÁS alakjára illeszt, nem a puszta névre: a név az importban és a
    // definícióban is ott áll, tehát egy visszaírt `{uri, ...}` mellett is
    // zölden maradna.
    assert.match(forras(), /uploadPart\(file, readBytes\)/);
  });

  it("a RÉGI, eldobott alak nincs többé a törzs-építőben", () => {
    assert.doesNotMatch(
      forras(),
      /body\.append\(\s*UPLOAD_FIELD_NAME,\s*\{/,
      "a fájl-rész megint objektum-literál a helyszínen: ez volt az eldobott alak",
    );
  });
});
