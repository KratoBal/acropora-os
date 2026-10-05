import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotContractDetailPage } from "./pilot-contract-detail-page";
import { ApiError } from "@/lib/api/client";
import type { ContractSummary } from "@/lib/api/contracts";

/**
 * ÁTMÁSOLVA A RÉGI `contract-detail-page.component.test.tsx`-BŐL
 * (2026-09-25, Figma 13. kör) -- az állítások nem változtak, csak a
 * komponens neve és egy kötelező `next/font/local` mock került hozzá (a
 * `PilotThemeRoot` ezen múlik, lásd a többi pilot-teszt fejlécét).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn() }));
const orderApi = vi.hoisted(() => ({ list: vi.fn() }));
const worksheetsApi = vi.hoisted(() => ({ departments: vi.fn() }));
const assetsApi = vi.hoisted(() => ({ list: vi.fn(), scanLabel: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/contracts", () => ({ contractsApi: api }));
vi.mock("@/lib/api/maintenance-orders", () => ({
  maintenanceOrdersApi: orderApi,
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi }));
// A JobAssetPicker sajat API-t hasznal (assetsApi) -- mockolva, hogy a
// teszt ne induljon valodi halozati hivast.
vi.mock("@/lib/api/assets", () => ({ assetsApi }));

function session(token: string | undefined): Session {
  return {
    id: "session-1",
    token,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "balazs@acropora.local",
      displayName: "Balázs",
      role: "OWNER",
      customerId: null,
      supplierId: null,
    },
  };
}

function contract(): ContractSummary {
  return {
    id: "contract-1",
    customerId: "customer-1",
    customer: { id: "customer-1", displayName: "Fővárosi Állatkert" },
    number: "SZ2026/0000019",
    title: "Éves karbantartás",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    status: "ACTIVE",
    notes: null,
    organizationalUnitName: null,
    contactPersonName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    documents: [],
    items: [],
  };
}

/**
 * BALÁZS ÉLES HIBÁJA, 2026-09-24 17:39: az adatlap örökre "Szerződés
 * betöltése…" állapotban maradt, mert az effektus `if (token)` mögé volt
 * zárva, és éles (jelszavas, süti-alapú) bejelentkezésnél a
 * `Session.token` MINDIG `undefined` -- a kliens oldalon nincs olvasható
 * token, a böngésző httpOnly sütije hitelesít. Ez a teszt PONTOSAN ezt a
 * kalibrációt méri: üres tokennel renderelve is le kell futnia a
 * betöltésnek.
 */
describe("PilotContractDetailPage -- betöltés token nélkül (éles, süti-alapú bejelentkezés)", () => {
  beforeEach(() => {
    api.detail.mockReset();
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
  });

  it("üres (undefined) tokennel is elindítja a betöltést, nem marad örökre 'betöltés…' állapotban", async () => {
    auth.session = session(undefined);
    api.detail.mockResolvedValue(contract());

    render(<PilotContractDetailPage contractId="contract-1" />);

    await screen.findByText("SZ2026/0000019");
    expect(api.detail).toHaveBeenCalledWith("", "contract-1");
    expect(orderApi.list).toHaveBeenCalledWith("", "contract-1");
  });

  /*
    POZITÍV KONTROLL: a fejlesztői (Bearer-tokenes) bejelentkezésnél is
    ugyanígy fusson le -- e nélkül egy jövőbeli "csak akkor töltsön be, ha
    VAN token" visszaállítás is zölden menne át a fenti egyetlen eseten.
  */
  it("valódi tokennel is lefut a betöltés", async () => {
    auth.session = session("dev-token");
    api.detail.mockResolvedValue(contract());

    render(<PilotContractDetailPage contractId="contract-1" />);

    await screen.findByText("SZ2026/0000019");
    expect(api.detail).toHaveBeenCalledWith("dev-token", "contract-1");
  });
});

const DEPARTMENT: import("@acropora/types").WorksheetDepartmentSummary = {
  id: "department-1",
  parentId: null,
  code: "CAP",
  name: "Cápasuli",
  isActive: true,
};

/**
 * ACROBOT KÉRÉSE, 2026-09-24 20:36 (élesben blokkoló): a szerver mindig is
 * tudta a tétel helyszínét és eszközeit, a webes felületen sehol nem volt
 * hozzá mező. Ezek a tesztek a szerkesztő oldal ÚJ részét mérik.
 */
describe("PilotContractDetailPage -- tétel helyszíne és eszközei", () => {
  beforeEach(() => {
    auth.session = session("dev-token");
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments
      .mockReset()
      .mockResolvedValue({ items: [DEPARTMENT] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  function contractWithItem(): ContractSummary {
    return {
      ...contract(),
      items: [
        {
          id: "item-1",
          position: 1,
          description: "Cápasuli RO karbantartás",
          unitNet: "410000",
          quantity: "1",
          occasionsPerYear: 4,
          vatRatePercent: "27",
          departmentId: null,
          assets: [],
        },
      ],
    };
  }

  it("felkínálja a partner helyszíneit a tétel alatt", async () => {
    api.detail.mockResolvedValue(contractWithItem());

    render(<PilotContractDetailPage contractId="contract-1" />);
    // A "Cápasuli RO karbantartás" szöveg KÉT helyen is szerepel (a
    // "Szerződéses tételek" kártyán ÉS a "Megrendelőlapok" kártya
    // jelölőnégyzet-listáján), ezért az árat keressük, ami csak az elsőn.
    await screen.findByText(/410000 Ft/);

    expect(
      await screen.findByRole("option", { name: "Cápasuli (CAP)" }),
    ).toBeTruthy();
  });

  it("a kiválasztott helyszínt elküldi a mentéskor, a tétel többi adatával együtt", async () => {
    api.detail.mockResolvedValue(contractWithItem());
    api.update.mockResolvedValue(contractWithItem());

    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByText(/410000 Ft/);
    // A helyszín-lista KÜLÖN, a tétel-lekéréstől független hívásból töltődik
    // be (worksheetsApi.departments) -- teli csomagfutásnál lassabb is lehet
    // az árnál, ezért a mezőt magát is meg kell várni, nem elég az árra.
    const departmentField = await screen.findByLabelText("Helyszín");

    fireEvent.change(departmentField, {
      target: { value: "department-1" },
    });
    fireEvent.click(screen.getByText("Módosítások mentése"));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "dev-token",
        "contract-1",
        expect.objectContaining({
          items: [
            expect.objectContaining({
              id: "item-1",
              description: "Cápasuli RO karbantartás",
              departmentId: "department-1",
              assetIds: [],
            }),
          ],
        }),
      ),
    );
  });

  /**
   * Balázs éles hibája (2026-09-24 21:48, Állatkert): a mentés után a
   * kijelölt tételek listája ("Megrendelőlap kiállítása (N tétel)") a
   * RÉGI tétel-számot mutatta, mert a `save()` csak a `contract` state-et
   * frissítette a szerver válaszából, a kijelölés-állapotot nem. Ez a
   * teszt a `applyContractDetail` közös inicializálást méri: a mentés
   * utáni válaszban egy ÚJ tétellel bővült listának a kijelölés-száma is
   * ehhez igazodjon, ne a mentés előtti tétel-számhoz.
   */
  it("mentés után a kijelölt tételek száma a szerver ÚJ válaszához igazodik, nem a réginek", async () => {
    api.detail.mockResolvedValue(contractWithItem());
    api.update.mockResolvedValue({
      ...contractWithItem(),
      items: [
        ...contractWithItem().items,
        {
          id: "item-2",
          position: 2,
          description: "Új tétel",
          unitNet: "5000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
          departmentId: null,
          assets: [],
        },
      ],
    });

    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByText(/410000 Ft/);
    expect(screen.getByText("Megrendelőlap kiállítása (1 tétel)")).toBeTruthy();

    fireEvent.click(screen.getByText("Módosítások mentése"));

    await waitFor(() =>
      expect(
        screen.getByText("Megrendelőlap kiállítása (2 tétel)"),
      ).toBeTruthy(),
    );
  });
});

/**
 * BALÁZS ÉLES HIBÁJA, 2026-09-24 20:31 (acrobot kártyája 31f8c5b4): egy
 * duplikált szerződésszámmal mentett, és csak egy általános "A kérés
 * feldolgozása nem sikerült" jelent meg -- a mező alatt semmi. A 409-es
 * választ mostantól a MEZŐ alatt kell mutatni, nem egy általános dobozban.
 */
describe("PilotContractDetailPage -- duplikált szerződésszám (409)", () => {
  beforeEach(() => {
    api.detail.mockReset().mockResolvedValue(contract());
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
    auth.session = session("dev-token");
  });

  it("a szerződésszám mező alatt mutatja a 409 üzenetét, nem egy általános dobozban", async () => {
    api.update.mockRejectedValue(
      new ApiError("Ez a szerződésszám már létezik (SZ2026/0000019).", 409),
    );

    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByText("SZ2026/0000019");

    fireEvent.click(screen.getByText("Módosítások mentése"));

    await screen.findByText("Ez a szerződésszám már létezik (SZ2026/0000019).");
    expect(screen.queryByText("Mentési hiba")).toBeNull();
  });

  it("a mező szerkesztése törli a korábbi 409-hibát", async () => {
    api.update.mockRejectedValue(
      new ApiError("Ez a szerződésszám már létezik (SZ2026/0000019).", 409),
    );

    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByText("SZ2026/0000019");
    fireEvent.click(screen.getByText("Módosítások mentése"));
    await screen.findByText("Ez a szerződésszám már létezik (SZ2026/0000019).");

    fireEvent.change(screen.getByLabelText("Szerződésszám *"), {
      target: { value: "SZ2026/0000020" },
    });

    await waitFor(() =>
      expect(
        screen.queryByText("Ez a szerződésszám már létezik (SZ2026/0000019)."),
      ).toBeNull(),
    );
  });

  it("egy nem-409 hibát a régi, általános dobozban mutatja", async () => {
    api.update.mockRejectedValue(new Error("VALAMI MÁS HIBA"));

    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByText("SZ2026/0000019");

    fireEvent.click(screen.getByText("Módosítások mentése"));

    await screen.findByText("Mentési hiba");
    expect(screen.getByText("VALAMI MÁS HIBA")).toBeTruthy();
  });
});

/*
  A MEGLÉVŐ TÉTEL TÖRLÉSE AZ ADATLAPON (kártya c014db6f). A szerver a listából
  kimaradó tételt törli, a megmaradók azonosítója marad
  (`contracts.repository.ts` `update()`); a megrendelőlap-tétel `Restrict`-tel
  mutat rá, tehat egy megrendelőlapban szereplő tétel törlése 409-et adna. MI
  PIROSÍT: ha a törölt tétel mégis elmegy, vagy a megmaradó más azonosítóval;
  ha egy megrendelőlapban szereplő tétel törölhető; ha a betöltés alatt is az.
*/
describe("PilotContractDetailPage -- tétel törlése", () => {
  const item = (id: string, position: number, description: string) => ({
    id,
    position,
    description,
    unitNet: `${position}000`,
    quantity: "1",
    occasionsPerYear: 1,
    vatRatePercent: "27",
    departmentId: null,
    assets: [],
  });
  const twoItems = (): ContractSummary => ({
    ...contract(),
    items: [item("item-1", 1, "Szűrőcsere"), item("item-2", 2, "Vízcsere")],
  });

  beforeEach(() => {
    auth.session = session("dev-token");
    api.detail.mockReset().mockResolvedValue(twoItems());
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  it("a törölt tétel nem megy a mentéskor, a megmaradó a saját azonosítójával megy, és utána eltűnik", async () => {
    api.update.mockResolvedValue({
      ...contract(),
      items: [item("item-1", 1, "Szűrőcsere")],
    });
    render(<PilotContractDetailPage contractId="contract-1" />);
    const torles = await screen.findByRole("button", {
      name: "2. tétel törlése",
    });
    await waitFor(() => expect(torles.hasAttribute("disabled")).toBe(false));

    fireEvent.click(torles);
    fireEvent.click(screen.getByText("Módosítások mentése"));

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const items = api.update.mock.calls[0]![2].items as { id: string }[];
    expect(items.map((sent) => sent.id)).toEqual(["item-1"]);
    await waitFor(() => expect(screen.queryByText(/2000 Ft/)).toBeNull());
    expect(screen.getByText(/1000 Ft/)).toBeTruthy();
  });

  it("megrendelőlapban szereplő tétel nem törölhető, és ki van írva, miért", async () => {
    orderApi.list.mockResolvedValue([
      {
        id: "order-1",
        number: "MR-1",
        status: "REVOKED",
        occasionYear: 2026,
        issuedAt: "2026-10-01T00:00:00.000Z",
        issuedByName: null,
        signedAt: null,
        revokedAt: "2026-10-02T00:00:00.000Z",
        revokedByName: null,
        revokeReason: null,
        contract: { id: "contract-1", number: "SZ", title: "T" },
        items: [
          {
            id: "order-item-1",
            description: "Vízcsere",
            unitNet: "2000",
            quantity: "1",
            vatRatePercent: "27",
            contractItem: { id: "item-2", position: 2, departmentId: null },
          },
        ],
        documents: [],
      },
    ]);
    render(<PilotContractDetailPage contractId="contract-1" />);
    const zart = await screen.findByRole("button", {
      name: "2. tétel törlése",
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Ehhez a tételhez már készült megrendelőlap, ezért nem törölhető.",
        ),
      ).toBeTruthy(),
    );
    expect(zart.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "1. tétel törlése" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("amíg a megrendelőlapok nem töltődtek be, nem törölhető", async () => {
    orderApi.list.mockReturnValue(new Promise(() => {}));
    render(<PilotContractDetailPage contractId="contract-1" />);
    const gomb = await screen.findByRole("button", {
      name: "1. tétel törlése",
    });
    expect(gomb.hasAttribute("disabled")).toBe(true);
  });
});

/*
  A TÉTEL SZERKESZTÉSE ÉS FELVÉTELE AZ ADATLAPON (kártya c014db6f, Ág Luca,
  2026-10-05 07:47 UTC: mentés és újranyitás után is szerkeszthetők legyenek).
  Mérve előtte: az újranyitott szerződés tételei csak olvashatók voltak, csak a
  helyszín és az eszközök változtak. MI PIROSÍT: ha a módosítás nem megy el,
  vagy más azonosítóval; ha az új tétel azonosítót kap a kliensen; ha egy
  kiürített mezővel menteni lehet; ha a még el nem mentett tétel
  megrendelőlapra kijelölhető.
*/
describe("PilotContractDetailPage -- tétel szerkesztése és felvétele", () => {
  const item = (id: string, position: number, description: string) => ({
    id,
    position,
    description,
    unitNet: `${position}000`,
    quantity: "1",
    occasionsPerYear: 1,
    vatRatePercent: "27",
    departmentId: null,
    assets: [],
  });
  const twoItems = (): ContractSummary => ({
    ...contract(),
    items: [item("item-1", 1, "Szűrőcsere"), item("item-2", 2, "Vízcsere")],
  });

  beforeEach(() => {
    auth.session = session("dev-token");
    api.detail.mockReset().mockResolvedValue(twoItems());
    api.update.mockReset().mockResolvedValue(twoItems());
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  it("a módosított tétel a saját azonosítójával, az új értékekkel megy", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    fireEvent.change(await screen.findByLabelText("1. tétel leírása"), {
      target: { value: "Szűrőcsere és mosás" },
    });
    fireEvent.change(screen.getByLabelText("1. tétel nettó egységára"), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("1. tétel alkalma évente"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByText("Módosítások mentése"));

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const items = api.update.mock.calls[0]![2].items as Record<
      string,
      unknown
    >[];
    expect(items[0]).toMatchObject({
      id: "item-1",
      description: "Szűrőcsere és mosás",
      unitNet: "1500",
      occasionsPerYear: 4,
    });
    expect(items[1]).toMatchObject({ id: "item-2", description: "Vízcsere" });
  });

  it("az új tétel azonosító nélkül, a végére kerül; a meglévők azonosítója marad", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByLabelText("1. tétel leírása");
    fireEvent.click(screen.getByText("Tétel hozzáadása"));
    fireEvent.change(screen.getByLabelText("3. tétel leírása"), {
      target: { value: "Pumpacsere" },
    });
    fireEvent.change(screen.getByLabelText("3. tétel nettó egységára"), {
      target: { value: "9000" },
    });
    fireEvent.click(screen.getByText("Módosítások mentése"));

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const items = api.update.mock.calls[0]![2].items as Record<
      string,
      unknown
    >[];
    expect(items.map((sent) => sent.id)).toEqual([
      "item-1",
      "item-2",
      undefined,
    ]);
    expect("id" in items[2]!).toBe(false);
    expect(items[2]).toMatchObject({
      description: "Pumpacsere",
      unitNet: "9000",
    });
  });

  it("kiürített leírással nem menthető, és kiírja, mi hiányzik", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    fireEvent.change(await screen.findByLabelText("2. tétel leírása"), {
      target: { value: "  " },
    });
    expect(screen.getByText(/minden tétel kitöltése/)).toBeTruthy();
    expect(
      screen
        .getByText("Módosítások mentése")
        .closest("button")!
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("a még el nem mentett tétel nem jelölhető ki megrendelőlapra", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    await screen.findByLabelText("1. tétel leírása");
    const before = screen.getAllByRole("checkbox").length;
    fireEvent.click(screen.getByText("Tétel hozzáadása"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(before);
  });
});
