import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { HttpClaimExtractor, unavailableReason } from "./claim-extractor.js";

/**
 * WHY AN AI CALL WAS UNAVAILABLE, IN THE RUN'S OWN REPORT (research-kepes-ut).
 * On stage (2026-10-31) every claim call answered 502 and the report said only
 * "HTTP 502"; why stood in a log the fleet cannot read. WHAT TURNS IT RED: the
 * provider's codes the AI service passes on not reaching the reason; a code
 * that is not an identifier (text, a key) reaching it.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("the reason of an unavailable AI call", () => {
  it("names the provider's codes after the HTTP status", async () => {
    assert.equal(
      await unavailableReason(
        json(502, {
          error: "ai_provider_error",
          waitedMs: 7,
          provider: {
            status: 400,
            type: "invalid_request_error",
            code: "invalid_value",
            param: "input",
          },
        }),
      ),
      "HTTP 502 provider 400 invalid_request_error invalid_value input",
    );
  });

  it("only identifiers: a message-like code is dropped, and no codes leave the status alone", async () => {
    assert.equal(
      await unavailableReason(
        json(502, {
          provider: {
            code: "bad key sk-live-secret",
            param: "input[0].content",
          },
        }),
      ),
      "HTTP 502 provider input[0].content",
    );
    assert.equal(
      await unavailableReason(json(502, { error: "ai_provider_error" })),
      "HTTP 502",
    );
    assert.equal(
      await unavailableReason(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ),
      "HTTP 502",
    );
    assert.equal(
      await unavailableReason(new Response(null, { status: 404 })),
      "HTTP 404",
    );
  });

  it("the HTTP extractor reports it as the call's reason", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "ai_provider_error",
          waitedMs: 3,
          provider: { status: 400, code: "invalid_value" },
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const answer = await new HttpClaimExtractor(
        `http://127.0.0.1:${port}`,
        "t",
        "/v1/claim-extractions",
      ).extract({
        sourceText: "x",
        subject: "PHOSPHATE",
        vocabulary: {
          taxa: ["ACROPORA"],
          environments: ["LAB"],
          effects: ["CALCIFICATION"],
        },
      });
      assert.deepEqual(answer, {
        kind: "UNAVAILABLE",
        reason: "HTTP 502 provider 400 invalid_value",
      });
    } finally {
      server.close();
    }
  });
});
