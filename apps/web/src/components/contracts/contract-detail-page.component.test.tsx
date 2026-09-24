import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContractDetailPage } from "./contract-detail-page";
import type { ContractSummary } from "@/lib/api/contracts";

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
describe("ContractDetailPage -- betöltés token nélkül (éles, süti-alapú bejelentkezés)", () => {
  beforeEach(() => {
    api.detail.mockReset();
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
  });

  it("üres (undefined) tokennel is elindítja a betöltést, nem marad örökre 'betöltés…' állapotban", async () => {
    auth.session = session(undefined);
    api.detail.mockResolvedValue(contract());

    render(<ContractDetailPage contractId="contract-1" />);

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

    render(<ContractDetailPage contractId="contract-1" />);

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
describe("ContractDetailPage -- tétel helyszíne és eszközei", () => {
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

    render(<ContractDetailPage contractId="contract-1" />);
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

    render(<ContractDetailPage contractId="contract-1" />);
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
              description: "Cápasuli RO karbantartás",
              departmentId: "department-1",
              assetIds: [],
            }),
          ],
        }),
      ),
    );
  });
});
