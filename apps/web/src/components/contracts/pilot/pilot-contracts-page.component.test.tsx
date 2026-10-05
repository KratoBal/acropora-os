import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotContractsPage } from "./pilot-contracts-page";
import { ApiError } from "@/lib/api/client";

/**
 * ÁTMÁSOLVA A RÉGI `contracts-page.component.test.tsx`-BŐL (2026-09-25,
 * Figma 13. kör) -- az állítások nem változtak, csak a komponens neve és
 * egy kötelező `next/font/local` mock került hozzá (a `PilotThemeRoot`
 * ezen múlik, lásd a többi pilot-teszt fejlécét).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  customers: vi.fn(),
  create: vi.fn(),
}));
const worksheetsApi = vi.hoisted(() => ({ departments: vi.fn() }));
const assetsApi = vi.hoisted(() => ({ list: vi.fn(), scanLabel: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/contracts", () => ({ contractsApi: api }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi }));
vi.mock("@/lib/api/assets", () => ({ assetsApi }));

function session(): Session {
  return {
    id: "session-1",
    token: "dev-token",
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

const DEPARTMENT = {
  id: "department-1",
  parentId: null,
  code: "CAP",
  name: "Cápasuli",
  isActive: true,
};

/**
 * ACROBOT KÉRÉSE, 2026-09-24 20:36 (élesben blokkoló): a szerver mindig is
 * elfogadta a tétel helyszínét és eszközeit, a webes FELVITELEN sehol nem
 * volt hozzá mező.
 */
describe("PilotContractsPage -- új szerződés tételének helyszíne", () => {
  beforeEach(() => {
    auth.session = session();
    api.list.mockReset().mockResolvedValue([]);
    api.customers
      .mockReset()
      .mockResolvedValue([
        { id: "customer-1", displayName: "Fővárosi Állatkert" },
      ]);
    api.create.mockReset().mockResolvedValue({ id: "contract-1" });
    worksheetsApi.departments
      .mockReset()
      .mockResolvedValue({ items: [DEPARTMENT] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  function openFormAndPickCustomer() {
    fireEvent.click(screen.getByText("Új szerződés"));
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "customer-1" },
    });
  }

  it("csak a partner kiválasztása után kínálja fel a helyszínt", async () => {
    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    fireEvent.click(screen.getByText("Új szerződés"));

    expect(screen.queryByText("Helyszínek betöltése…")).toBeNull();
    expect(worksheetsApi.departments).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "customer-1" },
    });

    expect(
      await screen.findByRole("option", { name: "Cápasuli (CAP)" }),
    ).toBeTruthy();
  });

  it("a kiválasztott helyszín a tétel többi adatával együtt megy a mentéskor", async () => {
    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    openFormAndPickCustomer();
    await screen.findByRole("option", { name: "Cápasuli (CAP)" });

    fireEvent.change(screen.getByLabelText("Szerződésszám *"), {
      target: { value: "SZ2026/0000019" },
    });
    fireEvent.change(screen.getByLabelText("Szerződés címe *"), {
      target: { value: "Éves karbantartás" },
    });
    fireEvent.change(screen.getByLabelText("Érvényesség kezdete *"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Tétel leírása"), {
      target: { value: "Vízcsere" },
    });
    fireEvent.change(screen.getByLabelText("Nettó egységár"), {
      target: { value: "10000" },
    });
    fireEvent.change(screen.getByLabelText("Darabszám"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Alkalom / év"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("ÁFA %"), {
      target: { value: "27" },
    });
    fireEvent.change(screen.getByLabelText("Helyszín"), {
      target: { value: "department-1" },
    });

    fireEvent.click(screen.getByText("Szerződés mentése"));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        "dev-token",
        expect.objectContaining({
          items: [
            expect.objectContaining({
              description: "Vízcsere",
              departmentId: "department-1",
              assetIds: [],
            }),
          ],
        }),
      ),
    );
  });
});

/**
 * BALÁZS ÉLES HIBÁJA, 2026-09-24 20:31 (acrobot kártyája 31f8c5b4): egy
 * duplikált szerződésszámmal próbált menteni, és csak egy általános "A
 * kérés feldolgozása nem sikerült" jelent meg. Ugyanaz a kalibráció, mint
 * a `contract-detail-page.component.test.tsx`-en, itt a LÉTREHOZÁS
 * oldalára.
 */
describe("PilotContractsPage -- új szerződés, duplikált szerződésszám (409)", () => {
  beforeEach(() => {
    auth.session = session();
    api.list.mockReset().mockResolvedValue([]);
    api.customers
      .mockReset()
      .mockResolvedValue([
        { id: "customer-1", displayName: "Fővárosi Állatkert" },
      ]);
    api.create.mockReset();
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  function fillMinimalForm() {
    fireEvent.click(screen.getByText("Új szerződés"));
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "customer-1" },
    });
    fireEvent.change(screen.getByLabelText("Szerződésszám *"), {
      target: { value: "SZ2026/0000019" },
    });
    fireEvent.change(screen.getByLabelText("Szerződés címe *"), {
      target: { value: "Éves karbantartás" },
    });
    fireEvent.change(screen.getByLabelText("Érvényesség kezdete *"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Tétel leírása"), {
      target: { value: "Vízcsere" },
    });
    fireEvent.change(screen.getByLabelText("Nettó egységár"), {
      target: { value: "10000" },
    });
    fireEvent.change(screen.getByLabelText("Darabszám"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Alkalom / év"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("ÁFA %"), {
      target: { value: "27" },
    });
  }

  it("a szerződésszám mező alatt mutatja a 409 üzenetét, nem egy általános dobozban", async () => {
    api.create.mockRejectedValue(
      new ApiError("Ez a szerződésszám már létezik (SZ2026/0000019).", 409),
    );

    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    fillMinimalForm();

    fireEvent.click(screen.getByText("Szerződés mentése"));

    await screen.findByText("Ez a szerződésszám már létezik (SZ2026/0000019).");
    expect(screen.queryByText("Műveleti hiba")).toBeNull();
  });
});

/*
  A FELVETT TÉTEL TÖRÖLHETŐ (kártya c014db6f, Ág Luca bejelentése,
  2026-10-05: "a felvett tételt nem lehet törölni, csak hozzáadni"). MI
  PIROSÍT: ha nincs soronkénti törlés; ha a törlés rossz sort visz el; ha a
  felületi sorkulcs a szerverre is elmegy; ha az utolsó sor is törölhető.
*/
describe("PilotContractsPage -- új szerződés, tétel törlése", () => {
  beforeEach(() => {
    auth.session = session();
    api.list.mockReset().mockResolvedValue([]);
    api.customers
      .mockReset()
      .mockResolvedValue([
        { id: "customer-1", displayName: "Fővárosi Állatkert" },
      ]);
    api.create.mockReset().mockResolvedValue({ id: "contract-1" });
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  it("a középső sor törlése után a másik kettő megy a mentéskor, sorkulcs nélkül", async () => {
    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    fireEvent.click(screen.getByText("Új szerződés"));
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "customer-1" },
    });
    fireEvent.change(screen.getByLabelText("Szerződésszám *"), {
      target: { value: "SZ2026/0000020" },
    });
    fireEvent.change(screen.getByLabelText("Szerződés címe *"), {
      target: { value: "Éves karbantartás" },
    });
    fireEvent.change(screen.getByLabelText("Érvényesség kezdete *"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByText("Tétel hozzáadása"));
    fireEvent.click(screen.getByText("Tétel hozzáadása"));
    const leirasok = screen.getAllByLabelText("Tétel leírása");
    const arak = screen.getAllByLabelText("Nettó egységár");
    ["Első", "Második", "Harmadik"].forEach((szoveg, i) => {
      fireEvent.change(leirasok[i]!, { target: { value: szoveg } });
      fireEvent.change(arak[i]!, { target: { value: String((i + 1) * 1000) } });
    });

    fireEvent.click(screen.getByRole("button", { name: "2. tétel törlése" }));
    expect(screen.getAllByLabelText("Tétel leírása")).toHaveLength(2);
    fireEvent.click(screen.getByText("Szerződés mentése"));

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const items = api.create.mock.calls[0]![1].items as Record<
      string,
      unknown
    >[];
    expect(items.map((item) => item.description)).toEqual(["Első", "Harmadik"]);
    expect(items.some((item) => "rowKey" in item)).toBe(false);
  });

  it("egyetlen sornál nincs törlés", async () => {
    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    fireEvent.click(screen.getByText("Új szerződés"));
    expect(screen.queryByRole("button", { name: /tétel törlése/ })).toBeNull();
  });
});

/*
  A JAVÍTÁSI DÍJAK AZ ÚJ SZERZŐDÉS ŰRLAPJÁN (kártya 3d80a18d). MI PIROSÍT:
  ha a díj nem megy el, vagy nem a szerver számalakjában; ha egy nem szám díjjal
  menteni lehet.
*/
describe("PilotContractsPage -- javítási díjak", () => {
  beforeEach(() => {
    auth.session = session();
    api.list.mockReset().mockResolvedValue([]);
    api.customers
      .mockReset()
      .mockResolvedValue([
        { id: "customer-1", displayName: "Fővárosi Állatkert" },
      ]);
    api.create.mockReset().mockResolvedValue({ id: "contract-1" });
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  async function fillContract() {
    render(<PilotContractsPage />);
    await screen.findByText("Új szerződés");
    fireEvent.click(screen.getByText("Új szerződés"));
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "customer-1" },
    });
    fireEvent.change(screen.getByLabelText("Szerződésszám *"), {
      target: { value: "SZ2026/0000030" },
    });
    fireEvent.change(screen.getByLabelText("Szerződés címe *"), {
      target: { value: "Javítási díjak" },
    });
    fireEvent.change(screen.getByLabelText("Érvényesség kezdete *"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Tétel leírása"), {
      target: { value: "Óradíj - technikus" },
    });
    fireEvent.change(screen.getByLabelText("Nettó egységár"), {
      target: { value: "0" },
    });
  }

  it("a kitöltött díjak a szerver számalakjában mennek, az üresek nullként", async () => {
    await fillContract();
    fireEvent.change(
      screen.getByLabelText("1. tétel Munkanapon, munkaidőben (Ft)"),
      { target: { value: "9 000" } },
    );
    fireEvent.change(screen.getByLabelText("1. tétel Súlyszám"), {
      target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("1. tétel Összesen (Ft)"), {
      target: { value: "10 125 000" },
    });
    fireEvent.click(screen.getByText("Szerződés mentése"));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1].items[0]).toMatchObject({
      repairFeeWorkdayHours: "9000",
      repairFeeWorkdayOffHours: null,
      repairFeeHoliday: null,
      repairWeight: "90",
      repairTotal: "10125000",
    });
  });

  it("nem szám díjjal nem menthető", async () => {
    await fillContract();
    fireEvent.change(screen.getByLabelText("1. tétel Súlyszám"), {
      target: { value: "sok" },
    });
    expect(
      screen.getByText(/a javítási díjak csak számok lehetnek/),
    ).toBeTruthy();
    expect(
      screen
        .getByText("Szerződés mentése")
        .closest("button")!
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
