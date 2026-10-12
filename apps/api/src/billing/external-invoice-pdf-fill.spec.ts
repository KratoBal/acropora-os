import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSzamlazzAgentPdfXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  HttpSzamlazzAgentClient,
  SzamlazzAgentHttpError,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { main } from "./external-invoice-pdf.cli.js";
import {
  fillExternalInvoicePdfs,
  monthRange,
  type ExternalPdfCandidate,
  type ExternalPdfStore,
} from "./external-invoice-pdf-fill.js";

/**
 * A SZÁMLÁZZ.HU-N KIÁLLÍTOTT SZÁMLA PDF-JE (hétfői lista N1). MI PIROSÍT: a
 * kérés rossz mezőnéven vagy a séma sorrendjén kívül megy; egy hibás vagy nem
 * PDF válasz bekerül a tárba; egy meg nem jött PDF ok nélkül marad (csendben
 * kiesik); egy hiba megállítja a többi számlát; a száraz futás hívja a
 * Számlázz.hu-t.
 */
const PDF = Buffer.from("%PDF-1.4\n%valami\n");

const valasz = (
  over: Partial<SzamlazzAgentResponse> = {},
): SzamlazzAgentResponse => ({ successful: true, pdf: PDF, ...over });

const jelolt = (n: number): ExternalPdfCandidate => ({
  id: `e${n}`,
  documentNumber: `ACRW-2026/0050${n}`,
  issueDate: new Date("2026-09-15T00:00:00Z"),
});

function tar() {
  const puts: string[] = [];
  const marks: [string, string | null, string | null][] = [];
  return {
    puts,
    marks,
    documents: {
      put: async (key: {
        owner: string;
        ownerId: string;
        documentId: string;
      }) => void puts.push(`${key.owner}/${key.ownerId}/${key.documentId}`),
    },
    store: {
      setPdf: async (id: string, key: string | null, reason: string | null) =>
        void marks.push([id, key, reason]),
    },
  };
}

describe("a PDF-kérés", () => {
  it("a séma sorrendjében: kulcs, számlaszám, válaszverzió 2, és semmi más", () => {
    const xml = buildSzamlazzAgentPdfXml({
      agentKey: "k<1>",
      invoiceNumber: "ACRW-2026/00501",
    });
    assert.match(
      xml,
      /<xmlszamlapdf xmlns="http:\/\/www\.szamlazz\.hu\/xmlszamlapdf"[^>]*><szamlaagentkulcs>k&lt;1&gt;<\/szamlaagentkulcs><szamlaszam>ACRW-2026\/00501<\/szamlaszam><valaszVerzio>2<\/valaszVerzio><\/xmlszamlapdf>$/,
    );
  });

  it("az action-szamla_agent_pdf mezőn megy, és a base64 PDF-et adja vissza", async () => {
    let mezo: unknown;
    const client = new HttpSzamlazzAgentClient(
      "https://example.invalid/szamla/",
      (async (_url: string | URL, init?: RequestInit) => {
        mezo = (init?.body as FormData).get("action-szamla_agent_pdf");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>true</sikeres><szamlaszam>ACRW-2026/00501</szamlaszam><pdf>${PDF.toString("base64")}</pdf></xmlszamlavalasz>`,
          { status: 200 },
        );
      }) as typeof fetch,
    );
    const r = await client.downloadInvoicePdf("<xmlszamlapdf/>");
    assert.ok(mezo instanceof Blob);
    assert.equal(await (mezo as Blob).text(), "<xmlszamlapdf/>");
    assert.deepEqual(r.pdf, PDF);
  });
});

describe("a pótlás", () => {
  it("a megjött PDF a tárba és a sorra kerül; a hiba okkal jelölt, és nem állítja meg a többit", async () => {
    const t = tar();
    const valaszok = [
      () => valasz({ successful: false, errorCode: "7", pdf: undefined }),
      () => {
        throw new SzamlazzAgentHttpError(500, "");
      },
      () => valasz({ pdf: Buffer.from("<html>hiba</html>") }),
      () => valasz({ pdf: Buffer.alloc(0) }),
      () => valasz(),
    ];
    const out = await fillExternalInvoicePdfs({
      candidates: [1, 2, 3, 4, 5].map(jelolt),
      agentKey: "k",
      client: { downloadInvoicePdf: async () => valaszok.shift()!() },
      documents: t.documents,
      store: t.store,
    });
    assert.deepEqual(t.marks, [
      ["e1", null, "SZAMLAZZ_PDF_REJECTED_7"],
      ["e2", null, "SZAMLAZZ_PDF_HTTP_500"],
      ["e3", null, "SZAMLAZZ_PDF_NOT_PDF"],
      ["e4", null, "SZAMLAZZ_PDF_EMPTY"],
      ["e5", "external-invoices/e5/szamlazz.pdf", null],
    ]);
    assert.deepEqual(t.puts, ["external-invoice/e5/szamlazz.pdf"]);
    assert.deepEqual(
      out.map((o) => o.kind),
      ["FAILED", "FAILED", "FAILED", "FAILED", "STORED"],
    );
  });

  it("egy tár- vagy adatbázis-hiba csak annál a számlánál áll meg (barracuda, #1658)", async () => {
    const t = tar();
    let put = 0;
    const out = await fillExternalInvoicePdfs({
      candidates: [1, 2].map(jelolt),
      agentKey: "k",
      client: { downloadInvoicePdf: async () => valasz() },
      documents: {
        put: async (key) => {
          if (put++ === 0) throw new Error("a tár megtelt");
          return t.documents.put(key);
        },
      },
      store: {
        // a hiba-jelölés maga is elbukik: a futás akkor is megy tovább
        setPdf: async (id, key, reason) => {
          if (reason) throw new Error("adatbázis");
          return t.store.setPdf(id, key, reason);
        },
      },
    });
    assert.deepEqual(
      out.map((o) => [
        o.documentNumber,
        o.kind === "FAILED" ? o.reason : o.kind,
      ]),
      [
        ["ACRW-2026/00501", "SZAMLAZZ_PDF_STORE_FAILED"],
        ["ACRW-2026/00502", "STORED"],
      ],
    );
  });

  it("a hónap határai UTC-ben, a rossz alak hiba", () => {
    assert.deepEqual(monthRange("2026-12"), {
      gte: new Date("2026-12-01T00:00:00Z"),
      lt: new Date("2027-01-01T00:00:00Z"),
    });
    assert.throws(() => monthRange("2026-13"), /ÉÉÉÉ-HH/);
  });
});

describe("a parancs", () => {
  function futtat(
    argv: string[],
    over: { documents?: null; valasz?: () => SzamlazzAgentResponse } = {},
  ) {
    let hivas = 0;
    let honap: string | null | undefined;
    let ujra: boolean | undefined;
    let out = "";
    let err = "";
    const t = tar();
    const store: ExternalPdfStore = {
      candidates: async (month, options) => {
        honap = month;
        ujra = options?.retryUnknown;
        return [jelolt(1), jelolt(2)];
      },
      setPdf: t.store.setPdf,
    };
    return main(
      argv,
      { out: (v) => (out += v), err: (v) => (err += v) },
      {
        store,
        documents: () => (over.documents === null ? null : t.documents),
        credential: async () => ({ agentKey: "k", revision: "r1" }),
        client: {
          downloadInvoicePdf: async () => {
            hivas++;
            return (over.valasz ?? (() => valasz()))();
          },
        },
      },
    ).then((code) => ({ code, out, err, hivas, honap, ujra, t }));
  }

  it("száraz futás: kiírja a számlákat, a Számlázz.hu-t nem hívja, és nem ír", async () => {
    const r = await futtat(["--month", "2026-09"]);
    assert.equal(r.code, 1);
    assert.equal(r.hivas, 0);
    assert.equal(r.honap, "2026-09");
    assert.equal(r.t.marks.length, 0);
    assert.match(
      r.out,
      /\(2026-09 kelte\): 2\n {2}2026-09-15 ACRW-2026\/00501\n/,
    );
  });

  it("--apply: letölt; egy meg nem jött PDF a kilépési kódban is látszik", async () => {
    const jo = await futtat(["--apply", "--month", "2026-09"]);
    assert.equal(jo.code, 0);
    assert.equal(jo.hivas, 2);
    const rossz = await futtat(["--apply", "--all-months"], {
      valasz: () => valasz({ successful: false, errorCode: "7" }),
    });
    assert.equal(rossz.code, 3);
    assert.match(
      rossz.out,
      /nem jött meg: 2\n {2}ACRW-2026\/00501 SZAMLAZZ_PDF_REJECTED_7/,
    );
  });

  it("--apply hónap nélkül nem indul, csak kifejezett --all-months-szal (barracuda, #1658)", async () => {
    const r = await futtat(["--apply"]);
    assert.equal(r.code, 2);
    assert.equal(r.hivas, 0);
    assert.match(r.err, /--all-months/);
  });

  it("az ismeretlen számú sor alapból kimarad, a --retry-unknown kéri (barracuda, #1658)", async () => {
    assert.equal((await futtat(["--month", "2026-09"])).ujra, false);
    assert.equal(
      (await futtat(["--month", "2026-09", "--retry-unknown"])).ujra,
      true,
    );
  });

  it("dokumentumtár nélkül, vagy rossz hónappal nem indul", async () => {
    const tarNelkul = await futtat(["--apply", "--all-months"], {
      documents: null,
    });
    assert.equal(tarNelkul.code, 2);
    assert.equal(tarNelkul.hivas, 0);
    const rosszHonap = await futtat(["--month", "2026-9"]);
    assert.equal(rosszHonap.code, 2);
  });
});
