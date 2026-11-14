import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotContractDetailPage } from "./pilot-contract-detail-page";
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

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  update: vi.fn(),
  quantityUnits: vi.fn(),
}));
const orderApi = vi.hoisted(() => ({
  list: vi.fn(),
  issue: vi.fn(),
  createContractJob: vi.fn(),
  uploadCustomerForm: vi.fn(),
}));
const worksheetsApi = vi.hoisted(() => ({ departments: vi.fn() }));
const assetsApi = vi.hoisted(() => ({ list: vi.fn(), scanLabel: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
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
    kind: "MAINTENANCE",
    _count: { maintenanceOrders: 0 },
    notes: null,
    organizationalUnitName: null,
    contactPersonName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    documents: [],
    items: [],
  };
}

/*
  A MEGRENDELŐLAP DARAB- ÉS ALKALOMSZÁMA (Luca, 2026-11-13: „pontosan hány db és hány alkalom számot szeretnék
  áthúzni a megrendelőbe"). MI PIROSÍT: ha a kijelölt tételnél nincs darab- és alkalom mező; ha a kiállítás nem a
  beírt értékeket küldi; ha a beírás nélküli kiállítás eltér az eddigitől (a szerződés darabszáma, egy alkalom); ha
  érvénytelen érték mellett a kiállítás gombja él; ha egy kiállítás után a következő a régi beírással indul.
*/
describe("PilotContractDetailPage -- a megrendelőlap darab- és alkalomszáma", () => {
  const withItem = (): ContractSummary => ({
    ...contract(),
    items: [
      {
        id: "item-1",
        position: 1,
        description: "Cápasuli nagymedence karbantartás",
        unitNet: "410000",
        quantity: "2.000000",
        occasionsPerYear: 12,
        vatRatePercent: "27",
        unitOfMeasureId: null,
        unitOfMeasure: null,
        departmentId: "department-1",
        assets: [],
        repairFeeWorkdayHours: null,
        repairFeeWorkdayOffHours: null,
        repairFeeHoliday: null,
        repairWeight: null,
        repairTotal: null,
      },
    ],
  });

  beforeEach(() => {
    auth.session = session("dev-token");
    api.detail.mockReset().mockResolvedValue(withItem());
    api.update.mockReset();
    orderApi.list.mockReset().mockResolvedValue([]);
    orderApi.issue.mockReset().mockResolvedValue({});
    worksheetsApi.departments.mockReset().mockResolvedValue({ items: [] });
    assetsApi.list.mockReset().mockResolvedValue({ items: [] });
  });

  const fields = async () => ({
    quantity: (await screen.findByLabelText(
      "1. tétel darabszáma a megrendelőlapon",
    )) as HTMLInputElement,
    occasions: (await screen.findByLabelText(
      "1. tétel alkalma a megrendelőlapon",
    )) as HTMLInputElement,
  });

  it("a kijelölt tételnél két mező áll, az alap a szerződés darabszáma (záró nullák nélkül) és egy alkalom", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    const { quantity, occasions } = await fields();
    expect(quantity.value).toBe("2");
    expect(occasions.value).toBe("1");
  });

  it("a beírt darab- és alkalomszámot küldi a kiállítás", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    const { quantity, occasions } = await fields();
    fireEvent.change(quantity, { target: { value: "3,5" } });
    fireEvent.change(occasions, { target: { value: "4" } });
    fireEvent.click(screen.getByText(/Megrendelőlap kiállítása \(1 tétel\)/));
    await waitFor(() => expect(orderApi.issue).toHaveBeenCalledTimes(1));
    expect(orderApi.issue.mock.calls[0]![1]).toEqual({
      contractId: "contract-1",
      itemIds: ["item-1"],
      lines: [{ itemId: "item-1", quantity: "3.5", occasions: 4 }],
    });
  });

  it("beírás nélkül az eddigit küldi: a szerződés darabszámát és egy alkalmat", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    await fields();
    fireEvent.click(screen.getByText(/Megrendelőlap kiállítása \(1 tétel\)/));
    await waitFor(() => expect(orderApi.issue).toHaveBeenCalledTimes(1));
    expect(orderApi.issue.mock.calls[0]![1].lines).toEqual([
      { itemId: "item-1", quantity: "2", occasions: 1 },
    ]);
  });

  it("érvénytelen érték mellett a gomb tiltva van, és a hiba megnevezi a tételt és az okot", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    const { quantity, occasions } = await fields();
    const button = () =>
      screen
        .getByText(/Megrendelőlap kiállítása/)
        .closest("button") as HTMLButtonElement;

    fireEvent.change(occasions, { target: { value: "13" } });
    expect(button().disabled).toBe(true);
    expect(
      screen.getByText(/1\. tétel: az alkalom legfeljebb 12 lehet/),
    ).toBeTruthy();

    fireEvent.change(occasions, { target: { value: "0" } });
    expect(button().disabled).toBe(true);
    fireEvent.change(occasions, { target: { value: "2" } });
    expect(button().disabled).toBe(false);

    fireEvent.change(quantity, { target: { value: "0" } });
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/a darabszám pozitív szám legyen/)).toBeTruthy();
    fireEvent.change(quantity, { target: { value: "abc" } });
    expect(button().disabled).toBe(true);
  });

  it("a kiállítás után a következő megint az alapról indul", async () => {
    render(<PilotContractDetailPage contractId="contract-1" />);
    const { quantity, occasions } = await fields();
    fireEvent.change(quantity, { target: { value: "5" } });
    fireEvent.change(occasions, { target: { value: "3" } });
    fireEvent.click(screen.getByText(/Megrendelőlap kiállítása/));
    await waitFor(() => expect(orderApi.issue).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "1. tétel alkalma a megrendelőlapon",
          ) as HTMLInputElement
        ).value,
      ).toBe("1"),
    );
    expect(
      (
        screen.getByLabelText(
          "1. tétel darabszáma a megrendelőlapon",
        ) as HTMLInputElement
      ).value,
    ).toBe("2");
  });
});
