import { describe, expect, it } from "vitest";

import { loginPathFor, safeReturnPath } from "./return-path";

/*
  WHAT TURNS THIS RED. The login sending anyone off our site (an absolute or protocol-relative address, a backslash
  trick, a scheme, a control character) or back to the login itself; an internal page with its query lost on the way
  back (the live draw needs ?kind=...&kerdes=...).
*/
describe("the return path after signing in", () => {
  it("keeps an internal page with its query", () => {
    expect(safeReturnPath("/sorsolas?kind=WEEKLY&kerdes=q-1")).toBe(
      "/sorsolas?kind=WEEKLY&kerdes=q-1",
    );
    expect(safeReturnPath("/admin/jelenleti-iv")).toBe("/admin/jelenleti-iv");
  });

  it("refuses anything that could leave the site, and the login itself", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "sorsolas",
      "/x\u0000y",
      "/login",
      "/login?next=/x",
      `/${"a".repeat(600)}`,
    ])
      expect(safeReturnPath(bad), String(bad)).toBe("/");
  });

  it("builds the login address that comes back", () => {
    expect(loginPathFor("/sorsolas?kind=CHRISTMAS")).toBe(
      "/login?next=%2Fsorsolas%3Fkind%3DCHRISTMAS",
    );
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("//evil.example")).toBe("/login");
  });
});
