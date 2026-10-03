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
