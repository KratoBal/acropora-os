import { describe, expect, it } from "vitest";

import {
  API_URL_ENV_KEY,
  readKeyFromEnvFile,
  resolveApiUrl,
} from "./resolve-api-url";

const noEnvFile = () => undefined;

describe("resolveApiUrl", () => {
  it("takes the environment variable when it is set", () => {
    expect(
      resolveApiUrl({
        env: { [API_URL_ENV_KEY]: "http://127.0.0.1:3001" },
        readRootEnvFile: noEnvFile,
      }),
    ).toBe("http://127.0.0.1:3001");
  });

  it("lets an explicit variable win over the file", () => {
    // Docker and CI pass the value in, and a stale .env on a build machine
    // must never quietly replace it.
    expect(
      resolveApiUrl({
        env: { [API_URL_ENV_KEY]: "http://from-the-environment" },
        readRootEnvFile: () => "API_URL=http://from-the-file",
      }),
    ).toBe("http://from-the-environment");
  });

  it("falls back to the repository root .env, which is the local case", () => {
    expect(
      resolveApiUrl({
        env: {},
        readRootEnvFile: () =>
          "DATABASE_URL=x\nAPI_URL=http://127.0.0.1:3001\n",
      }),
    ).toBe("http://127.0.0.1:3001");
  });

  it("treats an empty variable as absent rather than as a value", () => {
    expect(
      resolveApiUrl({
        env: { [API_URL_ENV_KEY]: "   " },
        readRootEnvFile: () => "API_URL=http://127.0.0.1:3001",
      }),
    ).toBe("http://127.0.0.1:3001");
  });

  it("drops a trailing slash, because the rewrite adds its own", () => {
    expect(
      resolveApiUrl({
        env: { [API_URL_ENV_KEY]: "http://127.0.0.1:3001/" },
        readRootEnvFile: noEnvFile,
      }),
    ).toBe("http://127.0.0.1:3001");
  });

  it("names BOTH ways of supplying it when it has neither", () => {
    // The old message named only the Docker argument, so a developer whose
    // root .env already had the value was sent to the wrong place.
    expect(() =>
      resolveApiUrl({ env: {}, readRootEnvFile: noEnvFile }),
    ).toThrowError(/Docker build argument.*root \.env/s);
  });

  it("does not fail when there is no .env file at all", () => {
    // The normal state in Docker and CI. A missing file must produce the
    // requirement error, not a read error.
    expect(() =>
      resolveApiUrl({ env: {}, readRootEnvFile: noEnvFile }),
    ).toThrowError(/API_URL is required/);
  });
});

describe("readKeyFromEnvFile", () => {
  it("finds the key among others", () => {
    expect(readKeyFromEnvFile("A=1\nAPI_URL=http://x\nB=2", "API_URL")).toBe(
      "http://x",
    );
  });

  it("ignores comments and blank lines", () => {
    expect(
      readKeyFromEnvFile(
        "# API_URL=http://commented\n\nAPI_URL=http://real",
        "API_URL",
      ),
    ).toBe("http://real");
  });

  it("strips matching quotes", () => {
    expect(readKeyFromEnvFile('API_URL="http://x"', "API_URL")).toBe(
      "http://x",
    );
    expect(readKeyFromEnvFile("API_URL='http://x'", "API_URL")).toBe(
      "http://x",
    );
  });

  it("accepts an export prefix", () => {
    expect(readKeyFromEnvFile("export API_URL=http://x", "API_URL")).toBe(
      "http://x",
    );
  });

  it("does not match a key that merely ends with the name", () => {
    // NEXT_PUBLIC_API_URL is a different variable, and returning its value
    // here would be worse than finding nothing: the build would succeed and
    // point somewhere else.
    expect(
      readKeyFromEnvFile("NEXT_PUBLIC_API_URL=http://wrong", "API_URL"),
    ).toBeUndefined();
  });

  it("treats an empty value as absent", () => {
    expect(readKeyFromEnvFile("API_URL=", "API_URL")).toBeUndefined();
    expect(readKeyFromEnvFile('API_URL=""', "API_URL")).toBeUndefined();
  });

  it("returns undefined for an empty file", () => {
    expect(readKeyFromEnvFile("", "API_URL")).toBeUndefined();
  });
});
