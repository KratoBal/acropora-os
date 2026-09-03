import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetLabelBatchSummary, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetLabelBatchesPage } from "./asset-label-batches-page";

const labels = vi.hoisted(() => ({
  batches: vi.fn(),
  issue: vi.fn(),
  codes: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetLabelsApi: labels }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "owner@acropora.local",
      displayName: "Tulaj Tibor",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const batch = (
  overrides: Partial<AssetLabelBatchSummary> = {},
): AssetLabelBatchSummary => ({
  id: "koteg-1",
  createdAt: "2026-09-02T20:14:00.000Z",
  count: 10,
  freeCount: 0,
  ...overrides,
});

describe("AssetLabelBatchesPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("OWNER");
    labels.batches.mockReset().mockResolvedValue([batch()]);
    labels.issue.mockReset().mockResolvedValue({
      batchId: "koteg-2",
      codes: ["V2196"],
    });
    labels.codes.mockReset().mockResolvedValue({ codes: ["V2196", "A0001"] });
  });

  /**
   * A LAP LETEZIK ES BETOLT. Ez az allitas a 404 helyere all: a menupont
   * 2026-09-02 ota be volt kotve, az oldal viszont nem letezett.
   */
  it("kilistázza a korábbi kötegeket", async () => {
    render(<AssetLabelBatchesPage />);

    expect(await screen.findByText(/2026\. 09\. 02\./)).toBeTruthy();
    expect(
      screen.getByText(/10 kód, ebből 0 még nincs eszközhöz rendelve/),
    ).toBeTruthy();
  });

  /**
   * A SZABAD DARABSZAM ELO SZAM, ES A LAP KIMONDJA. A szam a megnyitaskor
   * szamolodik, tehat SOHA nem no -- egy statikusnak latszo mezo mellett a
   * kezelo elakadtnak hinne a rendszert.
   */
  it("kimondja, hogy a szabad darabszám soha nem nő", async () => {
    render(<AssetLabelBatchesPage />);

    expect(
      await screen.findByText(/soha nem nő, csak csökkenhet/),
    ).toBeTruthy();
  });

  /**
   * A LISTA HIBAJA NEM URES LISTA.
   *
   * Egy sikertelen lekerdezes ures tombre esve ugy nezne ki, mintha meg egy
   * koteg sem keszult volna -- es a kezelo nyugodtan generalna egy ujat,
   * holott a regiek megvannak. Ez pontosan az a nema alak, amit a
   * keszlet-kimenosor lapjan is megtalaltunk.
   */
  it("betöltési hibánál nem üres listát mutat, hanem megmondja, mi történt", async () => {
    labels.batches.mockRejectedValue(new Error("A szerver nem válaszol."));
    render(<AssetLabelBatchesPage />);

    expect(await screen.findByText("A lista nem tölthető be")).toBeTruthy();
    expect(screen.queryByText("Még nem generáltál köteget")).toBeNull();
  });

  /**
   * TESTVER-KONTROLL: A VALODI URES LISTA MAS MONDATOT KAP. Az elozo allitas
   * onmagaban akkor is zold lenne, ha a lap SOHA nem mutatna ures allapotot.
   */
  it("üres listánál a hiányt mondja ki, nem hibát", async () => {
    labels.batches.mockResolvedValue([]);
    render(<AssetLabelBatchesPage />);

    expect(await screen.findByText("Még nem generáltál köteget")).toBeTruthy();
    expect(screen.queryByText("A lista nem tölthető be")).toBeNull();
  });

  /**
   * A HATARON KIVULI DARABSZAM NEM JUT EL A SZERVERIG.
   *
   * KET MERES: a mondat megjelenik, ES a hivas NEM tortenik meg. Egy orzot nem
   * az bizonyit, hogy szol, hanem hogy nem tortent semmi -- itt a "semmi" azt
   * jelenti, hogy nem keletkezett fizikai matrica-iv.
   */
  it("a határon kívüli darabszámmal nem generál", async () => {
    render(<AssetLabelBatchesPage />);
    await screen.findByText(/2026\. 09\. 02\./);

    fireEvent.change(screen.getByLabelText("Darabszám"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kötegek generálása" }));

    expect(
      await screen.findByText(/A darabszám 1 és 500 között lehet/),
    ).toBeTruthy();
    expect(labels.issue).not.toHaveBeenCalled();
  });

  it("érvényes darabszámmal generál, és utána újratölti a listát", async () => {
    render(<AssetLabelBatchesPage />);
    await screen.findByText(/2026\. 09\. 02\./);
    expect(labels.batches).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Darabszám"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kötegek generálása" }));

    await waitFor(() => expect(labels.issue).toHaveBeenCalledTimes(1));
    expect(labels.issue.mock.calls[0]?.[1]).toBe(50);
    // A LISTA MAGA A VISSZAIGAZOLAS: nincs kulon felugro ablak, az uj koteg
    // egyszeruen megjelenik.
    await waitFor(() => expect(labels.batches).toHaveBeenCalledTimes(2));
  });

  /**
   * A LETOLTES KULON HIVAS, NEM A LISTA RESZE. A lista otven kotegrol szol,
   * egyenkent akar otszaz koddal -- az akkor is atmenne a halon, ha senki nem
   * tolt le semmit.
   */
  it("a letöltés a köteg kódjait külön kéri le", async () => {
    render(<AssetLabelBatchesPage />);
    await screen.findByText(/2026\. 09\. 02\./);

    expect(labels.codes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "CSV letöltése" }));

    await waitFor(() => expect(labels.codes).toHaveBeenCalledTimes(1));
    expect(labels.codes.mock.calls[0]?.[1]).toBe("koteg-1");
  });
});
