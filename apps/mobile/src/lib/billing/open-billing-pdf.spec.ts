import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OpenAttachmentDeps } from "../messages/open-attachment";
import { billingPdfFileName, openBillingPdf } from "./open-billing-pdf";

/*
  A SZÁMLA PDF-JE (kártya 050e138b). MI PIROSÍT: ha a letöltés nem a fajtához tartozó végpontra megy (a bejövő a kimenő
  útján), ha a token nem kerül a fejlécbe (a végpont billing.view jogot kér, token nélkül 401), ha egy hiba csendben
  sikerként jönne vissza, vagy ha egy furcsa azonosító a helyi fájlnévbe szivárogna.
*/
function deps(over: Partial<OpenAttachmentDeps> = {}) {
  const calls: {
    uri: string;
    headers: Record<string, string>;
    fileName: string;
  }[] = [];
  const opened: [string, string][] = [];
  const value: OpenAttachmentDeps = {
    token: async () => "tok-1",
    download: async (input) => {
      calls.push(input);
      return `file:///cache/${input.fileName}`;
    },
    open: async (uri, mime) => {
      opened.push([uri, mime]);
    },
    ...over,
  };
  return { value, calls, opened };
}

describe("a számla PDF-jének megnyitása", () => {
  it("a három fajta a saját végpontjáról tölt, a tokennel, és PDF-ként nyit", async () => {
    for (const [kind, segment] of [
      ["own", "documents"],
      ["external", "external-documents"],
      ["incoming", "incoming-documents"],
    ] as const) {
      const d = deps();
      const result = await openBillingPdf(
        { apiUrl: "https://api.example/api/", kind, id: "doc 1" },
        d.value,
      );
      assert.deepEqual(result, { ok: true });
      assert.equal(
        d.calls[0]?.uri,
        `https://api.example/api/billing/${segment}/doc%201/pdf`,
      );
      assert.deepEqual(d.calls[0]?.headers, { Authorization: "Bearer tok-1" });
      assert.equal(d.opened[0]?.[1], "application/pdf");
    }
  });

  it("token nélkül nem tölt, és belépést kér", async () => {
    const d = deps({ token: async () => null });
    const result = await openBillingPdf(
      { apiUrl: "https://api.example", kind: "own", id: "x" },
      d.value,
    );
    assert.equal(result.ok, false);
    assert.equal(d.calls.length, 0);
  });

  it("a letöltés és a megnyitás hibája kimondott hiba, nem siker", async () => {
    const letoltes = await openBillingPdf(
      { apiUrl: "https://api.example", kind: "own", id: "x" },
      deps({ download: async () => Promise.reject(new Error("offline")) })
        .value,
    );
    assert.equal(letoltes.ok, false);
    const nyitas = await openBillingPdf(
      { apiUrl: "https://api.example", kind: "incoming", id: "x" },
      deps({ open: async () => Promise.reject(new Error("no viewer")) }).value,
    );
    assert.equal(nyitas.ok, false);
  });

  it("a helyi fájlnévbe csak biztonságos jel kerül", () => {
    assert.equal(
      billingPdfFileName("incoming", "purchase:../../x"),
      "szamla-incoming-purchasex.pdf",
    );
  });
});
