import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AssetDetail,
  AssetListNeighbors,
  AssetQrCode,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetDetailPage } from "./pilot-asset-detail-page";

/**
 * AZ ADATLAP ELŐZŐ/KÖVETKEZŐ GOMBJA (Balázs kérése, 2026-09-30 12:29 UTC):
 * a lap tetején és alján, a lista szűrésével és sorrendjével, a lista végén
 * tiltva.
 *
 * Ez a spec a LAP oldalát méri: hogy a két gombpár ott áll, hogy a szomszéd-
 * kérés a lista legutóbbi címéből, a lista alapértékeivel indul, és hogy a
 * lépés testvér-lépés (a "Vissza" célja nem mozdul). Hogy a szerver a lista
 * feltételével és sorrendjével keres, az API integrációs spec dolga.
 */

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const history = vi.hoisted(() => ({
  listHref: "/szerviz/eszkozok",
  stepTo: vi.fn(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({
    href: history.listHref,
    fromWithinApp: true,
    goBack: vi.fn(),
  }),
  useListHref: () => history.listHref,
  useStepTo: () => history.stepTo,
}));

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  qr: vi.fn(),
  neighbors: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateQr: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadDocumentThumbnail: vi.fn(),
  setDocumentCaption: vi.fn(),
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
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

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
    type: "SUPPLIER",
    id: "supplier-1",
    code: "FANK",
    displayName: "Fánk Kft.",
  },
  ancestors: [],
  children: [],
  events: [],
  documents: [],
} as unknown as AssetDetail;

const qr = {
  assetId: "asset-1",
  assetNumber: "ESZ-0001",
  value: "acropora-os://assets/scan/qr-1",
  svg: "<svg />",
  labelSizeMm: 30,
} as AssetQrCode;

function neighbors(
  previousId: string | null,
  nextId: string | null,
): AssetListNeighbors {
  return { previousId, nextId, position: 1, total: 2 };
}

const top = () =>
  screen.getByRole("navigation", { name: "Lapozás az eszközök között" });
const bottom = () =>
  screen.getByRole("navigation", { name: "Lapozás (lap alja)" });

beforeEach(() => {
  vi.clearAllMocks();
  history.listHref = "/szerviz/eszkozok";
  api.detail.mockResolvedValue(asset);
  api.qr.mockResolvedValue(qr);
  api.neighbors.mockResolvedValue(neighbors(null, "asset-2"));
});

describe("eszköz adatlap: Előző / Következő", () => {
  it("a lap tetején és alján is ott áll, a lista elején az Előző tiltva", async () => {
    render(<PilotAssetDetailPage assetId="asset-1" />);
    await screen.findByText("Cápasuli kompresszor");

    for (const nav of [top(), bottom()]) {
      await waitFor(() =>
        expect(
          within(nav).getByRole("button", { name: /Következő/ }),
        ).toBeEnabled(),
      );
      expect(within(nav).getByRole("button", { name: /Előző/ })).toBeDisabled();
    }
  });

  it("a lista végén a Következő tiltva", async () => {
    api.neighbors.mockResolvedValue(neighbors("asset-0", null));
    render(<PilotAssetDetailPage assetId="asset-1" />);
    await waitFor(() =>
      expect(
        within(top()).getByRole("button", { name: /Előző/ }),
      ).toBeEnabled(),
    );
    expect(
      within(top()).getByRole("button", { name: /Következő/ }),
    ).toBeDisabled();
    expect(
      within(bottom()).getByRole("button", { name: /Következő/ }),
    ).toBeDisabled();
  });

  it("a lépés testvér-lépés a szomszéd adatlapjára", async () => {
    render(<PilotAssetDetailPage assetId="asset-1" />);
    const next = await within(
      await screen.findByRole("navigation", {
        name: "Lapozás (lap alja)",
      }),
    ).findByRole("button", { name: /Következő/ });
    await waitFor(() => expect(next).toBeEnabled());

    fireEvent.click(next);
    expect(history.stepTo).toHaveBeenCalledWith("/szerviz/eszkozok/asset-2");
  });

  /*
    A SZŰRÉS ÉS A SORREND A LISTA LEGUTÓBBI CÍMÉBŐL JÖN. MI PIROSÍT: ha a
    kérés a lista query-je nélkül megy (a szomszéd a szűretlen listáé lenne),
    vagy ha az alapértékek eltérnek a listáétól (a lista a "Beépített" fület
    mutatja, a szomszéd a szerver "ACTIVE" alapértékével jönne).
  */
  it("a szomszédot a lista szűrésével és sorrendjével kéri", async () => {
    history.listHref = "/szerviz/eszkozok?status=ALL&sort=status&page=3";
    render(<PilotAssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.neighbors).toHaveBeenCalled());

    const [token, id, query] = api.neighbors.mock.calls.at(-1)!;
    expect([token, id]).toEqual(["token-1", "asset-1"]);
    const params = query as URLSearchParams;
    expect(params.get("status")).toBe("ALL");
    expect(params.get("sort")).toBe("status");
  });

  it("lista-látogatás nélkül a lista alapnézetével (Beépített) kéri", async () => {
    render(<PilotAssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.neighbors).toHaveBeenCalled());
    const params = api.neighbors.mock.calls.at(-1)![2] as URLSearchParams;
    expect(params.get("status")).toBe("IN_PLACE");
  });
});
