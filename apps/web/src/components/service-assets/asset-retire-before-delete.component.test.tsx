import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetDetail, AssetQrCode, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetailPage } from "./asset-detail-page";

/**
 * A KIVEZETÉS A FŐ ÚT, ÉS A VISSZAFORDÍTHATÓSÁGA AZ ELSŐ ÁLLÍTÁS.
 *
 * Balázs döntése (2026-08-31): a törlési szabály marad, de a felület a
 * KIVEZETÉST ajánlja elsőként. A kivezetés azért lett a fő út, mert MEGŐRZI az
 * adatot — és ebből következik, hogy ha a felhasználó véglegesnek hiszi, akkor
 * épp a TÖRLÉS felé mozdul. Egy kimondatlan visszafordíthatóság tehát nem
 * hiányzó információ, hanem **az ellenkezőjét éri el annak, amit a döntés
 * akart**.
 *
 * Ezért áll az első állítás arról, hogy a megerősítő ablak KIMONDJA: visszavonható,
 * és megmondja, HOL. Egy szöveg, amit semmi nem véd, egy takarítás alkalmával
 * eltűnik.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  qr: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateQr: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  documentUrl: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/asset-1",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/szerviz/eszkozok", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));

function session(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "balazs@acropora.local",
      displayName: "Balázs",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

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

async function open(role: Session["user"]["role"] = "OWNER") {
  auth.session = session(role);
  render(<AssetDetailPage assetId="asset-1" />);
  await waitFor(() => expect(api.detail).toHaveBeenCalled());
  fireEvent.click(
    await screen.findByRole("button", { name: "Eszköz kivezetése" }),
  );
  return screen.findByRole("dialog");
}

describe("kivezetés a fő út, törlés a második", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(asset);
    api.qr.mockResolvedValue(qr);
    api.update.mockResolvedValue({ ...asset, status: "RETIRED" });
    api.remove.mockResolvedValue({ ok: true });
  });

  /**
   * AZ ELSO ALLITAS, ES NEM VELETLENUL: enelkul a dontes celja fordul a
   * visszajara. Ha ez a szoveg kikerul, EZ az allitas bukik, nevvel.
   */
  it("a kivezetés megerősítése KIMONDJA, hogy visszavonható, és hol", async () => {
    const dialog = await open();
    expect(dialog.textContent).toContain("Visszavonható");
    expect(dialog.textContent).toContain("állapot mezőben");
  });

  it("a megerősítés megnevezi, mi marad meg", async () => {
    const dialog = await open();
    expect(dialog.textContent).toContain("megmaradnak");
  });

  /**
   * EGY GOMB, NEM KETTO. Ket egymas melletti gomb VALASZTASSA tenne, ami nem az.
   */
  it("az adatlapon NINCS törlés gomb a kivezetés mellett", async () => {
    auth.session = session("OWNER");
    render(<AssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.detail).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /Végleges törlés/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Eszköz kivezetése" }),
    ).toBeTruthy();
  });

  it("a törlés a kivezetés ablakából érhető el, egy lépéssel beljebb", async () => {
    const dialog = await open();
    fireEvent.click(
      await screen.findByText("Ez az eszköz téves felvitel? Végleges törlés."),
    );
    const second = await screen.findByRole("dialog");
    expect(second.textContent).toContain("Véglegesen törlöd");
    expect(second.textContent).toContain("Nem vonható vissza");
    void dialog;
  });

  /**
   * A JOG NELKULI FELHASZNALONAK NEM LETILTVA, HANEM SEHOGY. Egy MANAGER minden
   * mas szempontbol jogosult (SERVICE_MANAGE megvan neki), es PONTOSAN a
   * torlesi jog hianyzik -- tehat ha a hivatkozas megjelenne, az CSAK a
   * jog-ellenorzes hibaja lehetne.
   */
  it("SERVICE_ASSET_DELETE nélkül a törlés-hivatkozás MEG SEM jelenik", async () => {
    const dialog = await open("MANAGER");
    expect(dialog.textContent).toContain("Kivezeted");
    expect(
      screen.queryByText("Ez az eszköz téves felvitel? Végleges törlés."),
    ).toBeNull();
  });

  /**
   * A SZERVER VISSZAUTASITASA SZO SZERINT MEGY TOVABB. Egy "az eszkoz nem
   * torolheto" mondat ugyanannyit mondana, mint a semmi: a szerver harom kulon
   * szamlalot ad, es epp az mondja meg, hol nezzen utana a felhasznalo.
   */
  it("a visszautasítás szövege megnevezi, MI tartja vissza", async () => {
    api.remove.mockRejectedValue(
      new Error(
        "Az eszköz nem törölhető, mert tartozik hozzá: 3 munkalapsor, 1 alárendelt eszköz.",
      ),
    );
    await open();
    fireEvent.click(
      await screen.findByText("Ez az eszköz téves felvitel? Végleges törlés."),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Végleges törlés" }),
    );
    expect(await screen.findByText(/3 munkalapsor/)).toBeTruthy();
    expect(screen.getByText(/1 alárendelt eszköz/)).toBeTruthy();
  });
});
