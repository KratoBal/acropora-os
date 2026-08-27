import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetListPage } from "./asset-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
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

function response(page: number): AssetListResponse {
  return {
    items: [
      {
        id: "asset-1",
        assetNumber: "ESZ-0001",
        name: "Cápasuli kompresszor",
        kind: "EQUIPMENT",
        status: "ACTIVE",
        criticality: "NORMAL",
        qrToken: "qr-token-1",
        childCount: 0,
        updatedAt: "2026-08-19T10:00:00.000Z",
        owner: {
          type: "CUSTOMER",
          id: "customer-1",
          code: "VEVO-1",
          displayName: "Fővárosi Állat- És Növénykert",
        },
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

function lastTarget() {
  const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(target.split("?")[1]);
}

function partnerResponse(unit?: {
  id: string;
  code: string;
  name: string;
  path: string[];
}): AssetListResponse {
  const base = response(1);
  return {
    ...base,
    items: [
      {
        ...base.items[0]!,
        owner: {
          type: "SUPPLIER",
          id: "supplier-1",
          code: "SZALL-1",
          displayName: "Fankó Kft.",
        },
        address: {
          id: "supplier:supplier-1",
          formatted: "1146 Budapest, Állatkerti krt. 6-12.",
        },
        unit,
      },
    ],
  };
}

describe("AssetListPage location cell", () => {
  beforeEach(() => {
    auth.session = session;
    api.list.mockReset();
  });

  /**
   * AMIT EZ AZ ALLITAS OR IZ: hogy a listaban a VALASZTOTT hely latszik, nem a
   * visszaeses. Ha a cella a cimet irna ki (ahogy a javitas elott tette),
   * ugyanaz a sor keletkezne egy pontositott es egy nem pontositott eszkozre --
   * es a kettot kivulrol semmi nem kulonboztetne meg.
   */
  it("shows the unit for a partner-owned asset", async () => {
    api.list.mockResolvedValue(
      partnerResponse({
        id: "unit-1",
        code: "BIO",
        name: "Biodóm",
        path: ["Fankó", "Biodóm"],
      }),
    );

    render(<AssetListPage />);

    // A TELJES UT latszik, nem a level neve: ket tavoli ag „Biodóm (BIO)"
    // egysege kulonben ugyanazt a kepet adna.
    expect(await screen.findByText("Fankó / Biodóm (BIO)")).toBeTruthy();
    expect(screen.queryByText(/Nincs pontosítva/)).toBeNull();
  });

  /** A masik fele: alegyseg nelkul a cim latszik, DE megjelolve, hogy ez nem
   * valasztas eredmenye. Enelkul a ket eset egyforma lenne. */
  it("marks the partner address as a fallback when no unit is set", async () => {
    api.list.mockResolvedValue(partnerResponse(undefined));

    render(<AssetListPage />);

    expect(
      await screen.findByText(/Nincs pontosítva\. 1146 Budapest/),
    ).toBeTruthy();
  });
});

describe("AssetListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2&status=ACTIVE");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
  });

  // A lapozás nem mehet a szűrő-ágon: az mindig page=1-et ír a végén, tehát
  // a "Következő" gomb csendben az első oldalra vitt vissza, és az első
  // oldalon túl semmi nem volt elérhető erről a képernyőről.
  it("moves forward instead of bouncing back to the first page", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("3");
  });

  it("steps back one page, not all the way to the start", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Előző" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
  });

  it("keeps the active filters while paging", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("ACTIVE");
  });

  // A szűrő viszont HELYESEN ugrik vissza az elsőre: egy másik szűrő
  // negyedik oldala jellemzően nem is létezik.
  it("still returns to the first page when a filter changes", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.change(screen.getByLabelText("Státusz"), {
      target: { value: "RETIRED" },
    });

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
    expect(lastTarget().get("status")).toBe("RETIRED");
  });
});

describe("AssetListPage es az ugyfel sajat kodja", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset();
  });

  /**
   * A KERESES EDDIG IS NEZTE, A SOR VISZONT NEM MUTATTA. Az ugyfel felolvassa a
   * sajat kodjat, a talalat feljon, es semmi nem arulja el, MIRE illeszkedett --
   * a felhasznalo ilyenkor ugyanazt kerdezi meg megegyszer.
   */
  it("shows the customer's own code on the row when there is one", async () => {
    const withCode = response(1);
    withCode.items[0]!.inventoryNumber = "LT-4711";
    api.list.mockResolvedValue(withCode);

    render(<AssetListPage />);

    expect(await screen.findByText("LT-4711")).toBeTruthy();
    expect(screen.getByText(/Leltári szám/)).toBeTruthy();
  });

  /**
   * ES AMI NINCS, AZ NEM LESZ URES FELIRAT: egy "Leltári szám:" cimke ertek
   * nelkul azt allitana, hogy tudunk rola valamit.
   */
  it("writes no label at all when the asset has no such code", async () => {
    api.list.mockResolvedValue(response(1));

    render(<AssetListPage />);

    expect(await screen.findByText("ESZ-0001")).toBeTruthy();
    expect(screen.queryByText(/Leltári szám/)).toBeNull();
  });
});
