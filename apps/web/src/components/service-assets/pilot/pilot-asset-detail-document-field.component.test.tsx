import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AssetDetail,
  AssetListNeighbors,
  AssetQrCode,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetDetailPage } from "./pilot-asset-detail-page";

/*
  A "FÉNYKÉP VAGY PDF" MEZŐ AZ ESZKÖZ-ADATLAPON (a routolt Pilot lap; az 2063 és a barracuda megjegyzése, 2026-11-03):
  magyar fájlmező, és a SIKERES feltöltés után kiürül (a lap a fájl-állapotot is kiürítette, de a mező tovább a
  feltöltött fájl nevét mutatta). MI PIROSÍT: ha a mező újra natív (a felirat nem magyar), ha a feltöltés után nem
  kap üres értéket, vagy ha egy SIKERTELEN feltöltés után is kiürülne (a fájl ott marad az újrapróbához).
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({
    href: "/szerviz/eszkozok",
    fromWithinApp: true,
    goBack: vi.fn(),
  }),
  useListHref: () => "/szerviz/eszkozok",
  useStepTo: () => vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  api.detail.mockResolvedValue(asset);
  api.qr.mockResolvedValue({
    assetId: "asset-1",
    assetNumber: "ESZ-0001",
    value: "acropora-os://assets/scan/qr-1",
    svg: "<svg />",
    labelSizeMm: 30,
  } as AssetQrCode);
  api.neighbors.mockResolvedValue({
    previousId: null,
    nextId: null,
    position: 1,
    total: 1,
  } as AssetListNeighbors);
});

describe("eszköz adatlap (Pilot): Fénykép vagy PDF", () => {
  it("magyar felirattal áll, és kiírja a kiválasztott fájl nevét", async () => {
    render(<PilotAssetDetailPage assetId="asset-1" />);
    const mezo = await screen.findByLabelText("Fénykép vagy PDF");
    expect(screen.getByText("Fájl kiválasztása")).toBeTruthy();
    expect(screen.getByText("Nincs kiválasztott fájl")).toBeTruthy();

    fireEvent.change(mezo, {
      target: {
        files: [new File(["bajtok"], "medence.jpg", { type: "image/jpeg" })],
      },
    });
    expect(await screen.findByText("medence.jpg")).toBeTruthy();
  });

  it("a sikeres feltöltés után kiüríti a mezőt, a sikertelen után nem", async () => {
    const beirasok: string[] = [];
    api.uploadDocument.mockRejectedValueOnce(new Error("Nem sikerült"));
    render(<PilotAssetDetailPage assetId="asset-1" />);
    const mezo = await screen.findByLabelText("Fénykép vagy PDF");
    Object.defineProperty(mezo, "value", {
      configurable: true,
      get: () => "",
      set: (v: string) => {
        beirasok.push(v);
      },
    });
    fireEvent.change(mezo, {
      target: {
        files: [new File(["bajtok"], "medence.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    await screen.findByText("Nem sikerült");
    expect(beirasok).toEqual([]);

    api.uploadDocument.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(beirasok).toEqual([""]));
  });
});
