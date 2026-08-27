import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetDetail, AssetQrCode, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetailPage } from "./asset-detail-page";

/**
 * A MEGERŐSÍTÉS MEGMONDJA, MI TÖRTÉNIK.
 *
 * Ez az oldal két visszafordíthatatlan műveletet kínál, és mindkettő a
 * böngésző `window.confirm` ablakán ment: a dokumentum törlésénél a teljes
 * kérdés annyi volt, hogy „Biztosan törlöd ezt a dokumentumot?". Az a mondat
 * nem mondja meg, hogy a fájl a tárolóból is eltűnik, és azt sem, hogy nincs
 * visszaút. Ez a fájl azt méri, hogy a kérdés MEGNEVEZI a következményt, és
 * hogy a „Mégsem" tényleg nem csinál semmit.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  qr: vi.fn(),
  update: vi.fn(),
  rotateQr: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  documentUrl: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/asset-1",
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
    customerId: null,
    supplierId: null,
  },
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
    type: "SUPPLIER",
    id: "supplier-1",
    code: "FANK",
    displayName: "Fánk Kft.",
  },
  ancestors: [],
  children: [],
  events: [],
  documents: [
    {
      id: "doc-1",
      type: "INVOICE",
      fileName: "szamla-2026-08.pdf",
      contentType: "application/pdf",
      sizeBytes: 12345,
      sha256: "abc",
      createdAt: "2026-08-25T10:00:00.000Z",
      uploadedBy: { id: "user-1", displayName: "Balázs" },
    },
  ],
} as unknown as AssetDetail;

const qr = {
  assetId: "asset-1",
  assetNumber: "ESZ-0001",
  value: "acropora-os://assets/scan/qr-1",
  svg: "<svg />",
  labelSizeMm: 30,
} as AssetQrCode;

beforeEach(() => {
  vi.clearAllMocks();
  api.detail.mockResolvedValue(asset);
  api.qr.mockResolvedValue(qr);
  api.documentUrl.mockReturnValue("https://pelda.invalid/doc-1");
});

async function openDocumentConfirm() {
  render(<AssetDetailPage assetId="asset-1" />);
  const remove = await screen.findByRole("button", { name: "Törlés" });
  fireEvent.click(remove);
  return await screen.findByRole("dialog");
}

describe("AssetDetailPage megerősítései", () => {
  it("names what is lost and whether it can be recovered", async () => {
    const dialog = await openDocumentConfirm();

    // A fájl NEVE benne van: nem „ezt a dokumentumot", hanem melyiket.
    expect(dialog.textContent).toMatch(/szamla-2026-08\.pdf/);
    // MI VÉSZ EL: nem csak a listáról tűnik el.
    expect(dialog.textContent).toMatch(/tárolóból is törlődik/);
    // HONNAN SZEREZHETŐ VISSZA: itt sehonnan, és ezt ki is mondja.
    expect(dialog.textContent).toMatch(/Nem vonható vissza/);
  });

  /**
   * A KÉRDÉS ÖNMAGÁBAN NEM TÖRÖL. Ez a `window.confirm`-nál magától értetődő
   * volt, egy saját ablaknál viszont ez az a hiba, amit könnyű bevinni: a
   * gomb megnyitja a kérdést ÉS elindítja a műveletet.
   */
  it("does not delete anything just by asking", async () => {
    await openDocumentConfirm();

    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("does nothing when the answer is no", async () => {
    await openDocumentConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("deletes exactly the document that was named", async () => {
    api.deleteDocument.mockResolvedValue(undefined);
    await openDocumentConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await waitFor(() =>
      expect(api.deleteDocument).toHaveBeenCalledWith(
        "token-1",
        "asset-1",
        "doc-1",
      ),
    );
  });

  /**
   * A QR-CSERE a másik visszafordíthatatlan művelet ugyanezen az oldalon, és a
   * következménye MÁS: nem adat vész el, hanem a kinyomtatott matrica válik
   * használhatatlanná. A két kérdés szövege ezért nem lehet ugyanaz.
   */
  it("says something different about the QR label, because the loss is different", async () => {
    render(<AssetDetailPage assetId="asset-1" />);
    const rotate = await screen.findByRole("button", {
      name: "QR-kód lecserélése",
    });
    fireEvent.click(rotate);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/matricán lévő kód azonnal érvénytelen/);
    expect(dialog.textContent).toMatch(/ki kell nyomtatni/);
    expect(api.rotateQr).not.toHaveBeenCalled();
  });
});
