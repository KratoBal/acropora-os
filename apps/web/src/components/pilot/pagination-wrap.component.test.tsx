import { Pagination } from "@acropora/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

/*
  A SZÁMOZOTT LAPOZÓ KESKENY KÉPERNYŐN (stage-fotó 2026-11-03: az Eszközök lap 613 px széles volt
  a 390 px helyett). MI PIROSÍT: ha a számozott változatok (szürke, teal) nem törhetnek sorba:
  16 oldal = 16 gomb egy sorban, ami a lapot a telefonnál szélesebbre nyújtja. Az előző/következő
  változat egy-két gombja nem érintett, annak nincs szüksége sortörésre.
*/
describe("a számozott lapozó sortörése", () => {
  const rajzol = (variant: "numberedGrey" | "numberedTeal" | "prevNext") =>
    render(
      <Pagination
        position="bottom"
        variant={variant}
        page={3}
        totalPages={16}
        onPageChange={() => undefined}
      />,
    );

  it("a szürke számozott lapozó sorba törhet, és mind a 16 gombot kiírja", () => {
    rajzol("numberedGrey");
    const nav = screen.getByRole("navigation", { name: "Lapozás, alul" });
    expect(nav.className).toContain("flex-wrap");
    expect(screen.getAllByRole("button", { name: /^\d+$/ }).length).toBe(16);
  });

  it("a teal számozott lapozó is sorba törhet", () => {
    rajzol("numberedTeal");
    expect(
      screen.getByRole("navigation", { name: "Lapozás, alul" }).className,
    ).toContain("flex-wrap");
  });

  it("az előző/következő lapozón nincs sortörés (két gomb, nem kell)", () => {
    rajzol("prevNext");
    expect(
      screen.getByRole("navigation", { name: "Lapozás, alul" }).className,
    ).not.toContain("flex-wrap");
  });
});
