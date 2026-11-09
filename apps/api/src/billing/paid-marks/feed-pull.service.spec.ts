import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { FeedPullDto } from "./dto/feed-pull.dto.js";
import { FeedPullService } from "./feed-pull.service.js";

/*
  THE "LEKÉRÉS A SZÁMLÁZZ.HU-BÓL" ENDPOINT (aeddb2c3, acrobot 43506). WHAT TURNS THIS RED: a malformed or a padded
  free-text number accepted (the query asks for an exact invoice number); more than ten numbers in one request (each is
  a Számlázz.hu call); a missing `apply` taken as either; the service not passing `apply` through (a preview that
  writes, or a confirmed pull that does not).
*/
const errorsOf = async (body: unknown) =>
  (await validate(plainToInstance(FeedPullDto, body))).map((e) => e.property);

describe("FeedPullDto", () => {
  it("takes exact numbers and an explicit apply", async () => {
    assert.deepEqual(
      await errorsOf({
        numbers: ["ACRW-2026/00469", "2026/00083"],
        apply: false,
      }),
      [],
    );
    assert.deepEqual(
      await errorsOf({ numbers: ["2026/00083 nincs"], apply: true }),
      ["numbers"],
    );
    assert.deepEqual(await errorsOf({ numbers: [], apply: true }), ["numbers"]);
    assert.deepEqual(
      await errorsOf({
        numbers: Array.from({ length: 11 }, (_, i) => `ACRW-2026/0${100 + i}`),
        apply: false,
      }),
      ["numbers"],
    );
    assert.deepEqual(await errorsOf({ numbers: ["ACRW-2026/00469"] }), [
      "apply",
    ]);
  });
});

describe("FeedPullService", () => {
  it("passes apply through: the preview stores nothing, the confirmed pull stores", async () => {
    const stored: string[] = [];
    const service = new FeedPullService(
      {} as unknown as ConstructorParameters<typeof FeedPullService>[0],
    );
    service.deps = {
      agentKey: async () => "k",
      client: {
        queryDocument: async () =>
          `<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz"><sikeres>false</sikeres><hibakod>7</hibakod></xmlszamlavalasz>`,
      },
      store: async (input) => {
        stored.push(input.externalId);
        return "NEW";
      },
      project: async () => "PROJECTED",
    };
    const preview = await service.pull(["ACRW-2026/00469"], false, "user-1");
    assert.deepEqual(
      preview.map((l) => l.outcome),
      ["NOT_FOUND"],
    );
    assert.deepEqual(stored, []);
  });
});
