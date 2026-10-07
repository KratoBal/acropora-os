import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JevCopyPanel } from "./jev-knowledge-panel";

/** `PilotButton` comes through the app's pilot module, whose font loader is build-time only. */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/** Invented values only. */
const conflicts = [
  {
    field: "dosing" as const,
    values: ["1 drop/100 L/day", "1 drop/100 L, 1-2/week"],
  },
];

function panel(body: string) {
  return render(
    <JevCopyPanel
      copy={[
        {
          block: "body",
          body,
          status: "APPROVED",
          stale: false,
          usedFields: [],
          editedAt: "2026-10-03T19:00:00.000Z",
          approvedAt: "2026-10-03T19:01:00.000Z",
        },
      ]}
      conflicts={conflicts}
      canApprove
      busy={false}
      onSave={vi.fn()}
      onApprove={vi.fn()}
    />,
  );
}

describe("a vevői szöveg ütköző értékre figyelmeztet", () => {
  it("a jóváhagyott leírás ütköző értéke figyelmeztetést ad, és a mentés nem tiltott", () => {
    panel("Naponta 1 drop/100 L/day.");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Adagolási rend: 1 drop/100 L/day");

    fireEvent.change(screen.getByLabelText("Leírás"), {
      target: { value: "Naponta 1 drop/100 L/day, javítva." },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Leírás mentése",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("érték nélküli szövegnél csak a mezőt nevezi meg, riasztás nélkül", () => {
    panel("A gyártó forrásai nem egyeznek, most nincs ajánlott adag.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText(/Ütköző mező: Adagolási rend/).length).toBe(2);
  });

  it("a SEO blokkok nem kapják a figyelmeztetést", () => {
    panel("x");
    const seo = document.querySelector('[data-copy-block="seoTitle"]')!;
    expect(seo.textContent).not.toContain("Ütköző mező");
  });
});

/**
 * MIRE EPUL A BLOKK (SEO P0 PR 1b). MI PIROSIT: ha a jeloles nem a mentett
 * listat mutatja; ha egy regi (ures listas) blokknal nem minden teny van
 * bejelolve (a szigoru irany); ha a mentes nem a bejelolt tenyeket kuldi; ha a
 * nem ellenorzott teny nem mondja meg magarol.
 */
describe("a vevői szöveg tényei", () => {
  const fact = (
    field: "dosing" | "application" | "productFamily",
    status: string,
  ) =>
    ({
      field,
      value: "x",
      unit: null,
      status,
      revision: 1,
      acceptedAt: "2026-10-07T09:00:00.000Z",
      acceptedBy: { id: "u", displayName: "Kitalált Elfogadó" },
      fieldResultId: `fr-${field}`,
      source: { sourceType: null, sourceRef: null, retrievedAt: null },
    }) as never;
  const facts = [
    fact("application", "VERIFIED"),
    fact("dosing", "CONFLICTING_SOURCES"),
    fact("productFamily", "VERIFIED"),
  ];
  const lead = (usedFields: string[]) => ({
    block: "lead" as const,
    body: "Korallokhoz.",
    status: "DRAFT" as const,
    stale: false,
    usedFields,
    editedAt: "2026-10-07T09:00:00.000Z",
    approvedAt: null,
  });
  const pipalt = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-used-fields="lead"] input[type="checkbox"]',
      ),
    )
      .filter((box) => box.checked)
      .map((box) => box.id.replace("hasznalt-lead-", ""));

  it("a mentett lista látszik; a régi blokknál minden tény be van jelölve", () => {
    const { unmount } = render(
      <JevCopyPanel
        copy={[lead(["application"])]}
        facts={facts}
        canApprove
        busy={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    expect(pipalt()).toEqual(["application"]);
    unmount();
    render(
      <JevCopyPanel
        copy={[lead([])]}
        facts={facts}
        canApprove
        busy={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    expect(pipalt()).toEqual(["application", "dosing", "productFamily"]);
    expect(screen.getAllByText("(ütköző)").length).toBeGreaterThan(0);
  });

  it("a jelölés változása menthető, és a mentés a bejelölt tényeket küldi", () => {
    const onSave = vi.fn();
    render(
      <JevCopyPanel
        copy={[lead([])]}
        facts={facts}
        canApprove
        busy={false}
        onSave={onSave}
        onApprove={vi.fn()}
      />,
    );
    const mentes = screen.getByRole("button", {
      name: "Bevezető mentése",
    }) as HTMLButtonElement;
    expect(mentes.disabled).toBe(true);
    fireEvent.click(document.getElementById("hasznalt-lead-dosing")!);
    expect(mentes.disabled).toBe(false);
    fireEvent.click(mentes);
    expect(onSave).toHaveBeenCalledWith("lead", "Korallokhoz.", [
      "application",
      "productFamily",
    ]);
  });
});

/*
 * A VALTOZAT TENYE KULON JELOLO (SEO P0 PR 3). MI PIROSIT: a termek es egy
 * valtozata ugyanazzal a mezovel egy `id`-t kap (a jeloles a rossz tenyre
 * megy), vagy a mentes a valtozat tenyet a sima mezonevvel kuldi.
 */
describe("a változat tényére nincs jelölő", () => {
  /*
   * SEO P0 PR 3 (barracuda 27668): a valtozat tenye a P0-ban nem jut a
   * vevohoz, az API elutasitja a ra epulo blokkot. MI PIROSIT: a valtozat
   * tenyere jelolo all (egy soha ki nem adhato blokk menteset kinalja), vagy a
   * termek sajat tenye eltunik a listarol.
   */
  const fact = (variantId: string | null) =>
    ({
      field: "application",
      variantId,
      value: "x",
      unit: null,
      status: "VERIFIED",
      revision: 1,
      public: true,
      acceptedAt: "2026-10-07T09:00:00.000Z",
      acceptedBy: { id: "u", displayName: "Kitalált Elfogadó" },
      fieldResultId: "fr-application",
      source: { sourceType: null, sourceRef: null, retrievedAt: null },
    }) as never;

  it("csak a termék saját ténye kap jelölőt", () => {
    render(
      <JevCopyPanel
        copy={[
          {
            block: "lead",
            body: "Korallokhoz.",
            status: "DRAFT",
            stale: false,
            usedFields: [],
            editedAt: "2026-10-07T09:00:00.000Z",
            approvedAt: null,
          },
        ]}
        facts={[fact(null), fact("v-abcdef123456")]}
        canApprove
        busy={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    const dobozok = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-used-fields="lead"] input[type="checkbox"]',
      ),
    );
    expect(dobozok.map((d) => [d.id, d.checked])).toEqual([
      ["hasznalt-lead-application", true],
    ]);
  });
});
