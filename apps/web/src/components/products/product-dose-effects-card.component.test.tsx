import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDoseEffectsCard } from "./product-dose-effects-card";

const api = vi.hoisted(() => ({
  forProduct: vi.fn(),
  suggestion: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
  archive: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api/dose-effects", () => ({ doseEffectApi: api }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as string}</a>
  ),
}));

/* The answer arrives a macrotask later, on purpose (see the shipping card's test). */
const kesobb = <T,>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));

const sor = (overrides: Record<string, unknown> = {}) => ({
  id: "sor-1",
  productId: "termek-1",
  productName: "Teszt KH",
  parameterCode: "KH",
  direction: "EMEL",
  effectPer100L: 0.5,
  doseUnit: "ML",
  doseStep: 1,
  maxDailyDosePer100L: 10,
  effectHours: null,
  source: "https://gyarto.example.invalid/kh",
  version: 3,
  recordedBy: { id: "masik", name: "Másik Kolléga" },
  recordedAt: "2026-10-20T10:00:00.000Z",
  verifiedBy: null,
  verifiedAt: null,
  archivedAt: null,
  usable: false,
  refusals: ["NOT_VERIFIED"],
  jevStatus: "VERIFIED",
  ...overrides,
});

const nincsJavaslat = {
  productId: "termek-1",
  jev: { status: "NONE", effects: [], sourceRef: null },
  dosing: null,
  rows: [],
};

function kartya(canManage = true) {
  return render(
    <ProductDoseEffectsCard
      token="token-1"
      productId="termek-1"
      canManage={canManage}
      currentUserId="en"
    />,
  );
}

describe("ProductDoseEffectsCard", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.suggestion.mockReturnValue(kesobb(nincsJavaslat));
  });

  it("a nem használható sor kiírja, MIÉRT nem az; a használható sor jelölést kap", async () => {
    api.forProduct.mockReturnValue(
      kesobb({
        items: [
          sor({ refusals: ["NOT_VERIFIED", "NO_MAX_DAILY"] }),
          sor({
            id: "sor-2",
            parameterCode: "KALCIUM",
            usable: true,
            refusals: [],
            verifiedBy: { id: "harmadik", name: "Harmadik" },
          }),
        ],
      }),
    );
    kartya();
    expect(
      await screen.findByText("második kolléga még nem ellenőrizte"),
    ).toBeTruthy();
    expect(
      screen.getByText("hiányzik a gyártó napi legnagyobb adagja"),
    ).toBeTruthy();
    expect(screen.getByText("Használható")).toBeTruthy();
    expect(screen.getByText("Nem használható")).toBeTruthy();
  });

  it("a saját rögzítésű sort nem kínálja ellenőrzésre; a másikét a látott változattal ellenőrzi", async () => {
    api.forProduct.mockReturnValue(
      kesobb({
        items: [
          sor({ recordedBy: { id: "en", name: "Én" } }),
          sor({ id: "sor-2", parameterCode: "KALCIUM" }),
        ],
      }),
    );
    api.verify.mockReturnValue(kesobb(sor()));
    kartya();
    await screen.findAllByText("Szerkesztés");
    const gombok = screen.getAllByText("Ellenőriztem");
    expect(gombok).toHaveLength(1);
    fireEvent.click(gombok[0]!);
    await waitFor(() =>
      expect(api.verify).toHaveBeenCalledWith("token-1", "sor-2", 3),
    );
  });

  it("a JEV javaslata kitölti a paramétert, az irányt és a forrást, a számokat nem; szám nélkül nem ment", async () => {
    api.forProduct.mockReturnValue(kesobb({ items: [] }));
    api.suggestion.mockReturnValue(
      kesobb({
        productId: "termek-1",
        jev: {
          status: "VERIFIED",
          effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
          sourceRef: "https://gyarto.example.invalid/ca",
        },
        dosing: { status: "VERIFIED", value: "5 ml/100 L/day" },
        rows: [
          {
            parameterCode: "KALCIUM",
            direction: "EMEL",
            source: "https://gyarto.example.invalid/ca",
          },
        ],
      }),
    );
    api.create.mockReturnValue(kesobb(sor()));
    kartya();
    fireEvent.click(await screen.findByText("Felvétel"));
    expect(
      (screen.getByLabelText("Paraméter") as HTMLSelectElement).value,
    ).toBe("KALCIUM");
    expect((screen.getByLabelText("Forrás") as HTMLTextAreaElement).value).toBe(
      "https://gyarto.example.invalid/ca",
    );
    expect(
      (screen.getByLabelText("Hatás 100 literre") as HTMLInputElement).value,
    ).toBe("");

    fireEvent.click(screen.getByText("Mentés"));
    expect(
      await screen.findByText("A hatás és az adaglépés kötelező szám."),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Hatás 100 literre"), {
      target: { value: "2,5" },
    });
    fireEvent.change(screen.getByLabelText("Adaglépés"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("token-1", "termek-1", {
        parameterCode: "KALCIUM",
        direction: "EMEL",
        effectPer100L: 2.5,
        doseUnit: "ML",
        doseStep: 1,
        source: "https://gyarto.example.invalid/ca",
      }),
    );
  });

  it("a szerkesztés a látott változatot küldi, és a kiürített napi maximum null", async () => {
    api.forProduct.mockReturnValue(kesobb({ items: [sor()] }));
    api.update.mockReturnValue(kesobb(sor({ version: 4 })));
    kartya();
    fireEvent.click(await screen.findByText("Szerkesztés"));
    expect(screen.getByText(/A mentés új változatot nyit/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Napi legnagyobb adag"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Mentés"));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "token-1",
        "sor-1",
        expect.objectContaining({
          expectedVersion: 3,
          maxDailyDosePer100L: null,
          effectHours: null,
        }),
      ),
    );
  });

  it("jogosultság nélkül nincs írási gomb", async () => {
    api.forProduct.mockReturnValue(kesobb({ items: [sor()] }));
    kartya(false);
    await screen.findByText("második kolléga még nem ellenőrizte");
    expect(screen.queryByText("Szerkesztés")).toBeNull();
    expect(screen.queryByText("Ellenőriztem")).toBeNull();
    expect(screen.queryByText("Új sor")).toBeNull();
  });
});
