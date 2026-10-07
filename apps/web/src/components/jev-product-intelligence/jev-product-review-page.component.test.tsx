import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ProductDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { JevProductReviewPage } from "./jev-product-review-page";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  enrichment: vi.fn(),
  knowledge: vi.fn(),
  addKnowledgeEvidence: vi.fn(),
  acceptKnowledge: vi.fn(),
  saveKnowledgeCopy: vi.fn(),
  approveKnowledgeCopy: vi.fn(),
}));
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
  api.knowledge
    .mockReset()
    .mockResolvedValue({ productId: "p-1", facts: [], copy: [] });
  for (const write of [
    api.addKnowledgeEvidence,
    api.acceptKnowledge,
    api.saveKnowledgeCopy,
    api.approveKnowledgeCopy,
  ])
    write.mockReset().mockResolvedValue({});
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
          fieldResultId: "fr-flow",
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

  describe("termékismeret (#1431)", () => {
    const conflictReview = {
      availability: "review",
      lastRun: {
        at: "2026-10-03T19:00:00.000Z",
        sourceCount: 1,
        fieldCount: 1,
      },
      fields: [
        {
          fieldResultId: "fr-dosing-2",
          field: "dosing",
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
    };
    const acceptedConflict = {
      field: "dosing",
      value: null,
      unit: null,
      status: "CONFLICTING_SOURCES",
      revision: 1,
      acceptedAt: "2026-10-03T19:01:00.000Z",
      acceptedBy: { id: "u", displayName: "Teszt Kolléga" },
      fieldResultId: "fr-dosing-2",
      source: { sourceType: null, sourceRef: null, retrievedAt: null },
    };

    /**
     * MI PIROSÍTJA: ha az "Elfogad" nem a sor saját eredményére mutatna, ha
     * a lap az írás után nem olvasná újra a tényeket (a sor nem mondaná, mi
     * lett elfogadva), vagy ha az ütközés értékkel jelenne meg elfogadottként.
     */
    it("ütközést érték nélkül fogad el, a sor saját eredményére mutatva, és újraolvas", async () => {
      api.enrichment.mockResolvedValue(conflictReview);
      api.knowledge
        .mockResolvedValueOnce({ productId: "p-1", facts: [], copy: [] })
        .mockResolvedValue({
          productId: "p-1",
          facts: [acceptedConflict],
          copy: [],
        });
      render(<JevProductReviewPage productId="p-1" />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Elfogad ütközésként" }),
      );
      expect(
        await screen.findByText(
          "Elfogadva ütközésként, érték nélkül (1. változat) A webshopban nem jelenik meg, amíg az ütközés nincs feloldva.",
        ),
      ).toBeTruthy();
      expect(api.acceptKnowledge).toHaveBeenCalledWith(
        "token-1",
        "p-1",
        "fr-dosing-2",
      );
      expect(api.knowledge).toHaveBeenCalledTimes(2);
      expect(api.enrichment).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: "Elfogad ütközésként" }),
      ).toBeNull();
    });

    it("termékismeret-jog nélkül nincs Elfogad gomb és nincs kézi bizonyíték", async () => {
      auth.session = session("MANAGER");
      api.enrichment.mockResolvedValue(conflictReview);
      render(<JevProductReviewPage productId="p-1" />);
      expect(
        await screen.findByRole("link", { name: "Források eltérnek" }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Elfogad/ })).toBeNull();
      expect(
        screen.queryByRole("form", { name: "Kézi bizonyíték" }),
      ).toBeNull();
    });

    it("a kézi bizonyíték a beírt idézettel, értékkel és forrással megy ki", async () => {
      render(<JevProductReviewPage productId="p-1" />);
      const form = await screen.findByRole("form", { name: "Kézi bizonyíték" });
      fireEvent.change(within(form).getByLabelText("Forrás fajtája"), {
        target: { value: "MANUFACTURER_DOCUMENT" },
      });
      fireEvent.change(within(form).getByLabelText("A forrás címe"), {
        target: { value: "https://gyarto.example.invalid/dosage.pdf" },
      });
      fireEvent.change(within(form).getByLabelText("Szó szerinti idézet"), {
        target: { value: "1-2 x/week 1 drop/100L" },
      });
      fireEvent.change(within(form).getByLabelText("Érték"), {
        target: { value: "1 drop/100 L, 1-2/week" },
      });
      fireEvent.click(
        within(form).getByRole("button", { name: "Bizonyíték rögzítése" }),
      );
      expect(
        await screen.findByText(
          "A bizonyíték rögzítve, a mező újra egyeztetve.",
        ),
      ).toBeTruthy();
      expect(api.addKnowledgeEvidence).toHaveBeenCalledWith("token-1", "p-1", {
        field: "dosing",
        sourceType: "MANUFACTURER_DOCUMENT",
        url: "https://gyarto.example.invalid/dosage.pdf",
        raw: "1-2 x/week 1 drop/100L",
        value: "1 drop/100 L, 1-2/week",
      });
    });

    it("az elavult szöveg ezt mondja, és nem hagyható jóvá; a friss piszkozat igen", async () => {
      api.knowledge.mockResolvedValue({
        productId: "p-1",
        facts: [],
        copy: [
          {
            block: "lead",
            body: "Régi bevezető.",
            status: "APPROVED",
            stale: true,
            usedFields: [],
            editedAt: "2026-10-03T18:00:00.000Z",
            approvedAt: "2026-10-03T18:01:00.000Z",
          },
          {
            block: "body",
            body: "Friss törzs.",
            status: "DRAFT",
            stale: false,
            usedFields: [],
            editedAt: "2026-10-03T19:00:00.000Z",
            approvedAt: null,
          },
        ],
      });
      render(<JevProductReviewPage productId="p-1" />);
      expect(
        await screen.findByText("Elavult: a tények változtak a mentés óta"),
      ).toBeTruthy();
      const lead = screen.getByRole("button", { name: "Bevezető jóváhagyása" });
      const body = screen.getByRole("button", { name: "Leírás jóváhagyása" });
      expect((lead as HTMLButtonElement).disabled).toBe(true);
      expect((body as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(body);
      expect(await screen.findByText("A szöveg jóváhagyva.")).toBeTruthy();
      expect(api.approveKnowledgeCopy).toHaveBeenCalledWith(
        "token-1",
        "p-1",
        "body",
      );
    });
  });
});
