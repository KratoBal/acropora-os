import { render, screen, waitFor } from "@testing-library/react";
import type {
  AssetDetail,
  AssetOwnerListResponse,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetEditorPage } from "./asset-editor-page";

/**
 * A TULAJDONOS, AKI MÁR OTT VAN, NEM ESHET KI.
 *
 * A választható tulajdonosok listája mostantól a szerviz-jelölt partnereké
 * (Balázs bejelentése, 2026-08-25: az űrlap első mezőjében webshopos vevők
 * jöttek fel). Egy MEGLÉVŐ eszköz tulajdonosa viszont lehet olyan, aki ma nem
 * lenne választható, és a mező kötelező: ha a lista nem tartalmazza, a
 * szerkesztő üres mezőt mutat, a mentés pedig vagy elakad, vagy csendben más
 * tulajdonost ír oda. Ez a fájl azt méri, hogy a szerkesztő MEGMONDJA a
 * szervernek, kit kell mindenképp visszaadnia.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  owners: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/uj",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/szerviz/eszkozok", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
  },
};

const servicePartner = {
  type: "SUPPLIER" as const,
  id: "supplier-1",
  code: "FANK",
  displayName: "Fánk Kft.",
  isActive: true,
  addresses: [],
};

const inheritedCustomer = {
  type: "CUSTOMER" as const,
  id: "customer-9",
  code: "VEVO-9",
  displayName: "Webshopos Vevő",
  isActive: true,
  addresses: [],
  outsideServiceScope: true,
};

const asset = {
  id: "asset-1",
  assetNumber: "ESZ-0001",
  name: "Cápasuli kompresszor",
  kind: "EQUIPMENT",
  status: "ACTIVE",
  criticality: "NORMAL",
  qrToken: "qr-1",
  childCount: 0,
  updatedAt: "2026-08-25T10:00:00.000Z",
  createdAt: "2026-08-25T10:00:00.000Z",
  owner: {
    type: "CUSTOMER",
    id: "customer-9",
    code: "VEVO-9",
    displayName: "Webshopos Vevő",
  },
  ancestors: [],
  children: [],
  events: [],
  documents: [],
} as unknown as AssetDetail;

function owners(items: AssetOwnerListResponse["items"]) {
  return { items };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
  });
});

describe("AssetEditorPage tulajdonos-listája", () => {
  it("asks the server to keep the owner the asset already has", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    await waitFor(() => expect(api.owners).toHaveBeenCalled());
    // A HARMADIK argumentum a lényeg: enélkül a lista a szerviz-partnereké, és
    // ennek az eszköznek a tulajdonosa nem lenne benne.
    expect(api.owners.mock.calls[0]?.[2]).toEqual({
      type: "CUSTOMER",
      id: "customer-9",
    });
  });

  it("shows the inherited owner as inherited, not as an offer", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    const option = await screen.findByRole("option", {
      name: /Webshopos Vevő/,
    });
    expect(option.textContent).toMatch(/nem szerviz partner/);
    // És a mező tényleg ezt az értéket viseli, nem üresen áll.
    await waitFor(() =>
      expect(screen.getByLabelText("Partner")).toHaveProperty(
        "value",
        "CUSTOMER:customer-9",
      ),
    );
  });

  /**
   * ÚJ ESZKÖZNÉL NINCS MIT MEGTARTANI, és ez sem mindegy: ha a szerkesztő
   * ilyenkor is küldene egy tulajdonost, a szűrés mellé bekerülne egy sor, amit
   * senki nem tett oda.
   */
  it("asks for the plain service list when there is no asset yet", async () => {
    api.owners.mockResolvedValue(owners([servicePartner]));

    render(<AssetEditorPage />);

    await waitFor(() => expect(api.owners).toHaveBeenCalled());
    expect(api.owners.mock.calls[0]?.[2]).toBeNull();
    expect(api.detail).not.toHaveBeenCalled();
  });
});
