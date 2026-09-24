import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContractsPage } from "./contracts-page";
import { ApiError } from "@/lib/api/client";

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
describe("ContractsPage -- új szerződés tételének helyszíne", () => {
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
    render(<ContractsPage />);
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
    render(<ContractsPage />);
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
describe("ContractsPage -- új szerződés, duplikált szerződésszám (409)", () => {
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

    render(<ContractsPage />);
    await screen.findByText("Új szerződés");
    fillMinimalForm();

    fireEvent.click(screen.getByText("Szerződés mentése"));

    await screen.findByText("Ez a szerződésszám már létezik (SZ2026/0000019).");
    expect(screen.queryByText("Műveleti hiba")).toBeNull();
  });
});
