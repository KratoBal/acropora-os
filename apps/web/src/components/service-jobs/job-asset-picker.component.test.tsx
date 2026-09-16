import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobAssetPicker } from "./job-asset-picker";

const assets = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/lib/api/assets", () => ({ assetsApi: assets }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function session(): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "szerelo@acropora.hu",
      displayName: "Szerelő Sándor",
      nickname: "Sanyi",
      role: "SERVICE",
      customerId: null,
      supplierId: null,
    },
  };
}

function asset(id: string, name: string, assetNumber: string) {
  return {
    id,
    assetNumber,
    name,
    kind: "EQUIPMENT" as const,
    status: "ACTIVE" as const,
    criticality: "NORMAL" as const,
    owner: { type: "SUPPLIER" as const, id: "sup-1", name: "Partner Kft." },
  };
}

function valasz(items: ReturnType<typeof asset>[]) {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 100,
      totalItems: items.length,
      totalPages: 1,
    },
  };
}

describe("JobAssetPicker", () => {
  beforeEach(() => {
    auth.session = session();
    assets.list.mockReset().mockResolvedValue(valasz([]));
  });

  /**
   * HELYSZIN NELKUL NEM LISTAZUNK, ES EZT KI IS MONDJUK.
   *
   * Nem technikai korlat: a partner OSSZES eszkoze egy kivalaszthatatlan lista
   * lenne. A mondat megnevezi a teendot, ahelyett hogy egy ures valaszto allna
   * ott magyarazat nelkul -- pontosan az a hiba, amit a telefonos urlapon ma
   * mertunk (PR 636).
   */
  it("helyszin nelkul megmondja, hogy elobb helyszint kell valasztani", () => {
    render(
      <JobAssetPicker departmentId="" selected={[]} onChange={() => {}} />,
    );

    expect(screen.getByText(/Előbb válassz helyszínt/)).toBeTruthy();
    expect(assets.list).not.toHaveBeenCalled();
  });

  /**
   * A RESZFA SZUROJE A HIVASBAN. Az eszkoz a fa BARMELYIK csomopontjahoz
   * kotheto, tehat a pontos egyezes nema hibat adna: a "Biodom" alatti medencen
   * logo eszkoz kimaradna a listabol, es a lista attol meg szabalyosnak
   * latszana.
   */
  it("a valasztott helyszinre szurve ker listat", async () => {
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));
    const query = assets.list.mock.calls[0]?.[1] as URLSearchParams;
    expect(query.get("departmentId")).toEqual("unit-9");
    // A LAPMERET KIMONDVA: alapbol 25 sor jonne, es egy csendben levagott lista
    // itt a legrosszabb fajta hiba.
    expect(query.get("pageSize")).toEqual("100");
    /**
     * AZ ALLAPOT IS KIMONDVA, ES EZ EGY MERT HIBA ORZOJE.
     *
     * A parameter NELKUL a vegpont `ACTIVE`-ra szur, tehat a valaszto CSAK a
     * mukodo eszkozoket kinalta: a javitas alatt allo es a nem uzemelo
     * hianyzott, ES UGY, MINTHA NEM IS LETEZNE -- se ures lista, se hibauzenet.
     * Balazs merte vissza 2026-09-16-an.
     *
     * A NEGATIV FELE IS ALLITAS: ha valaki `ALL`-ra allitana, a KIVEZETETT
     * eszkozok is bejonnenek, es azokra uj hibajegyet nyitni ertelmetlen.
     */
    expect(query.get("status")).toEqual("IN_PLACE");
  });

  it("ures helyszinnel megmondja, hogy nincs nyilvantartott eszkoz", async () => {
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/Ezen a helyszínen nincs nyilvántartott eszköz/),
    ).toBeTruthy();
  });

  /**
   * TOBB ESZKOZ VALASZTHATO, es a valasztas FELFELE megy. A komponens nem
   * tarolja a halmazt: igy az urlap egyetlen helyen tudja, mit kuld el.
   */
  it("tobb eszkozt is fel lehet venni, egyesevel", async () => {
    assets.list.mockResolvedValue(
      valasz([
        asset("esz-1", "Szivattyú", "ESZ-0007"),
        asset("esz-2", "Fehérjelefölöző", "ESZ-0008"),
      ]),
    );
    const valasztas: string[][] = [];
    const { rerender } = render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );

    fireEvent.click(await screen.findByLabelText(/Szivattyú/));
    expect(valasztas[0]).toEqual(["esz-1"]);

    rerender(
      <JobAssetPicker
        departmentId="unit-9"
        selected={["esz-1"]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );
    fireEvent.click(await screen.findByLabelText(/Fehérjelefölöző/));
    expect(valasztas[1]).toEqual(["esz-1", "esz-2"]);
  });

  /**
   * A KALIBRACIO MASIK IRANYA: a felvetel allitasa akkor is zold lenne, ha a
   * kapcsolo csak hozzaadni tudna. Ez meri, hogy le is lehet venni.
   */
  it("a mar kivalasztott eszkozt le lehet venni", async () => {
    assets.list.mockResolvedValue(
      valasz([asset("esz-1", "Szivattyú", "ESZ-0007")]),
    );
    const valasztas: string[][] = [];
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={["esz-1"]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );

    fireEvent.click(await screen.findByLabelText(/Szivattyú/));
    expect(valasztas[0]).toEqual([]);
  });

  /**
   * A LELTARI SZAM A NEV MELLETT ALL. Ket azonos nevu szivattyu egy helyszinen
   * teljesen normalis, es a nev onmagaban akkor sem megkulonbozteto, ha ma
   * veletlenul az.
   */
  it("a leltari szamot is kiirja a nev melle", async () => {
    assets.list.mockResolvedValue(
      valasz([asset("esz-1", "Szivattyú", "ESZ-0007")]),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(await screen.findByText("ESZ-0007")).toBeTruthy();
  });

  /**
   * A LEVAGAS KIMONDVA. A vegpont felso hatara szaz sor: ha egy helyszinen
   * ennyi eszkoz all, a lista MAR hianyos lehet. Egy csendben levagott lista
   * rosszabb a hibanal -- a hianyzo eszkoz ugy nez ki, mintha nem letezne.
   */
  it("szaz sornal szol, hogy a lista hianyos lehet", async () => {
    assets.list.mockResolvedValue(
      valasz(
        Array.from({ length: 100 }, (_, index) =>
          asset(`esz-${index}`, `Eszköz ${index}`, `ESZ-${index}`),
        ),
      ),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/Száz eszköznél megáll a lista/),
    ).toBeTruthy();
  });

  /**
   * ES A TESTVER-KONTROLL: kilencvenkilenc sornal NEM szol. Enelkul az elozo
   * allitas akkor is zold lenne, ha a figyelmeztetes MINDIG ott allna.
   */
  it("szaz alatt nem figyelmeztet", async () => {
    assets.list.mockResolvedValue(
      valasz(
        Array.from({ length: 99 }, (_, index) =>
          asset(`esz-${index}`, `Eszköz ${index}`, `ESZ-${index}`),
        ),
      ),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    await screen.findByText("Eszköz 0");
    expect(screen.queryByText(/Száz eszköznél megáll a lista/)).toBeNull();
  });

  /**
   * A BETOLTESI HIBA SAJAT MONDATOT KAP, nem ures listat. Az "ures" es a "nem
   * sikerult lekerni" ket kulonbozo allapot, es a masodikbol a felhasznalonak
   * azt kell latnia, hogy ujra kell probalnia.
   */
  it("betoltesi hibanal kimondja, hogy nem tolthetok be", async () => {
    assets.list.mockRejectedValue(new Error("halozat"));
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/A helyszín eszközei nem tölthetők be/),
    ).toBeTruthy();
  });
});
