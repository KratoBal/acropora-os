import { render, screen } from "@testing-library/react";
import type { Session, UnasOrderListResponse } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deletionCheckSentence,
  WebshopOrdersPage,
} from "./webshop-orders-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  triggerSync: vi.fn(),
  // A LAP EZT IS HIVJA. Egy dupla, amibol hianyzik egy hivott metodus, nem
  // a hibat rejti el, hanem a mereset: a lap hibara fut, es a teszt a
  // hianyos mockot meri a viselkedes helyett.
  deletionReconciliationStatus: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/unas-orders", () => ({ unasOrdersApi: api }));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

beforeEach(() => {
  auth.session = ownerSession;
  api.list.mockReset();
  api.triggerSync.mockReset();
  api.deletionReconciliationStatus
    .mockReset()
    .mockResolvedValue({ enabled: false, intervalMs: null, batchSize: null });
});

describe("WebshopOrdersPage", () => {
  it("a fizikai UNAS-törlést mutatja az utolsó ismert aktív státusz helyett", async () => {
    const response: UnasOrderListResponse = {
      items: [
        {
          id: "order-deleted",
          orderNumber: "UNAS-47679-234831",
          status: "CANCELLED",
          unasStatusLabel: "Feldolgozásra vár",
          buyerName: "Teszt Vevő",
          paymentName: "Bankkártya",
          shippingName: "GLS",
          totalGross: "12700",
          currency: "HUF",
          lineCount: 1,
          createdAt: "2026-08-08T14:06:00.000Z",
          orderedAt: "2026-08-08T14:05:00.000Z",
          unasDeletedAt: "2026-08-09T09:00:00.000Z",
        },
      ],
      pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
    };
    api.list.mockResolvedValue(response);

    render(createElement(WebshopOrdersPage));

    expect(await screen.findByText("Törölve a UNAS-ban")).toBeInTheDocument();
    expect(screen.queryByText("Feldolgozásra vár")).not.toBeInTheDocument();
    expect(screen.getByText("1 tétel")).toBeInTheDocument();
  });
});

describe("what the page says about the deletion check", () => {
  /**
   * A HAROM ALLAPOT KULON, mert a ketto osszevonasa MAGA a hiba, amit ez a
   * sor megelozni hivatott. Egy lap, ami nem tudta lekerdezni az allapotot,
   * nem allithatja, hogy a ellenorzes nem fut -- es forditva sem.
   */
  it("kikapcsolt allapotban kimondja, hogy nem fut, es megnevezi a kovetkezmenyet", () => {
    const sentence = deletionCheckSentence({
      enabled: false,
      intervalMs: null,
      batchSize: null,
    });

    expect(sentence).toContain("nem fut");
    expect(sentence).toContain("kézi frissítés");
  });

  it("bekapcsolt allapotban a gyakorisagot percben mondja", () => {
    const sentence = deletionCheckSentence({
      enabled: true,
      intervalMs: 30 * 60_000,
      batchSize: 50,
    });

    expect(sentence).toContain("30 percenként");
    expect(sentence).not.toContain("nem fut");
  });

  it("sikertelen lekerdezes utan NEM allitja, hogy ki van kapcsolva", () => {
    const sentence = deletionCheckSentence("unknown");

    // POZITIV KONTROLL A TAGADASHOZ: a "nem fut" alak ott van a kikapcsolt
    // mondatban (az elso allitas meri), tehat ez a kereses meg TUDNA
    // talalni, ha a szoveg azt mondana. A hianya igy a szovegrol szol, nem
    // a keresesrol.
    expect(sentence).not.toContain("nem fut");
    expect(sentence).toContain("nem sikerült lekérdezni");
  });

  it("betoltes kozben nem mond semmit", () => {
    expect(deletionCheckSentence("loading")).toBeNull();
  });

  it("a lapon megjelenik, hogy az ellenorzes nem fut", async () => {
    api.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    } satisfies UnasOrderListResponse);

    render(createElement(WebshopOrdersPage));

    expect(
      await screen.findByText(/Törölt rendelések ellenőrzése: nem fut/),
    ).toBeInTheDocument();
  });

  it("ha az allapot lekerdezese bukik, a lap nem allitja, hogy nem fut", async () => {
    api.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    } satisfies UnasOrderListResponse);
    api.deletionReconciliationStatus.mockRejectedValue(new Error("503"));

    render(createElement(WebshopOrdersPage));

    expect(
      await screen.findByText(/nem sikerült lekérdezni/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nem fut/)).not.toBeInTheDocument();
  });
});
