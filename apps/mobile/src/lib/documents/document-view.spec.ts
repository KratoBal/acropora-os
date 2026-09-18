import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeDocuments,
  describeUnviewableDocument,
  documentImageSource,
  formatDocumentSize,
  isViewableImage,
  type ServiceDocumentSummary,
} from "./document-view";

const doc = (
  t: Partial<ServiceDocumentSummary> = {},
): ServiceDocumentSummary => ({
  id: "doc-1",
  fileName: "kep.jpg",
  contentType: "image/jpeg",
  sizeBytes: 2048,
  createdAt: "2026-09-17T08:00:00.000Z",
  ...t,
});

describe("isViewableImage", () => {
  it("says yes to an image", () => {
    assert.equal(isViewableImage("image/jpeg"), true);
  });

  /**
   * A BEJELENTETT TÍPUS TARTALMAZHAT PARAMÉTERT ÉS NAGYBETŰT. Egy szó szerinti
   * összehasonlítás ezeken CSENDBEN elbukna, és a kép nem jelenne meg -- ami a
   * felhasználó szemszögéből pontosan ugyanaz, mint a mai hiány.
   */
  it("is not fooled by a parameter or by capitals", () => {
    assert.equal(isViewableImage("image/jpeg; charset=binary"), true);
    assert.equal(isViewableImage("IMAGE/PNG"), true);
    assert.equal(isViewableImage("  image/webp  "), true);
  });

  /**
   * A PDF NEM KÉP. A natív képbetöltő nem rajzolja ki, és egy törött csempe
   * ugyanúgy néz ki, mint egy elromlott kép.
   */
  it("says no to anything else", () => {
    assert.equal(isViewableImage("application/pdf"), false);
    assert.equal(isViewableImage("text/plain"), false);
    // ES EGY ALAK, AMI KEPNEK LATSZIK, DE NEM AZ: a tipusnak az ELEJEN kell
    // allnia, kulonben egy `application/image-ish` is atmenne.
    assert.equal(isViewableImage("application/x-image"), false);
  });
});

describe("documentImageSource", () => {
  it("carries the bearer token, because the endpoint requires it", () => {
    const forras = documentImageSource({
      apiUrl: "https://api.acropora.hu",
      token: "abc",
      ownerPath: "/service/worksheets/ws-1",
      documentId: "doc-1",
      variant: "original",
    });
    assert.equal(
      forras.uri,
      "https://api.acropora.hu/service/worksheets/ws-1/documents/doc-1",
    );
    assert.deepEqual(forras.headers, { Authorization: "Bearer abc" });
  });

  /**
   * A ZÁRÓ PERJEL NEM AD DUPLÁT. A beállított cím mindkét alakban érkezhet, és
   * egy `//documents` út a szerveren 404-et adna -- a képernyőn pedig ugyanúgy
   * üres csempeként jelenne meg, mint a mai hiány.
   */
  it("does not double the slash when the base ends with one", () => {
    const forras = documentImageSource({
      apiUrl: "https://api.acropora.hu/",
      token: "abc",
      ownerPath: "/service/worksheets/ws-1",
      documentId: "doc-1",
      variant: "original",
    });
    assert.doesNotMatch(forras.uri, /\/\/documents/);
  });

  /**
   * A KET VALTOZAT KET KULONBOZO CIM, ES EZ AZ AZ ALLITAS, AMI ACROBOT
   * MEGKOTESET ORZI (2026-09-18): a teljes kepernyos nezet NEM a belyegkepet
   * keri.
   *
   * MIERT EZ A FONTOSABB A KETTOBOL: a csempe gyorsulasa LATSZIK, a nagy kep
   * elmosodasa NEM. Egy elmosodott szerviz-fenykepet senki nem jelent be
   * hibakent -- csak egyszer csak nem lehet elolvasni rola a tipustablat.
   */
  it("a csempe belyegkepet ker, a teljes nezet NEM", () => {
    const kozos = {
      apiUrl: "https://api.acropora.hu",
      token: "abc",
      ownerPath: "/service/assets/a-1",
      documentId: "doc-1",
    } as const;

    assert.equal(
      documentImageSource({ ...kozos, variant: "thumbnail" }).uri,
      "https://api.acropora.hu/service/assets/a-1/documents/doc-1?variant=thumbnail",
    );
    assert.equal(
      documentImageSource({ ...kozos, variant: "original" }).uri,
      "https://api.acropora.hu/service/assets/a-1/documents/doc-1",
    );
  });

  it("escapes an identifier that would break the path", () => {
    const forras = documentImageSource({
      apiUrl: "https://api.acropora.hu",
      token: "abc",
      ownerPath: "/service/worksheets/ws-1",
      documentId: "a/b",
      variant: "original",
    });
    assert.match(forras.uri, /documents\/a%2Fb$/);
  });
});

describe("describeDocuments", () => {
  it("says nothing when there is a picture to show", () => {
    assert.equal(
      describeDocuments({ loading: false, error: false, total: 2, images: 1 }),
      null,
    );
  });

  /**
   * A NÉGY ÜRES-ESET NÉGY KÜLÖN MONDAT. Egy közös „nincs fénykép" a betöltés és
   * a hiba esetére is azt ÁLLÍTANÁ, hogy nincs -- holott olyankor csak nem
   * tudjuk. A kettő teendője ellentétes: az egyikre várni kell, a másikra
   * újrapróbálni.
   */
  it("tells loading, failure and genuinely empty apart", () => {
    const tolt = describeDocuments({
      loading: true,
      error: false,
      total: 0,
      images: 0,
    });
    const hiba = describeDocuments({
      loading: false,
      error: true,
      total: 0,
      images: 0,
    });
    const ures = describeDocuments({
      loading: false,
      error: false,
      total: 0,
      images: 0,
    });
    const csakEgyeb = describeDocuments({
      loading: false,
      error: false,
      total: 2,
      images: 0,
    });
    const mind = [tolt, hiba, ures, csakEgyeb];
    assert.equal(new Set(mind).size, 4, `nem négy külön mondat: ${mind}`);
    assert.doesNotMatch(hiba ?? "", /nincs csatolmány/);
  });

  it("prefers the failure over the loading state", () => {
    assert.equal(
      describeDocuments({ loading: true, error: true, total: 0, images: 0 }),
      describeDocuments({ loading: false, error: true, total: 0, images: 0 }),
    );
  });
});

describe("describeUnviewableDocument", () => {
  /**
   * KIMONDJA, HOGY ITT NEM NYITHATÓ MEG. Enélkül a szerelő koppintgatna rajta,
   * és azt hinné, elromlott.
   */
  it("names the file and says where it opens", () => {
    const mondat = describeUnviewableDocument(
      doc({ fileName: "szamla.pdf", contentType: "application/pdf" }),
    );
    assert.match(mondat, /szamla\.pdf/);
    assert.match(mondat, /webes felületen/);
  });
});

describe("formatDocumentSize", () => {
  it("keeps bytes small, kilobytes round and megabytes with one decimal", () => {
    assert.equal(formatDocumentSize(512), "512 B");
    assert.equal(formatDocumentSize(2048), "2 kB");
    assert.equal(formatDocumentSize(3 * 1024 * 1024), "3.0 MB");
  });
});
