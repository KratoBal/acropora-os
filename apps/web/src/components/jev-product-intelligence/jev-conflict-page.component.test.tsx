import { render, screen, within } from "@testing-library/react";
import type { ProductFieldReview, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { JevConflictPage } from "./jev-conflict-page";

const api = vi.hoisted(() => ({ enrichment: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));

function session(role: Session["user"]["role"]): Session {
  return {
    id: "s",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "teszt@example.invalid",
      displayName: "Teszt Kolléga",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

/** Invented readings only. */
const conflict: ProductFieldReview = {
  field: "flowRate",
  tier: "C",
  status: "CONFLICTING_SOURCES",
  currentValue: { kind: "quantity", amount: "2500", unit: "l/h" },
  value: null,
  sourceType: null,
  sourceRef: null,
  retrievedAt: null,
  confidence: null,
  evidence: [
    {
      sourceType: "MANUFACTURER_DOCUMENT",
      value: { kind: "quantity", amount: "3000", unit: "l/h" },
      sourceRef: "https://example.invalid/adatlap.pdf",
      retrievedAt: "2026-10-01T20:38:00.000Z",
    },
    {
      sourceType: "SUPPLIER_PAGE",
      value: { kind: "quantity", amount: "2800", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
    {
      sourceType: "OS_PRODUCT_MASTER",
      value: { kind: "quantity", amount: "2500", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
  ],
};
const run = { at: "2026-10-01T20:41:00.000Z", sourceCount: 3, fieldCount: 12 };

beforeEach(() => {
  auth.session = session("OWNER");
  api.enrichment
    .mockReset()
    .mockResolvedValue({ availability: "off", lastRun: null, fields: [] });
});

describe("Forrásütközés feloldása", () => {
  it("kikapcsolva: nem elérhető, és a döntések mégis látszanak, tiltva", async () => {
    render(<JevConflictPage productId="p-1" field="flowRate" />);
    expect(
      screen.getByText("A Jev nem választ automatikusan a források között."),
    ).toBeTruthy();
    expect(screen.getByText("Teljesítmény · forrásütközés")).toBeTruthy();
    expect(
      await screen.findByText("A termékadat-ellenőrzés jelenleg nem elérhető."),
    ).toBeTruthy();
    const decide = screen
      .getByRole("heading", { name: "Emberi döntés" })
      .closest("section") as HTMLElement;
    const buttons = within(decide).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Jelenlegi érték megtartása",
      "Nem eldönthető",
    ]);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(
      within(decide).getByText("A döntések rögzítése még nincs engedélyezve."),
    ).toBeTruthy();
    expect(api.enrichment).toHaveBeenCalledWith("token-1", "p-1");
  });

  it("bekapcsolva, futás nélkül: még nem készült ellenőrzés", async () => {
    api.enrichment.mockResolvedValue({
      availability: "review",
      lastRun: null,
      fields: [],
    });
    render(<JevConflictPage productId="p-1" field="flowRate" />);
    expect(
      await screen.findByText(
        "Ehhez a termékhez még nem készült JEV adatellenőrzés.",
      ),
    ).toBeTruthy();
  });

  it("valódi ütközésnél a források egymás mellett, győztes nélkül, minden döntés tiltva", async () => {
    api.enrichment.mockResolvedValue({
      availability: "review",
      lastRun: run,
      fields: [conflict],
    });
    render(<JevConflictPage productId="p-1" field="flowRate" />);
    const manufacturer = await screen.findByRole("article", {
      name: "Gyártói adatlap",
    });
    expect(within(manufacturer).getByText("3000 l/h")).toBeTruthy();
    expect(
      within(screen.getByRole("article", { name: "Acropora OS" })).getByText(
        "BELSŐ ADAT",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Acropora OS: 2500 l/h (belső adat, önmagát nem igazolhatja).",
      ),
    ).toBeTruthy();
    const decide = screen
      .getByRole("heading", { name: "Emberi döntés" })
      .closest("section") as HTMLElement;
    const buttons = within(decide).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "3000 l/h elfogadása",
      "2800 l/h elfogadása",
      "Jelenlegi érték megtartása",
      "Nem eldönthető",
    ]);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("nem ütköző mezőnél kimondja, hogy nincs ütközés", async () => {
    api.enrichment.mockResolvedValue({
      availability: "review",
      lastRun: run,
      fields: [{ ...conflict, status: "VERIFIED" }],
    });
    render(<JevConflictPage productId="p-1" field="flowRate" />);
    expect(
      await screen.findByText("Ennél a mezőnél nincs forrásütközés."),
    ).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("a hiba hiba; ismeretlen termékre külön mondat", async () => {
    api.enrichment.mockRejectedValue(new ApiError("boom", 500));
    const { unmount } = render(
      <JevConflictPage productId="p-1" field="flowRate" />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Az ellenőrzés nem tölthető be. A meglévő termékadatok nem változtak.",
    );
    unmount();
    api.enrichment.mockRejectedValue(new ApiError("nincs", 404));
    render(<JevConflictPage productId="nincs" field="flowRate" />);
    expect(await screen.findByText("A termék nem található")).toBeTruthy();
  });

  it("ismeretlen mezőkulcsra nem kér le semmit", () => {
    render(<JevConflictPage productId="p-1" field="nincsilyen" />);
    expect(screen.getByText("Ismeretlen mező")).toBeTruthy();
    expect(api.enrichment).not.toHaveBeenCalled();
  });

  it("csak nézési joggal a döntés oka a hiányzó jog; products.view nélkül semmi", () => {
    auth.session = session("VIEWER");
    const { unmount } = render(
      <JevConflictPage productId="p-1" field="flowRate" />,
    );
    expect(
      screen.getByText("A döntéshez termékkezelési jog kell."),
    ).toBeTruthy();
    unmount();
    api.enrichment.mockClear();
    auth.session = session("SERVICE");
    render(<JevConflictPage productId="p-1" field="flowRate" />);
    expect(screen.getByText("Nincs hozzáférésed a termékhez")).toBeTruthy();
    expect(api.enrichment).not.toHaveBeenCalled();
  });
});
