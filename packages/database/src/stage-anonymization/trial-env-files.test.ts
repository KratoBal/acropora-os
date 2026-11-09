import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  measureGeneratedClientEnvFiles,
  prismaLoadedEnvFiles,
} from "./trial-env-files.js";

/*
  THE .env FILES THE PRISMA CLIENT WOULD LOAD (S-trial, barracuda #2331). WHAT TURNS THIS RED: a baked path that exists and is not
  reported (a live key would reach the instance); a path that does not exist reported (a false alarm that blocks every run); a
  generated client with no readable block taken for "nothing loaded"; the paths resolved from the wrong base.
*/
const block = (root: string, schema: string): string =>
  `const config = {\n  "relativeEnvPaths": {\n    ${root}${schema === "" ? "" : ",\n    " + schema}\n  },\n  "other": {}\n}`;
/** A stand-in for path.resolve that keeps the base visible in the result. */
const join = (base: string, relative: string): string => `${base}|${relative}`;

describe("prismaLoadedEnvFiles", () => {
  it("reports no file when both baked paths are null (the client was generated without a .env)", () => {
    assert.deepEqual(
      prismaLoadedEnvFiles(
        block('"rootEnvPath": null', '"schemaEnvPath": null'),
        "/g",
        () => true,
        join,
      ),
      [],
    );
    assert.deepEqual(
      prismaLoadedEnvFiles(
        block('"rootEnvPath": null', ""),
        "/g",
        () => true,
        join,
      ),
      [],
    );
  });

  it("reports the baked paths that EXIST, resolved from the generated directory, and only those", () => {
    const source = block(
      '"rootEnvPath": "../../../../.env"',
      '"schemaEnvPath": "../../../prisma/.env"',
    );
    assert.deepEqual(
      prismaLoadedEnvFiles(source, "/g", () => true, join),
      ["/g|../../../../.env", "/g|../../../prisma/.env"],
    );
    assert.deepEqual(
      prismaLoadedEnvFiles(source, "/g", () => false, join),
      [],
    );
    assert.deepEqual(
      prismaLoadedEnvFiles(
        source,
        "/g",
        (path) => path.endsWith("prisma/.env"),
        join,
      ),
      ["/g|../../../prisma/.env"],
    );
  });

  it("returns null, not an empty list, for a client it cannot read (no block, an empty block): that is 'not measured'", () => {
    assert.equal(
      prismaLoadedEnvFiles("module.exports = {}", "/g", () => true, join),
      null,
    );
    assert.equal(
      prismaLoadedEnvFiles('"relativeEnvPaths": {}', "/g", () => true, join),
      null,
    );
    assert.equal(
      prismaLoadedEnvFiles('"relativeEnvPaths": {', "/g", () => true, join),
      null,
    );
  });
});

describe("measureGeneratedClientEnvFiles", () => {
  it("reads the real generated client of this repository: a list, or null when it cannot be read", () => {
    const measured = measureGeneratedClientEnvFiles(import.meta.url);
    assert.ok(measured === null || Array.isArray(measured));
  });
});
