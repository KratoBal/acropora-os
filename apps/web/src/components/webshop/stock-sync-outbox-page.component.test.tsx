import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockSyncOutboxPage } from "./stock-sync-outbox-page";

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  list: vi.fn(),
  retry: vi.fn(),
  run: vi.fn(),
}));

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
  api.retry.mockReset().mockResolvedValue(row());
  api.run.mockReset().mockResolvedValue(undefined);
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

  /**
   * A KET MUVELET EDDIG FOGYASZTO NELKUL ALLT: a vegpont es a kliens-fuggveny is
   * keszen volt, csak a lap nem hivta. Ez a ket allitas azt a kotest meri.
   */
  it("a hibás sort újra sorba lehet állítani, és utána újratölt", async () => {
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-001");
    expect(api.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Újra sorba" }));

    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(1));
    expect(api.retry.mock.calls[0]?.[1]).toBe("row-1");
    // A VALASZ CSAK NYUGTA: a kepernyot ujratoltesbol epitjuk, kulonben az
    // OSSZEFOGLALO szamai regiek maradnanak a friss lista mellett.
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
  });

  it("a köteget azonnal le lehet futtatni", async () => {
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-001");

    fireEvent.click(
      screen.getByRole("button", { name: "Köteg futtatása most" }),
    );

    await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
  });

  /**
   * AZ UJRA SORBA ALLITAS CSAK OTT ALL, AHOL A VEGPONT IS ENGEDI.
   *
   * KET ALLITAS EGYUTT: a hibas soron OTT a gomb, a varakozon NINCS. Az elso
   * onmagaban akkor is zold lenne, ha a gomb MINDEN soron allna.
   */
  it("csak a hibás és a holtlevél soron kínálja az újra sorba állítást", async () => {
    api.list.mockResolvedValue([
      row(),
      row({ id: "row-2", sku: "ACR-002", status: "PENDING" }),
    ]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-002");

    expect(screen.getAllByRole("button", { name: "Újra sorba" })).toHaveLength(
      1,
    );
  });

  /**
   * A MEGSZAKITOTT KERES NEM HIBA.
   *
   * A cleanup MINDEN szuro-valtasnal abortal. Eddig az abort ugyanabba a catch
   * agba esett, mint egy valodi hiba, es a lap PIROS savot villantott -- holott
   * semmi nem romlott el.
   */
  it("megszakított lekérdezésnél nem villant hibát", async () => {
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-001");

    api.list.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    fireEvent.change(screen.getByLabelText("Állapot szűrő"), {
      target: { value: "FAILED" },
    });

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("A tételek betöltése nem sikerült"),
    ).not.toBeInTheDocument();
  });

  /**
   * TESTVER-KONTROLL: A VALODI HIBA TOVABBRA IS LATSZIK. Enelkul az elozo
   * allitas akkor is zold lenne, ha a lap SOHA nem mutatna hibat.
   */
  it("valódi hibánál továbbra is szól", async () => {
    api.list.mockRejectedValue(new Error("A szerver nem válaszol."));
    render(<StockSyncOutboxPage />);

    expect(
      await screen.findByText("A tételek betöltése nem sikerült"),
    ).toBeInTheDocument();
  });
});
