import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FCM_SERVICE_ACCOUNT_ENV,
  readFcmConfig,
  readServiceAccountJson,
} from "./fcm.config.js";

const FIOK = {
  type: "service_account",
  project_id: "acropora-os-5b75a",
  client_email: "push@acropora-os-5b75a.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n",
};

const JSON_SZOVEG = JSON.stringify(FIOK);
const BASE64 = Buffer.from(JSON_SZOVEG).toString("base64");

describe("a szolgaltatasfiok beolvasasa", () => {
  it("base64 alakot elfogad", () => {
    assert.equal(readServiceAccountJson(BASE64), JSON_SZOVEG);
  });

  /**
   * A NYERS JSON A LEGKOZELEBBI TEVESZTES, AMI MEGIS HELYES. A titkot ember
   * illeszti be egy webes mezobe; ha ezt elutasitanank, a hiba a JSON-elemzobe
   * kerulne, ott, ahol mar nem latszik, hogy a BEALLITAS volt rossz.
   */
  it("nyers JSON alakot is elfogad", () => {
    assert.equal(readServiceAccountJson(`  ${JSON_SZOVEG}  `), JSON_SZOVEG);
  });

  it("ertelmezhetetlen erteket elutasit", () => {
    assert.equal(readServiceAccountJson("nem ez a kulcs"), null);
  });
});

describe("az androidos kuldes beallitasa", () => {
  it("hianyzo valtozonal MISSING, nem INVALID", () => {
    const result = readFcmConfig({});
    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, [FCM_SERVICE_ACCOUNT_ENV]);
    assert.deepEqual(result.invalid, []);
  });

  it("base64 ertekbol felolvassa a harom mezot", () => {
    const result = readFcmConfig({ [FCM_SERVICE_ACCOUNT_ENV]: BASE64 });
    assert.equal(result.configured, true);
    if (!result.configured) return;
    assert.equal(result.config.projectId, "acropora-os-5b75a");
    assert.equal(
      result.config.clientEmail,
      "push@acropora-os-5b75a.iam.gserviceaccount.com",
    );
    assert.match(result.config.privateKey, /BEGIN PRIVATE KEY/);
  });

  /**
   * A BEALLITOTT, DE ERTELMEZHETETLEN ERTEK NEM HIANY.
   *
   * A valtozo OTT VAN. Ha hianykent jelentenenk, a telepito a Coolify feluleten
   * azt a valtozot keresne, ami ott all -- es nem talalna, mert nem hianyzik.
   * Ugyanaz a szetvalasztas, amit az Apple-oldal is kimond.
   */
  it("ertelmezhetetlen ertek INVALID, nem MISSING", () => {
    const result = readFcmConfig({ [FCM_SERVICE_ACCOUNT_ENV]: "szemet" });
    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, [FCM_SERVICE_ACCOUNT_ENV]);
  });

  it("hianyzo mezovel INVALID, nem felig beallitott", () => {
    const fel = Buffer.from(
      JSON.stringify({ project_id: "csak-ennyi" }),
    ).toString("base64");
    const result = readFcmConfig({ [FCM_SERVICE_ACCOUNT_ENV]: fel });
    assert.equal(result.configured, false);
    if (result.configured) return;
    assert.deepEqual(result.invalid, [FCM_SERVICE_ACCOUNT_ENV]);
  });
});
