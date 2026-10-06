import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachmentFileName,
  openAttachment,
  type OpenAttachmentDeps,
} from "./open-attachment";

/*
  A CSATOLMÁNY MEGNYITÁSA (Üzenetek 2d, kártya 34753075). MI PIROSÍT: ha a
  letöltés nem a csatolmány saját címére vagy token nélkül megy; ha a helyi
  fájl nem a valódi kiterjesztést kapja (a néző abból dönt), vagy az
  azonosítóból kilép a gyorsítótárból; ha egy hiba csendben elnyelődik.
*/
const PDF = {
  id: "att-1",
  fileName: "árajánlat.pdf",
  contentType: "application/pdf",
};

function deps(over: Partial<OpenAttachmentDeps> = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      token: async () => "tok",
      download: async (input: {
        uri: string;
        headers: Record<string, string>;
        fileName: string;
      }) => {
        calls.push(["download", input]);
        return `file:///cache/${input.fileName}`;
      },
      open: async (uri: string, mimeType: string) => {
        calls.push(["open", uri, mimeType]);
      },
      ...over,
    } satisfies OpenAttachmentDeps,
  };
}

describe("opening a message attachment", () => {
  it("downloads the original with the token and hands the .pdf file to the system", async () => {
    const { deps: d, calls } = deps();
    const result = await openAttachment(
      { apiUrl: "https://os.example/api/", attachment: PDF },
      d,
    );
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      [
        "download",
        {
          uri: "https://os.example/api/messages/attachments/att-1",
          headers: { Authorization: "Bearer tok" },
          fileName: "uzenet-csatolmany-att-1.pdf",
        },
      ],
      ["open", "file:///cache/uzenet-csatolmany-att-1.pdf", "application/pdf"],
    ]);
  });

  it("the local name keeps only safe characters and the real extension", () => {
    assert.equal(
      attachmentFileName({
        id: "../../x",
        fileName: "a",
        contentType: "image/png",
      }),
      "uzenet-csatolmany-x.png",
    );
    assert.equal(
      attachmentFileName({
        id: "a1",
        fileName: "jegyzet.TXT",
        contentType: "text/plain",
      }),
      "uzenet-csatolmany-a1.txt",
    );
  });

  it("each failure says so, in its own words", async () => {
    assert.equal(
      (await openAttachment({ apiUrl: null, attachment: PDF }, deps().deps)).ok,
      false,
    );
    const noToken = await openAttachment(
      { apiUrl: "https://os.example", attachment: PDF },
      deps({ token: async () => null }).deps,
    );
    assert.deepEqual(noToken, {
      ok: false,
      message: "A csatolmány nem nyitható meg: lépj be újra.",
    });
    const offline = await openAttachment(
      { apiUrl: "https://os.example", attachment: PDF },
      deps({
        download: async () => {
          throw new Error("Network request failed");
        },
      }).deps,
    );
    assert.match((offline as { message: string }).message, /nem töltődött le/);
    const noViewer = await openAttachment(
      { apiUrl: "https://os.example", attachment: PDF },
      deps({
        open: async () => {
          throw new Error("no");
        },
      }).deps,
    );
    assert.match(
      (noViewer as { message: string }).message,
      /nem tudta megnyitni/,
    );
  });
});
