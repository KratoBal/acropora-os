import { render, screen, waitFor } from "@testing-library/react";
import type {
  CustomerListResponse,
  CustomerSummary,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetEditorPage } from "./worksheet-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
const worksheets = vi.hoisted(() => ({
  departments: vi.fn(),
  createDepartment: vi.fn(),
  create: vi.fn(),
  updateDraft: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
  },
};

function customer(index: number, displayName: string): CustomerSummary {
  return {
    id: `customer-${index}`,
    customerNumber: `V-${String(index).padStart(4, "0")}`,
    partnerCode: `V-${String(index).padStart(4, "0")}`,
    source: "MANUAL",
    type: "COMPANY",
    displayName,
    isActive: true,
    address: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A full page of 100, the most the endpoint hands out at once. */
function fullPage(page: number, totalPages: number): CustomerListResponse {
  return {
    items: Array.from({ length: 100 }, (_, index) =>
      customer(page * 100 + index, `Alfa Kft. ${page * 100 + index}`),
    ),
    pagination: {
      page,
      pageSize: 100,
      totalItems: totalPages * 100,
      totalPages,
    },
  };
}

describe("WorksheetEditorPage partner picker", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
  });

  /** The reported defect: the picker asked for a single page of 100 and the
   * dropdown ended mid-alphabet. Nothing failed, so the missing customers
   * looked like customers that do not exist. */
  it("offers a customer that falls past the first page instead of ending mid-alphabet", async () => {
    customers.list.mockResolvedValueOnce(fullPage(1, 2)).mockResolvedValueOnce({
      items: [customer(999, "Zebra Kft.")],
      pagination: { page: 2, pageSize: 100, totalItems: 101, totalPages: 2 },
    });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", { name: "Zebra Kft." }),
    ).toBeTruthy();
    expect(customers.list).toHaveBeenCalledTimes(2);
    const requested = customers.list.mock.calls.map((call) =>
      String((call[1] as URLSearchParams).get("page")),
    );
    expect(requested).toEqual(["1", "2"]);
  });

  /** Truncation is what made the defect invisible, so if the safety stop is
   * ever reached the picker has to say it out loud. */
  it("says the list was cut short instead of silently dropping the tail", async () => {
    customers.list.mockImplementation((_token, query: URLSearchParams) =>
      Promise.resolve(fullPage(Number(query.get("page")), 50)),
    );

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByText(/csak az első 2000 vevő választható/),
    ).toBeTruthy();
    await waitFor(() => expect(customers.list).toHaveBeenCalledTimes(20));
  });
});
