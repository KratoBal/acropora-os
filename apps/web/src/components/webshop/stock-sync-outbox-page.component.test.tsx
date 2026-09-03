import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockSyncOutboxPage } from "./stock-sync-outbox-page";

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  list: vi.fn(),
  retry: vi.fn(),
  run: vi.fn(),
}));

/**
 * A SZEREPKOR VALTOZTATHATO, mert a lap ket muvelete `inventory.manage`-t ker,
 * a nezes viszont `inventory.view`-t. A SALES szerepkor pont a ketto kozott
 * all: lat, de nem kezel -- vagyis ez nem kitalalt fixtura, hanem a valodi
 * jog-tablabol vett eset.
 */
const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "SALES" }));

vi.mock("@/lib/api/inventory", () => ({ stockSyncOutboxApi: api }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: auth.role },
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
  auth.role = "OWNER";
  api.summary.mockReset().mockResolvedValue(summary());
  api.list.mockReset().mockResolvedValue([]);
  api.retry.mockReset().mockResolvedValue({ retried: true, status: "PENDING" });
  api.run.mockReset().mockResolvedValue({
    claimed: 3,
    succeeded: 3,
    superseded: 0,
    retried: 0,
    deadLettered: 0,
  });
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
   * A MEGSZAKITOTT KERES NEM HIBA.
   *
   * A `list` itt CSAK a megszakitasra valaszol, ezert a szurovaltas pontosan
   * azt az utat jarja be, amit a bongeszoben: a cleanup megszakitja az elozo
   * kerest, es az AbortError ugyanazon a `catch` agon jon vissza, mint egy
   * valodi halozati hiba. A `waitFor` azert kell, mert a megszakitas
   * microtaskban erkezik: enelkul az allitas AZELOTT futna le, hogy a hibas
   * kod egyaltalan kiirhatna a figyelmeztetest -- vagyis zold lenne a javitas
   * nelkul is.
   */
  it("a megszakított lekérdezést nem mutatja hibaként", async () => {
    api.list.mockImplementation(
      (_token: string, _query: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    render(<StockSyncOutboxPage />);
    fireEvent.change(await screen.findByLabelText("Állapot szűrő"), {
      target: { value: "FAILED" },
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("A tételek betöltése nem sikerült"),
    ).not.toBeInTheDocument();
  });

  /**
   * A PAR MASIK FELE, ES NELKULE AZ ELOZO ALLITAS FELREVEZET.
   *
   * Az abort-orzo egy hibauzenetet nyom el. Ha valaki tul szelesre veszi --
   * ugy, hogy MINDEN hibat elnyel --, a fenti allitas ZOLD marad, mert az
   * csak azt meri, hogy a megszakitasra NEM jelenik meg semmi. Merve
   * 2026-09-03, a fo agon: egy olyan rontas, ami minden hibat elnyel, az
   * EGESZ keszletbol nulla allitast dontott pirosra (515 lefutott, 0 piros).
   *
   * Ezert all itt a par masik fele: egy VALODI hiba (nem megszakitas)
   * tovabbra is latszodjon. A ketto egyutt hataroz meg egy viselkedest; kulon
   * egyik sem, es a hiany EPP abba az iranyba engedne, ami a lapot
   * megnyugtatova teszi, amikor baj van.
   *
   * ES AMIT A KOD SZERKEZETEBOL TUDNI KELL HOZZA: a hibauzenet KET allapotbol
   * all ossze (`rows === null` ES nem toltunk epp), a `rows` kezdoerteke pedig
   * szinten `null`. A megkulonboztetest a toltes-jelzo adja, tehat egy elnyelt
   * hiba nem hibauzenetet ad, hanem OROKKE POROG.
   */
  it("a valódi hibát továbbra is kimondja", async () => {
    api.list.mockRejectedValue(new Error("A szerver nem érhető el."));
    render(<StockSyncOutboxPage />);
    expect(
      await screen.findByText("A tételek betöltése nem sikerült"),
    ).toBeInTheDocument();
  });

  /**
   * A KONTROLL A KET UJ VEGPONTRA: a lap TENYLEG hivja oket. Enelkul minden
   * lenti allitas egy soha meg nem hivott vegpont szovegerol szolna.
   */
  it("a futtatás gombja a run végpontot hívja", async () => {
    render(<StockSyncOutboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    await waitFor(() => expect(api.run).toHaveBeenCalledWith("token-1"));
  });

  /**
   * EZ AZ ALLITAS A GOMB LETEZESENEK ARA.
   *
   * A munkas ALAPERTELMEZETTEN ki van kapcsolva, tehat ez a leggyakoribb
   * valasz. Ilyenkor SEMMI nem fut le -- es ha a lap ugyanazt a visszajelzest
   * adna, mint egy valodi futasra, a nezo azt hinne, hogy kivitte a tetelekt.
   */
  it("kimondja, ha a kézi futtatás azért nem vitt ki semmit, mert a kiküldő ki van kapcsolva", async () => {
    api.run.mockResolvedValue("DISABLED");
    render(<StockSyncOutboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    expect(await screen.findByText("Nem futott le semmi")).toBeInTheDocument();
    expect(screen.queryByText("A köteg lefutott")).not.toBeInTheDocument();
  });

  it("a hibára futott kötegre nem sikert ír", async () => {
    api.run.mockResolvedValue("FAILED");
    render(<StockSyncOutboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    expect(
      await screen.findByText("A köteg hibára futott"),
    ).toBeInTheDocument();
  });

  /**
   * A NULLA TETEL SEM UGYANAZ, MINT EGY KIMENT KOTEG: a futas lefutott, csak
   * nem volt mit kivinnie. Ket kulonbozo allapot, ket kulonbozo teendo.
   */
  it("a nulla tételes futást megkülönbözteti a kimenttől", async () => {
    api.run.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      superseded: 0,
      retried: 0,
      deadLettered: 0,
    });
    render(<StockSyncOutboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    expect(
      await screen.findByText("Lefutott, de nem volt kivihető tétel"),
    ).toBeInTheDocument();
  });

  it("a lefutott köteg mérlegét számokkal mondja ki", async () => {
    render(<StockSyncOutboxPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    expect(await screen.findByText("A köteg lefutott")).toBeInTheDocument();
    expect(
      await screen.findByText(/Elvéve: 3\. Kiment: 3\./),
    ).toBeInTheDocument();
  });

  it("a hibás sort újra sorba állítja", async () => {
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Újra" }));
    await waitFor(() =>
      expect(api.retry).toHaveBeenCalledWith("token-1", "row-1"),
    );
    expect(
      await screen.findByText("ACR-001: újra sorba állítva"),
    ).toBeInTheDocument();
  });

  /**
   * A `retried: false` NEM SIKER. A szerver akkor adja, ha a sor idokozben
   * kikerult a hibas allapotbol -- es ha a lap ezt is sikernek mutatna, a nezo
   * azt hinne, hogy O inditotta ujra. A szerver valaszanak KET agát ket kulon
   * mondat fedi.
   */
  it("a meg nem történt újrapróbálást nem mutatja sikernek", async () => {
    api.list.mockResolvedValue([row()]);
    api.retry.mockResolvedValue({ retried: false, status: "PROCESSING" });
    render(<StockSyncOutboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Újra" }));
    expect(
      await screen.findByText("ACR-001: nem történt újrapróbálás"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/most: Feldolgozás alatt/),
    ).toBeInTheDocument();
  });

  /**
   * A SZUKITES ALLITASA, NEM A MUKODESE. A szerver `manualRetry` aga kizarolag
   * FAILED es DEAD_LETTER sort vesz vissza; egy PENDING sor melle kitett gomb
   * olyan muveletet igerne, ami sosem tortenik meg.
   */
  it("nem hibás sor mellé nem tesz újrapróbálás gombot", async () => {
    api.list.mockResolvedValue([
      row({ id: "row-2", sku: "ACR-002", status: "PENDING", lastError: null }),
    ]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-002");
    expect(
      screen.queryByRole("button", { name: "Újra" }),
    ).not.toBeInTheDocument();
  });

  /**
   * A MASIK SZUKITES: a ket muvelet `inventory.manage`-t ker. A SALES
   * szerepkor lat, de nem kezel -- ez a valodi jog-tablabol vett eset, nem
   * kitalalt fixtura.
   */
  it("inventory.manage jog nélkül egyik művelet gombja sem jelenik meg", async () => {
    auth.role = "SALES";
    api.list.mockResolvedValue([row()]);
    render(<StockSyncOutboxPage />);
    await screen.findByText("ACR-001");
    expect(
      screen.queryByRole("button", { name: "Futtatás most" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Újra" }),
    ).not.toBeInTheDocument();
  });

  /**
   * EGY MUVELET UTAN A SZAMOK IS ELAVULNAK, nem csak a lista: egy sikeres
   * futas PENDING-bol SUCCEEDED-be visz tetelekt. Ha csak a lista frissulne,
   * a fenti kartya a muvelet ELOTTI allast mutatna tovabb.
   */
  it("a művelet után újratölti az összefoglalót és a listát is", async () => {
    render(<StockSyncOutboxPage />);
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(1));
    fireEvent.click(
      await screen.findByRole("button", { name: "Futtatás most" }),
    );
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
