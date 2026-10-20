import { describe, expect, it } from "vitest";

import { GITHUB_ACTIONS_PLACEHOLDER, resolveReefClubApiUrl } from "./api-url";

const none = () => null;

describe("resolveReefClubApiUrl", () => {
  it("takes the setting first, without a trailing slash", () => {
    expect(
      resolveReefClubApiUrl(
        { REEFCLUB_API_URL: " http://reefclub-api:3002/ " },
        none,
      ),
    ).toBe("http://reefclub-api:3002");
  });

  it("reads the root .env when the setting is missing, unquoted", () => {
    expect(
      resolveReefClubApiUrl(
        {},
        () => 'A=1\nREEFCLUB_API_URL="http://localhost:3002/"\n',
      ),
    ).toBe("http://localhost:3002");
  });

  it("uses the loopback placeholder on a GitHub Actions runner only", () => {
    expect(resolveReefClubApiUrl({ GITHUB_ACTIONS: "true" }, none)).toBe(
      GITHUB_ACTIONS_PLACEHOLDER,
    );
    // CI alone is not enough: the Dockerfile sets CI=true in every stage
    expect(() => resolveReefClubApiUrl({ CI: "true" }, none)).toThrow(
      /REEFCLUB_API_URL is required/,
    );
  });

  it("stops the build without any address, and never falls back to the internal API_URL", () => {
    expect(() => resolveReefClubApiUrl({}, none)).toThrow(
      /REEFCLUB_API_URL is required/,
    );
    expect(() =>
      resolveReefClubApiUrl(
        { API_URL: "http://127.0.0.1:3001" },
        () => "API_URL=http://127.0.0.1:3001",
      ),
    ).toThrow(/REEFCLUB_API_URL is required/);
  });

  it("prefers the setting over the root .env and over the placeholder", () => {
    expect(
      resolveReefClubApiUrl(
        { REEFCLUB_API_URL: "http://a:1", GITHUB_ACTIONS: "true" },
        () => "REEFCLUB_API_URL=http://b:2",
      ),
    ).toBe("http://a:1");
  });
});
