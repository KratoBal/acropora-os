import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { CarrierError, carrierMode } from "./carrier.types.js";
import { carrierClientFor } from "./carrier-client.factory.js";
import {
  FOXPOST_API_URL,
  FoxpostApiClient,
  type FoxpostApiConfig,
} from "./foxpost-api.client.js";
import {
  GLS_API_URL,
  GLS_DEFAULT_PICKUP,
  GLS_LABEL_CONTENT_MAX,
  glsLabelContent,
  GlsApiClient,
  type GlsApiConfig,
  glsPasswordBytes,
  glsPickupAddress,
  splitStreet,
  wcfDate,
} from "./gls-api.client.js";
import {
  SHIPMENT_REFERENCE_MAX_LENGTH,
  shipmentReference,
} from "./shipment-reference.js";
import {
  StubCarrierClient,
  isStubParcelNumber,
} from "./stub-carrier.client.js";

// A fixturak kitalaltak: nem valodi vevo, nem valodi automata, nem valodi kulcs.
const RECIPIENT = {
  name: "Teszt Címzett",
  phone: "+36000000000",
  email: "cimzett@example.test",
};
const POINT = { kind: "point" as const, pointId: "TESZTPONT01" };
const FOXPOST: FoxpostApiConfig = {
  baseUrl: FOXPOST_API_URL.test,
  user: "teszt-felhasznalo",
  password: "teszt-jelszo",
  apiKey: "teszt-kulcs",
};
const GLS: GlsApiConfig = {
  baseUrl: GLS_API_URL.test,
  username: "teszt@example.test",
  password: "teszt-jelszo",
  clientNumber: 100000001,
};
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n", "latin1");

type Call = { url: string; init: RequestInit };

/** Egy hamis fetch: rogziti a hivasokat, es sorban adja a valaszokat. */
function fakeFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error("unexpected fetch call");
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const silent = { warn: () => {} };

async function carrierError(promise: Promise<unknown>): Promise<CarrierError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof CarrierError,
      `expected CarrierError, got ${String(error)}`,
    );
    return error;
  }
  assert.fail("expected a CarrierError");
}

describe("FoxpostApiClient", () => {
  it("creates a parcel with Basic auth, the api-key header and a one-element array body", async () => {
    const fetch = fakeFetch(
      json(
        { valid: true, parcels: [{ barcode: "CLFOX000000000000001" }] },
        201,
      ),
    );
    const client = new FoxpostApiClient(FOXPOST, fetch.impl, silent);

    const parcel = await client.createParcel({
      reference: "1042",
      recipient: RECIPIENT,
      destination: POINT,
      size: "m",
      codHuf: 12490,
    });

    assert.deepEqual(parcel, { parcelNumber: "CLFOX000000000000001" });
    assert.equal(fetch.calls.length, 1);
    const { url, init } = fetch.calls[0]!;
    assert.equal(url, "https://webapi-test.foxpost.hu/api/parcel");
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from("teszt-felhasznalo:teszt-jelszo").toString("base64")}`,
    );
    assert.equal(headers["api-key"], "teszt-kulcs");
    assert.deepEqual(JSON.parse(String(init.body)), [
      {
        recipientName: "Teszt Címzett",
        recipientPhone: "+36000000000",
        recipientEmail: "cimzett@example.test",
        refCode: "1042",
        size: "m",
        cod: 12490,
        destination: "TESZTPONT01",
      },
    ]);
  });

  it("sends a home delivery as address fields, not as a destination", async () => {
    const fetch = fakeFetch(
      json({ valid: true, parcels: [{ barcode: "CLFOX000000000000002" }] }),
    );
    await new FoxpostApiClient(FOXPOST, fetch.impl, silent).createParcel({
      reference: "1043",
      recipient: RECIPIENT,
      destination: {
        kind: "home",
        zip: "1000",
        city: "Tesztváros",
        address: "Teszt utca 1.",
      },
    });
    const [body] = JSON.parse(String(fetch.calls[0]!.init.body));
    assert.equal(body.destination, undefined);
    assert.equal(body.cod, undefined);
    assert.deepEqual(
      [body.recipientZip, body.recipientCity, body.recipientAddress],
      ["1000", "Tesztváros", "Teszt utca 1."],
    );
    assert.equal(body.deliveryNote, undefined);
  });

  /*
    THE COURIER NOTE (commerce #493): Foxpost's own field for the home
    delivery courier, 50 characters (test API v1.2.14). A point has no
    courier at the door, so it never goes there.
  */
  it("a home delivery carries the courier note in deliveryNote, cut to 50; a point does not", async () => {
    const note = "Csengess kétszer, a kapu kódja 1234, a lépcsőház bal oldalt";
    const sent = async (
      destination: Parameters<
        FoxpostApiClient["createParcel"]
      >[0]["destination"],
    ) => {
      const fetch = fakeFetch(
        json({ valid: true, parcels: [{ barcode: "CLFOX000000000000003" }] }),
      );
      await new FoxpostApiClient(FOXPOST, fetch.impl, silent).createParcel({
        reference: "1044",
        recipient: RECIPIENT,
        destination,
        courierNote: note,
      });
      return JSON.parse(String(fetch.calls[0]!.init.body))[0];
    };
    const home = await sent({
      kind: "home",
      zip: "1000",
      city: "Tesztváros",
      address: "Teszt utca 1.",
    });
    assert.equal(home.deliveryNote, Array.from(note).slice(0, 50).join(""));
    const point = await sent(POINT);
    assert.equal(point.deliveryNote, undefined);
  });

  it("fails loudly when the create answer has no barcode, logging key names but no values", async () => {
    const logged: string[] = [];
    const fetch = fakeFetch(
      json({
        valid: true,
        parcels: [{ clFox: "X", recipientName: "Teszt Címzett" }],
      }),
    );
    const client = new FoxpostApiClient(FOXPOST, fetch.impl, {
      warn: (m) => logged.push(m),
    });

    const error = await carrierError(
      client.createParcel({
        reference: "1",
        recipient: RECIPIENT,
        destination: POINT,
      }),
    );

    assert.equal(error.code, "UNEXPECTED_RESPONSE");
    assert.equal(logged.length, 1);
    assert.match(logged[0]!, /clFox, recipientName/);
    assert.doesNotMatch(logged[0]!, /Teszt Címzett/);
  });

  it("maps a field error on the destination to INVALID_POINT, with a Hungarian message", async () => {
    const fetch = fakeFetch(
      json({
        valid: false,
        parcels: [
          {
            errors: [{ field: "destination", message: "INVALID_DESTINATION" }],
          },
        ],
      }),
    );
    const error = await carrierError(
      new FoxpostApiClient(FOXPOST, fetch.impl, silent).createParcel({
        reference: "1",
        recipient: RECIPIENT,
        destination: POINT,
      }),
    );
    assert.equal(error.code, "INVALID_POINT");
    assert.equal(
      error.userMessage,
      "Érvénytelen átvételi pont. Frissítsd a pontot és próbáld újra.",
    );
    assert.match(error.detail ?? "", /INVALID_DESTINATION/);
    assert.doesNotMatch(error.userMessage, /INVALID_DESTINATION/);
  });

  it("maps HTTP failures: 401 not configured, 503 unavailable, 400 rejected, abort a timeout", async () => {
    const input = { reference: "1", recipient: RECIPIENT, destination: POINT };
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetch = fakeFetch(
      new Response("", { status: 401 }),
      new Response("", { status: 503 }),
      json({ error: "bad request" }, 400),
      abort,
      new TypeError("fetch failed"),
    );
    const client = new FoxpostApiClient(FOXPOST, fetch.impl, silent);
    const codes = [];
    for (let i = 0; i < 5; i += 1)
      codes.push((await carrierError(client.createParcel(input))).code);
    assert.deepEqual(codes, [
      "NOT_CONFIGURED",
      "SERVICE_UNAVAILABLE",
      "REJECTED",
      "TIMEOUT",
      "SERVICE_UNAVAILABLE",
    ]);
  });

  it("asks for an A6 label on the existing barcode and refuses a non-PDF answer", async () => {
    const fetch = fakeFetch(
      new Response(PDF),
      new Response("<html>"),
      json({ error: "x" }, 404),
    );
    const client = new FoxpostApiClient(FOXPOST, fetch.impl, silent);

    assert.deepEqual(
      await client.labelPdf({ parcelNumber: "CLFOX000000000000001" }),
      PDF,
    );
    assert.equal(
      fetch.calls[0]!.url,
      "https://webapi-test.foxpost.hu/api/label/A6",
    );
    assert.deepEqual(JSON.parse(String(fetch.calls[0]!.init.body)), [
      "CLFOX000000000000001",
    ]);
    assert.equal(
      (await carrierError(client.labelPdf({ parcelNumber: "CLFOX1" }))).code,
      "LABEL_FAILED",
    );
    assert.equal(
      (await carrierError(client.labelPdf({ parcelNumber: "CLFOX1" }))).code,
      "LABEL_FAILED",
    );
  });

  it("maps the tracking traces", async () => {
    const fetch = fakeFetch(
      json({
        clFox: "CLFOX000000000000001",
        traces: [
          {
            statusDate: "2026-10-05T10:00:00",
            shortName: "Feladva",
            longName: "A csomagot feladták",
            status: "CREATE",
          },
        ],
      }),
    );
    const events = await new FoxpostApiClient(
      FOXPOST,
      fetch.impl,
      silent,
    ).tracking({ parcelNumber: "CLFOX000000000000001" });
    assert.equal(
      fetch.calls[0]!.url,
      "https://webapi-test.foxpost.hu/api/tracking/CLFOX000000000000001",
    );
    assert.deepEqual(
      events.map((e) => [e.status, e.statusText]),
      [["CREATE", "A csomagot feladták"]],
    );
    assert.ok(
      events[0]!.at instanceof Date && !Number.isNaN(events[0]!.at.getTime()),
    );
  });

  it("deletes by barcode", async () => {
    const fetch = fakeFetch(new Response(null, { status: 204 }));
    await new FoxpostApiClient(FOXPOST, fetch.impl, silent).cancelParcel({
      parcelNumber: "CLFOX000000000000001",
    });
    assert.equal(fetch.calls[0]!.init.method, "DELETE");
    assert.equal(
      fetch.calls[0]!.url,
      "https://webapi-test.foxpost.hu/api/parcel/CLFOX000000000000001",
    );
  });

  it("without credentials stops before any network call", async () => {
    const fetch = fakeFetch();
    const error = await carrierError(
      new FoxpostApiClient(null, fetch.impl, silent).createParcel({
        reference: "1",
        recipient: RECIPIENT,
        destination: POINT,
      }),
    );
    assert.equal(error.code, "NOT_CONFIGURED");
    assert.equal(fetch.calls.length, 0);
  });
});

describe("GlsApiClient", () => {
  it("sends the password as the SHA512 digest's bytes", () => {
    const bytes = glsPasswordBytes("teszt-jelszo");
    assert.equal(bytes.length, 64);
    assert.deepEqual(
      Buffer.from(bytes),
      createHash("sha512").update("teszt-jelszo").digest(),
    );
  });

  it("creates a point parcel through PrintLabels with the PSD service", async () => {
    const fetch = fakeFetch(
      json({
        PrintLabelsInfoList: [{ ParcelId: 77, ParcelNumber: 5000000001 }],
        PrintLabelsErrorList: [],
      }),
    );
    const parcel = await new GlsApiClient(GLS, fetch.impl).createParcel({
      reference: "1042",
      recipient: RECIPIENT,
      destination: POINT,
      codHuf: 9990,
    });

    assert.deepEqual(parcel, {
      parcelNumber: "5000000001",
      carrierParcelId: "77",
    });
    assert.equal(
      fetch.calls[0]!.url,
      "https://api.test.mygls.hu/ParcelService.svc/json/PrintLabels",
    );
    const body = JSON.parse(String(fetch.calls[0]!.init.body));
    assert.equal(body.Username, "teszt@example.test");
    assert.deepEqual(body.Password, glsPasswordBytes("teszt-jelszo"));
    assert.deepEqual(body.ClientNumberList, [100000001]);
    const [sent] = body.ParcelList;
    assert.equal(sent.ClientReference, "1042");
    assert.equal(sent.CODAmount, 9990);
    assert.deepEqual(sent.ServiceList, [
      { Code: "PSD", PSDParameter: { StringValue: "TESZTPONT01" } },
    ]);
  });

  /*
    BALÁZS GLS-BEÁLLÍTÁSA (emlék 2109) és a MÉRT címke alakja (acrobot 26533,
    3422774543). MI PIROSÍT: a felvételi cím kimarad a törzsből (élesben ezen
    akadna el, és eddig néma volt; murena 26523 kérése); az utánvét
    hivatkozása nem a számla sorszáma; a címke szövege nem megy; házhoz nem
    FDS megy a vevő e-mailjével; az utca és a házszám egy mezőben marad.
  */
  it("sends the pickup address, the label text and the invoice number as the COD reference", async () => {
    const fetch = fakeFetch(
      json({
        PrintLabelsInfoList: [{ ParcelId: 77, ParcelNumber: 5000000001 }],
        PrintLabelsErrorList: [],
      }),
    );
    await new GlsApiClient(GLS, fetch.impl).createParcel({
      reference: "1042",
      recipient: RECIPIENT,
      destination: POINT,
      codHuf: 9990,
      codReference: "ACR-2026-00042",
      labelContent: "Rendelés #1042",
    });
    const [sent] = JSON.parse(String(fetch.calls[0]!.init.body)).ParcelList;
    assert.deepEqual(sent.PickupAddress, GLS_DEFAULT_PICKUP);
    assert.match(sent.PickupDate, /^\/Date\(\d+\)\/$/);
    assert.equal(sent.Content, "Rendelés #1042");
    assert.equal(sent.CODReference, "ACR-2026-00042");
  });

  /*
    THE CUT IS UNMEASURED (acrobot 26572): MyGLS's own limit is not known, so
    the text is cut to 40 characters rather than risk a refused label.
  */
  it("cuts the label text to 40 characters, never inside an accented letter", async () => {
    const fetch = fakeFetch(
      json({
        PrintLabelsInfoList: [{ ParcelId: 79, ParcelNumber: 5000000003 }],
        PrintLabelsErrorList: [],
      }),
    );
    await new GlsApiClient(GLS, fetch.impl).createParcel({
      reference: "1044",
      recipient: RECIPIENT,
      destination: POINT,
      labelContent: "Rendelés #1044 · csengessen kétszer, a kapu nyitva van",
    });
    const [sent] = JSON.parse(String(fetch.calls[0]!.init.body)).ParcelList;
    assert.equal(sent.Content, "Rendelés #1044 · csengessen kétszer, a k");
    assert.equal(
      Array.from(sent.Content as string).length,
      GLS_LABEL_CONTENT_MAX,
    );
    assert.equal(glsLabelContent("  Rendelés #1  "), "Rendelés #1");
  });

  it("home delivery: FDS with the buyer's e-mail, street and house number apart", async () => {
    const fetch = fakeFetch(
      json({
        PrintLabelsInfoList: [{ ParcelId: 78, ParcelNumber: 5000000002 }],
        PrintLabelsErrorList: [],
      }),
    );
    await new GlsApiClient(GLS, fetch.impl).createParcel({
      reference: "1043",
      recipient: RECIPIENT,
      destination: {
        kind: "home",
        zip: "1117",
        city: "Budapest",
        address: "Fehérvári út 24.",
      },
    });
    const [sent] = JSON.parse(String(fetch.calls[0]!.init.body)).ParcelList;
    assert.deepEqual(sent.ServiceList, [
      { Code: "FDS", FDSParameter: { Value: "cimzett@example.test" } },
    ]);
    assert.deepEqual(
      [
        sent.DeliveryAddress.Street,
        sent.DeliveryAddress.HouseNumber,
        sent.DeliveryAddress.ZipCode,
      ],
      ["Fehérvári út", "24", "1117"],
    );
    assert.equal("CODAmount" in sent, false);
  });

  it("splits the house number off the end only; the pickup address follows the environment", () => {
    assert.deepEqual(splitStreet("Október huszonharmadika u. 8-10."), {
      Street: "Október huszonharmadika u.",
      HouseNumber: "8-10",
    });
    assert.deepEqual(splitStreet("Fő tér"), {
      Street: "Fő tér",
      HouseNumber: "",
    });
    assert.deepEqual(glsPickupAddress({}), GLS_DEFAULT_PICKUP);
    assert.equal(
      glsPickupAddress({ GLS_PICKUP_ZIP: "1111", GLS_PICKUP_EMAIL: "x@y.hu" })
        .ZipCode,
      "1111",
    );
  });

  it("reads the error list of a 200 answer (MyGLS rejects with HTTP 200)", async () => {
    const fetch = fakeFetch(
      json({
        PrintLabelsInfoList: [],
        PrintLabelsErrorList: [
          { ErrorCode: 13, ErrorDescription: "Invalid zip code" },
        ],
      }),
      json({
        PrintLabelsErrorList: [
          { ErrorCode: 1, ErrorDescription: "Unauthorized access" },
        ],
      }),
      json({
        ParcelStatusList: [],
        GetParcelStatusErrors: [
          { ErrorCode: 2, ErrorDescription: "Parcel not found" },
        ],
      }),
    );
    const client = new GlsApiClient(GLS, fetch.impl);
    const input = { reference: "1", recipient: RECIPIENT, destination: POINT };

    const rejected = await carrierError(client.createParcel(input));
    assert.equal(rejected.code, "REJECTED");
    assert.match(rejected.detail ?? "", /Invalid zip code/);
    assert.doesNotMatch(rejected.userMessage, /Invalid zip code/);
    assert.equal(
      (await carrierError(client.createParcel(input))).code,
      "NOT_CONFIGURED",
    );
    assert.equal(
      (await carrierError(client.tracking({ parcelNumber: "5000000001" })))
        .code,
      "REJECTED",
    );
  });

  it("needs the ParcelId for the label and the delete, and asks nothing without it", async () => {
    const fetch = fakeFetch();
    const client = new GlsApiClient(GLS, fetch.impl);
    assert.equal(
      (await carrierError(client.labelPdf({ parcelNumber: "5000000001" })))
        .code,
      "LABEL_FAILED",
    );
    assert.equal(
      (await carrierError(client.cancelParcel({ parcelNumber: "5000000001" })))
        .code,
      "REJECTED",
    );
    assert.equal(fetch.calls.length, 0);
  });

  it("takes the label as a byte array and checks it is a PDF", async () => {
    const fetch = fakeFetch(
      json({ Labels: [...PDF], GetPrintedLabelsErrorList: [] }),
    );
    const pdf = await new GlsApiClient(GLS, fetch.impl).labelPdf({
      parcelNumber: "5000000001",
      carrierParcelId: "77",
    });
    assert.deepEqual(pdf, PDF);
    assert.deepEqual(
      JSON.parse(String(fetch.calls[0]!.init.body)).ParcelIdList,
      [77],
    );
  });

  it("parses the WCF date of the tracking", () => {
    assert.equal(
      wcfDate("/Date(1759658400000+0200)/")?.toISOString(),
      "2025-10-05T10:00:00.000Z",
    );
    assert.equal(wcfDate("nem datum"), null);
  });
});

describe("the stub and the switch", () => {
  it("gives a STUB- number, the same one for the same reference", async () => {
    const client = new StubCarrierClient("foxpost");
    const input = {
      reference: "1042",
      recipient: RECIPIENT,
      destination: POINT,
    };
    const first = await client.createParcel(input);
    assert.ok(isStubParcelNumber(first.parcelNumber));
    assert.match(first.parcelNumber, /^STUB-FOXPOST-[0-9A-F]{12}$/);
    assert.deepEqual(await client.createParcel(input), first);
    assert.notEqual(
      (await new StubCarrierClient("gls").createParcel(input)).parcelNumber,
      first.parcelNumber,
    );
    assert.equal(
      (await client.labelPdf()).subarray(0, 4).toString("latin1"),
      "%PDF",
    );
  });

  it("is the stub unless test or live is set explicitly", () => {
    for (const value of [undefined, "", "LIVE", "production", "true"])
      assert.equal(carrierMode(value), "stub");
    assert.equal(carrierMode("test"), "test");
    assert.equal(carrierMode("live"), "live");
    assert.ok(carrierClientFor("foxpost", {}) instanceof StubCarrierClient);
    assert.ok(
      carrierClientFor("gls", { FOXPOST_API_MODE: "live" }) instanceof
        StubCarrierClient,
    );
  });

  it("in live mode without credentials refuses instead of falling back to the stub", async () => {
    const fetch = fakeFetch();
    const client = carrierClientFor(
      "foxpost",
      { FOXPOST_API_MODE: "live" },
      fetch.impl,
    );
    assert.ok(client instanceof FoxpostApiClient);
    const error = await carrierError(
      client.createParcel({
        reference: "1",
        recipient: RECIPIENT,
        destination: POINT,
      }),
    );
    assert.equal(error.code, "NOT_CONFIGURED");
    assert.equal(fetch.calls.length, 0);
  });

  it("test mode goes to the test host, never the live one", async () => {
    const fetch = fakeFetch(
      json({ valid: true, parcels: [{ barcode: "CLFOX000000000000003" }] }),
    );
    const client = carrierClientFor(
      "foxpost",
      {
        FOXPOST_API_MODE: "test",
        FOXPOST_API_USER: "u",
        FOXPOST_API_PASSWORD: "p",
        FOXPOST_API_KEY: "k",
      },
      fetch.impl,
    );
    await client.createParcel({
      reference: "1",
      recipient: RECIPIENT,
      destination: POINT,
    });
    assert.match(fetch.calls[0]!.url, /^https:\/\/webapi-test\.foxpost\.hu\//);
  });
});

describe("shipmentReference", () => {
  it("is the order number (display id) without the #", () => {
    assert.equal(shipmentReference({ displayId: 1042 }), "1042");
    assert.equal(shipmentReference({ displayId: "#1042" }), "1042");
  });

  it("refuses an empty or too long reference instead of cutting it", () => {
    assert.throws(() => shipmentReference({ displayId: " " }));
    assert.throws(() =>
      shipmentReference({
        displayId: "9".repeat(SHIPMENT_REFERENCE_MAX_LENGTH + 1),
      }),
    );
    assert.equal(
      shipmentReference({
        displayId: "9".repeat(SHIPMENT_REFERENCE_MAX_LENGTH),
      }).length,
      30,
    );
  });
});
