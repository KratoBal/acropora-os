import { describe, expect, it } from "vitest";

import { advanceTrail, previousPage } from "./return-trail";

describe("return trail", () => {
  it("remembers where the reader came from", () => {
    const trail = advanceTrail(advanceTrail([], "/partnerek"), "/partnerek/1");

    expect(trail).toEqual(["/partnerek", "/partnerek/1"]);
    expect(previousPage(trail)).toBe("/partnerek");
  });

  /**
   * The first page of a session has nowhere to go back to: a direct link, a
   * bookmark or a reload. This is the case the browser's own history gets
   * wrong - `back()` there leaves the application entirely.
   */
  it("has no previous page on the first screen", () => {
    expect(previousPage(advanceTrail([], "/partnerek/1"))).toBeNull();
  });

  /**
   * Filtering, paging and re-rendering all land on the same path. Recording
   * them would make "back" mean "the same screen I am on".
   */
  it("does not record the same page twice in a row", () => {
    const trail = ["/partnerek", "/partnerek/1"];

    expect(advanceTrail(trail, "/partnerek/1")).toEqual(trail);
  });

  /**
   * Going back has to SHORTEN the trail. If it appended instead, the button
   * would bounce the reader between the two pages: back to the list, then
   * "back" to the record they just left.
   */
  it("shortens the trail when the reader goes back, instead of bouncing", () => {
    const trail = ["/partnerek", "/partnerek/1"];
    const back = advanceTrail(trail, "/partnerek");

    expect(back).toEqual(["/partnerek"]);
    expect(previousPage(back)).toBeNull();
  });

  it("follows a longer path and unwinds it one step at a time", () => {
    let trail: string[] = [];
    for (const page of [
      "/szerviz/munkalapok",
      "/szerviz/munkalapok/42",
      "/partnerek/7",
    ])
      trail = advanceTrail(trail, page);

    expect(previousPage(trail)).toBe("/szerviz/munkalapok/42");

    trail = advanceTrail(trail, "/szerviz/munkalapok/42");
    expect(previousPage(trail)).toBe("/szerviz/munkalapok");
  });
});
