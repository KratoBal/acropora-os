import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockSyncOutboxPage } from "./stock-sync-outbox-page";

const api = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn() }));

vi.mock("@/lib/api/inventory", () => ({ stockSyncOutboxApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

const summary = (overrides: Record<string, unknown> = {}) => ({
  workerEnabled: true,
  intervalMs: 300_000,
  counts: {
    PENDING: 0,
    PROCESSING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    DEAD_LETTER: 0,
  },
  lastSuccessfulPublishAt: "2026-09-01T18:00:00.000Z",
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
  variantId: "v1",
  warehouseId: "w1",
  sku: "ACR-001",
  targetOnHand: "7",
  status: "FAILED" as const,
  attempts: 2,
  nextAttemptAt: "2026-09-03T10:00:00.000Z",
  lastError: "A UNAS elutasította a készletet.",
  resolutionNote: null,
  sourceProcess: "inventory-count",
  sourceRecordId: "count-1",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  processedAt: null,
  ...overrides,
});

beforeEach(() => {
  api.summary.mockReset().mockResolvedValue(summary());
  api.list.mockReset().mockResolvedValue([]);
});

describe("készlet-kimenősor oldal", () => {
  /**
   * A KONTROLL: az oldal TENYLEG lekeri az osszefoglalot. Enelkul minden lenti
   * allitas egy soha meg nem hivott vegpontrol szolna -- epp az a szakadas,
   * amit ez az oldal bezar.
   */
  it("lekéri az összefoglalót", async () => {
    render(<StockSyncOutboxPage />);
    await waitFor(() => expect(api.summary).toHaveBeenCalledWith("token-1"));
  });

  /**
   * EZ AZ ALLITAS A LAP LETEZESENEK OKA.
   *
   * Kikapcsolt kikuldo mellett a szamok UGYANUGY neznek ki, mint bekapcsolt
   * mellett: egy varakozo tetel ott all mindket esetben. A kulonbseg az, hogy
   * az egyikben kimegy, a masikban nem -- es ha ezt a lap nem mondja ki, akkor
   * ugyanazt a kepernyot ket ellentetes allapotra adjuk.
   */
  it("kimondja, ha a kiküldő ki van kapcsolva", async () => {
    api.summary.mockResolvedValue(
      summary({
        workerEnabled: false,
        intervalMs: null,
        counts: {
          PENDING: 12,
          PROCESSING: 0,
          SUCCEEDED: 40,
          FAILED: 1,
          DEAD_LETTER: 0,
        },
      }),
    );
    render(<StockSyncOutboxPage />);
    expect(
      await screen.findByText("A kiküldő ki van kapcsolva"),
    ).toBeInTheDocument();
    // ES a szam is ott van: a ketto EGYUTT mond valamit, kulon egyik sem.
    expect(await screen.findByText("12")).toBeInTheDocument();
  });

  it("bekapcsolt kiküldőnél az ütemezést mutatja, nem a figyelmeztetést", async () => {
    render(<StockSyncOutboxPage />);
    expect(await screen.findByText("A kiküldő fut")).toBeInTheDocument();
    expect(
      screen.queryByText("A kiküldő ki van kapcsolva"),
    ).not.toBeInTheDocument();
  });

  /**
   * A "MEG SOHA" NEM UGYANAZ, MINT EGY REGI DATUM, es a vegpont mindkettore
   * `null`-t, illetve idobelyeget ad. Ha a lap a `null`-t ures mezokent
   * jelenitene meg, a nezo azt hinne, hogy nem toltodott be -- holott az a
   * valasz maga.
   */
  it("a soha ki nem ment készletet szövegként mondja ki", async () => {
    api.summary.mockResolvedValue(summary({ lastSuccessfulPublishAt: null }));
    render(<StockSyncOutboxPage />);
    expect(await screen.findByText("még soha")).toBeInTheDocument();
  });

  /**
   * AZ URES ALLAPOT KET ALLITASA. Nem az a lenyeg, hogy megjelenik a "Nincs
   * talalat" -- hanem hogy MELLETTE ott all, MIT kerdeztunk. A ket allapot
   * ("tenyleg ures" es "rossz szuro") teendoje ellentetes, es egy nema ures
   * lap ugyanazt a kepernyot adja rajuk.
   */
  it("üres sornál kimondja, hogy minden állapotot kérdezett", async () => {
    render(<StockSyncOutboxPage />);
    expect(await screen.findByText("Nincs találat.")).toBeInTheDocument();
    expect(
      await screen.findByText(/A szűrő: minden állapot/),
    ).toBeInTheDocument();
  });

  it("szűrt üres sornál a szűrőt nevezi meg, és más állapotra irányít", async () => {
    render(<StockSyncOutboxPage />);
    await screen.findByText("Nincs találat.");
    fireEvent.change(screen.getByLabelText("Állapot szűrő"), {
      target: { value: "FAILED" },
    });
    expect(
      await screen.findByText(/A szűrő: Hibás állapotú tételek/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith(
        "token-1",
        { status: "FAILED" },
        expect.anything(),
      ),
    );
  });

  it("a sorokat megmutatja, a hibaszöveggel együtt", async () => {
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    expect(await screen.findByText("ACR-001")).toBeInTheDocument();
    expect(
      await screen.findByText("A UNAS elutasította a készletet."),
    ).toBeInTheDocument();
  });
});
