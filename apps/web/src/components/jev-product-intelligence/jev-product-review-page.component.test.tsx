import { render, screen, within } from "@testing-library/react";
import type { ProductDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { JevProductReviewPage } from "./jev-product-review-page";

const api = vi.hoisted(() => ({ detail: vi.fn(), enrichment: vi.fn() }));
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

/** Invented values only. */
const product = {
  id: "p-1",
  name: "Példa termék · DC keringető szivattyú",
  origin: "UNAS",
  primarySku: "DEMO-001",
  brand: { id: "b", name: "Aqua Example" },
  primaryCategory: { id: "c", name: "Szivattyúk" },
  categories: [],
  stockOnHand: "4",
  unasMirror: null,
  description: "<p>Kitalált leírás.</p><script>alert(1)</script>",
  variants: [
    {
      id: "v-1",
      isActive: true,
      manufacturerPartNumber: "DR-3300",
      barcodes: [],
    },
  ],
} as unknown as ProductDetail;

beforeEach(() => {
  auth.session = session("OWNER");
  api.detail.mockReset().mockResolvedValue(product);
  api.enrichment
    .mockReset()
    .mockResolvedValue({ availability: "off", lastRun: null, fields: [] });
});

describe("Termékadat-ellenőrzés aloldal", () => {
  it("a jelenlegi adatok valódiak, a JEV panel kikapcsolva nem elérhető", async () => {
    render(<JevProductReviewPage productId="p-1" />);
    const current = (
      await screen.findByRole("heading", { name: "Jelenlegi termékadatok" })
    ).closest("section") as HTMLElement;
    expect(await within(current).findByText("DR-3300")).toBeTruthy();
    expect(within(current).getByText("Aqua Example")).toBeTruthy();
    expect(
      screen.getByText("SKU: DEMO-001 · UNAS-termék · 1 változat"),
    ).toBeTruthy();
    expect(
      await screen.findByText("A termékadat-ellenőrzés jelenleg nem elérhető."),
    ).toBeTruthy();
    // the description is sanitized, as on the product page
    expect(screen.getByText("Kitalált leírás.")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    // no quality percentage anywhere
    expect(screen.queryByText(/ADATMINŐSÉG|%/)).toBeNull();
  });

  it("bekapcsolva, futás nélkül: még nem készült ellenőrzés", async () => {
    api.enrichment.mockResolvedValue({
      availability: "review",
      lastRun: null,
      fields: [],
    });
    render(<JevProductReviewPage productId="p-1" />);
    expect(
      await screen.findByText(
        "Ehhez a termékhez még nem készült JEV adatellenőrzés.",
      ),
    ).toBeTruthy();
  });

  it("a JEV hiba hiba, és a termék adatai attól még látszanak", async () => {
    api.enrichment.mockRejectedValue(new ApiError("boom", 500));
    render(<JevProductReviewPage productId="p-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Az ellenőrzés nem fejeződött be. A meglévő termékadatok nem változtak.",
    );
    expect(await screen.findByText("DR-3300")).toBeTruthy();
  });

  it("ismeretlen termék: kimondja, nem üres oldal", async () => {
    api.detail.mockRejectedValue(new ApiError("nincs", 404));
    render(<JevProductReviewPage productId="nincs" />);
    expect(await screen.findByText("A termék nem található")).toBeTruthy();
  });

  it("minden döntés és futtatás tiltva, látható okkal; jog nélkül más okkal", async () => {
    render(<JevProductReviewPage productId="p-1" />);
    const rerun = screen.getByRole("button", { name: "Újraellenőrzés" });
    const apply = screen.getByRole("button", {
      name: "Kijelölt módosítások alkalmazása",
    });
    expect((rerun as HTMLButtonElement).disabled).toBe(true);
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Ellenőrzés indítása még nincs engedélyezve."),
    ).toBeTruthy();
    expect(
      screen.getByText("A döntések rögzítése még nincs engedélyezve."),
    ).toBeTruthy();
  });

  it("csak nézési joggal a döntés oka a hiányzó jog", async () => {
    auth.session = session("VIEWER");
    render(<JevProductReviewPage productId="p-1" />);
    expect(
      screen.getByText("A döntéshez termékkezelési jog kell."),
    ).toBeTruthy();
    expect(await screen.findByText("DR-3300")).toBeTruthy();
  });

  it("ütköző mezőnél a sor a mező ütközés-nézetére visz", async () => {
    api.enrichment.mockResolvedValue({
      availability: "review",
      lastRun: {
        at: "2026-10-01T20:41:00.000Z",
        sourceCount: 2,
        fieldCount: 1,
      },
      fields: [
        {
          field: "flowRate",
          tier: "C",
          status: "CONFLICTING_SOURCES",
          currentValue: null,
          value: null,
          sourceType: null,
          sourceRef: null,
          retrievedAt: null,
          confidence: null,
          evidence: [],
        },
      ],
    });
    render(<JevProductReviewPage productId="p-1" />);
    expect(
      (
        await screen.findByRole("link", { name: "Források eltérnek" })
      ).getAttribute("href"),
    ).toBe("/products/p-1/adatellenorzes/flowRate");
  });

  it("products.view nélkül nem kér le semmit", () => {
    auth.session = session("SERVICE");
    render(<JevProductReviewPage productId="p-1" />);
    expect(screen.getByText("Nincs hozzáférésed a termékhez")).toBeTruthy();
    expect(api.detail).not.toHaveBeenCalled();
    expect(api.enrichment).not.toHaveBeenCalled();
  });
});
