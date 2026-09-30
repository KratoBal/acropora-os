import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOOGLE_PDF_MAX_BYTES,
  GoogleReadonlyClient,
  GoogleReadonlyError,
} from "./google-readonly.client.js";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const SETTINGS = {
  credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
  gmailApiUrl: "https://gmail.test/gmail/v1",
  driveApiUrl: "https://drive.test/drive/v3",
  tokenUrl: "https://oauth.test/token",
};

function client(
  routes: (url: URL) => Response | undefined,
  requested: string[] = [],
) {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.pathname + url.search);
    if (url.href === SETTINGS.tokenUrl)
      return Response.json({ access_token: "access", expires_in: 3600 });
    return routes(url) ?? new Response("{}", { status: 404 });
  };
  return new GoogleReadonlyClient(SETTINGS, fetcher);
}

// Ami pirosít: ha a kliens rögzített fiókot olvasna a paraméter helyett; ha a
// nevében PDF-nek látszó octet-stream melléklet kimaradna; ha egy túl nagy
// melléklet az egész levelet megállítaná; ha a mappa-azonosító szűretlenül a
// Drive-keresésbe kerülne; ha a hiba a válasz szövegét vinné a naplóba.
describe("GoogleReadonlyClient", () => {
  it("reads the mailbox it is given, and takes a PDF by its name too", async () => {
    const requested: string[] = [];
    const google = client((url) => {
      if (url.pathname.endsWith("/messages/m-1"))
        return Response.json({
          id: "m-1",
          internalDate: "1790000000000",
          payload: {
            headers: [
              { name: "From", value: "Szállító Kft. <Szamla@Szallito.HU>" },
              { name: "Subject", value: "Számla" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: base64Url("szia") } },
              {
                mimeType: "application/octet-stream",
                filename: "SZ-1.pdf",
                body: { attachmentId: "att-1", size: 10 },
              },
              {
                mimeType: "image/png",
                filename: "logo.png",
                body: { data: base64Url("png") },
              },
            ],
          },
        });
      if (url.pathname.endsWith("/attachments/att-1"))
        return Response.json({ data: base64Url("%PDF-1.4 szamla") });
    }, requested);
    const message = await google.gmailPdfMessage("balazs@acropora.hu", "m-1");
    assert.deepEqual(
      [
        message.sender,
        message.pdfs.map((pdf) => [pdf.fileName, pdf.buffer.toString()]),
      ],
      ["szamla@szallito.hu", [["SZ-1.pdf", "%PDF-1.4 szamla"]]],
    );
    assert.ok(
      requested.some((path) =>
        path.startsWith("/gmail/v1/users/balazs%40acropora.hu/messages/m-1"),
      ),
    );
  });

  it("skips a too large attachment but keeps the rest of the mail", async () => {
    const google = client((url) => {
      if (url.pathname.endsWith("/messages/m-2"))
        return Response.json({
          id: "m-2",
          payload: {
            parts: [
              {
                filename: "nagy.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "big", size: GOOGLE_PDF_MAX_BYTES + 1 },
              },
              {
                filename: "kicsi.pdf",
                mimeType: "application/pdf",
                body: { data: base64Url("%PDF-1.4") },
              },
            ],
          },
        });
    });
    const message = await google.gmailPdfMessage("info@acropora.hu", "m-2");
    assert.deepEqual(
      [message.pdfs.map((pdf) => pdf.fileName), message.skippedTooLarge],
      [["kicsi.pdf"], 1],
    );
  });

  it("lists a Drive folder's PDFs by a checked folder id, page by page", async () => {
    const requested: string[] = [];
    const google = client((url) => {
      if (url.pathname === "/drive/v3/files")
        return url.searchParams.get("pageToken")
          ? Response.json({ files: [{ id: "f-2", name: "b.pdf" }] })
          : Response.json({
              files: [
                {
                  id: "f-1",
                  name: "a.pdf",
                  modifiedTime: "2026-09-30T10:00:00Z",
                  size: "1234",
                },
              ],
              nextPageToken: "p2",
            });
    }, requested);
    const files = await google.driveFolderPdfs(
      "1YKyszRhtpaGh4302QYFielF5wjQi4oHI",
    );
    assert.deepEqual(
      files.map((file) => [file.id, file.sizeBytes]),
      [
        ["f-1", 1234],
        ["f-2", null],
      ],
    );
    const query = new URL(`https://x${requested[1]}`).searchParams.get("q");
    assert.equal(
      query,
      "'1YKyszRhtpaGh4302QYFielF5wjQi4oHI' in parents and mimeType = 'application/pdf' and trashed = false",
    );
    await assert.rejects(
      google.driveFolderPdfs("x' or name contains 'a"),
      (error: unknown) =>
        error instanceof GoogleReadonlyError &&
        error.code === "GOOGLE_DRIVE_FOLDER_ID_INVALID",
    );
  });

  it("fails with a code, never with the response text", async () => {
    const google = client(
      () =>
        new Response('{"error":"secret detail refresh_token=abc"}', {
          status: 403,
        }),
    );
    await assert.rejects(
      google.gmailMessageIds("info@acropora.hu", "has:attachment"),
      (error: unknown) =>
        error instanceof GoogleReadonlyError &&
        error.message === "GOOGLE_AUTH_FAILED",
    );
  });
});
