import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFcmError, shouldRetire } from "./fcm.client.js";

/**
 * A NYUGDIJAZASI SZABALY A LEGKENYESEBB RESZ EBBEN A MODULBAN.
 *
 * Egy tevesen eldobott token NEMA kart okoz: a telefon lekerul az
 * ertesitesekrol, es senki nem keresi, miert. Ezert all ra sajat allitas-keszlet
 * -- kulon a ket „dobd el" esetre, es KULON arra, amit NEM szabad eldobni.
 */
describe("mikor kell eldobni az androidos tokent", () => {
  it("a 404 (UNREGISTERED) eldobja: az app torolve vagy a token lejart", () => {
    assert.equal(
      shouldRetire({ status: 404, errorStatus: "UNREGISTERED", fields: [] }),
      true,
    );
  });

  it("a SENDER_ID_MISMATCH eldobja: a token MAS kuldohoz tartozik", () => {
    assert.equal(
      shouldRetire({
        status: 403,
        errorStatus: "SENDER_ID_MISMATCH",
        fields: [],
      }),
      true,
    );
  });

  /**
   * AZ `INVALID_ARGUMENT` KET DOLGOT JELENTHET, ES A KETTO KOZOTT A MEZONEV
   * DONT. Ha a tokenre mutat, a token soha nem volt a mienk; ha barmi masra,
   * akkor MI kuldtunk rossz alaku uzenetet -- es akkor egy SAJAT hibank venne
   * le a kollegat az ertesitesekrol.
   */
  it("INVALID_ARGUMENT a TOKEN mezore: eldobja", () => {
    assert.equal(
      shouldRetire({
        status: 400,
        errorStatus: "INVALID_ARGUMENT",
        fields: ["message.token"],
      }),
      true,
    );
  });

  it("INVALID_ARGUMENT MAS mezore: NEM dobja el (a mi hibank)", () => {
    assert.equal(
      shouldRetire({
        status: 400,
        errorStatus: "INVALID_ARGUMENT",
        fields: ["message.notification.title"],
      }),
      false,
    );
  });

  it("INVALID_ARGUMENT megnevezett mezo NELKUL: NEM dobja el", () => {
    assert.equal(
      shouldRetire({
        status: 400,
        errorStatus: "INVALID_ARGUMENT",
        fields: [],
      }),
      false,
    );
  });

  /**
   * AZ ATMENETI HIBAK NEM NYUGDIJAZNAK. Egy perc mulva ugyanaz a token mukodik,
   * es egy szolgaltatas-kimaradas miatt eldobott token vegleg elveszne.
   */
  for (const [status, errorStatus] of [
    [503, "UNAVAILABLE"],
    [500, "INTERNAL"],
    [429, "QUOTA_EXCEEDED"],
    [401, "UNAUTHENTICATED"],
  ] as const)
    it(`a ${status} (${errorStatus}) NEM dobja el`, () => {
      assert.equal(shouldRetire({ status, errorStatus, fields: [] }), false);
    });
});

describe("a hibavalasz kiolvasasa", () => {
  it("kiolvassa az allapotot es a megnevezett mezoket", () => {
    const hiba = readFcmError(
      JSON.stringify({
        error: {
          status: "INVALID_ARGUMENT",
          message: "The registration token is not a valid FCM token",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [{ field: "message.token" }],
            },
          ],
        },
      }),
    );
    assert.equal(hiba.errorStatus, "INVALID_ARGUMENT");
    assert.deepEqual(hiba.fields, ["message.token"]);
  });

  /**
   * A NEM JSON VALASZ NEM DOBHAT. Egy atjaro HTML hibaoldala vagy egy ures torzs
   * rendes eset egy halozati hibanal -- ha ez dobna, a kivetel a teljes
   * ertesites-kort vinne el, nem csak ezt az egy cimzettet.
   */
  it("nem JSON torzsre ures valaszt ad, nem dob", () => {
    assert.deepEqual(readFcmError("<html>502</html>"), {
      errorStatus: null,
      message: null,
      fields: [],
    });
    assert.deepEqual(readFcmError(""), {
      errorStatus: null,
      message: null,
      fields: [],
    });
  });
});
