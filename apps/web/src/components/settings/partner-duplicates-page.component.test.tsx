import { render, screen, within } from "@testing-library/react";
import type {
  PartnerDuplicateCustomer,
  PartnerDuplicateResponse,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PartnerDuplicatesPage,
  referenceSummary,
} from "./partner-duplicates-page";

const api = vi.hoisted(() => ({ report: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/partner-duplicates", () => ({ partnerDuplicatesApi: api }));

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

const noRefs = {
  invoices: 0,
  salesOrders: 0,
  contracts: 0,
  worksheets: 0,
  quotes: 0,
  serviceJobs: 0,
};

function customer(
  id: string,
  displayName: string,
  extra: Partial<PartnerDuplicateCustomer> = {},
): PartnerDuplicateCustomer {
  return {
    id,
    customerNumber: `VEVO-${id}`,
    displayName,
    companyName: null,
    type: "COMPANY",
    taxNumber: "12345678-2-42",
    euTaxNumber: null,
    partnerMirror: false,
    fromUnas: false,
    references: noRefs,
    ...extra,
  };
}

function report(): PartnerDuplicateResponse {
  return {
    generatedAt: "2026-11-04T10:00:00.000Z",
    summary: "PARTNER-DUPLIKATUM eros_csoport=1",
    strong: [
      {
        kind: "HU",
        key: "12345678",
        customers: [
          customer("a", "Példa Kft.", {
            references: { ...noRefs, invoices: 3, worksheets: 1 },
          }),
          customer("b", "Példa Korlátolt Felelősségű Társaság", {
            fromUnas: true,
          }),
        ],
      },
    ],
    weakGroupTax: [
      {
        kind: "HU4",
        key: "45678901",
        customers: [
          customer("c", "Csoport Egy"),
          customer("d", "Csoport Kettő"),
        ],
      },
    ],
    unlinked: [
      {
        kind: "EU",
        key: "DE123456789",
        supplier: {
          id: "s1",
          code: "BESZ-1",
          name: "Német Beszállító GmbH",
          taxNumber: null,
          country: "DE",
          customerId: null,
        },
        customer: customer("e", "Német Beszállító", { partnerMirror: true }),
      },
    ],
    unas: { total: 40, withoutTaxNumber: 7 },
  };
}

describe("PartnerDuplicatesPage", () => {
  beforeEach(() => {
    auth.session = session;
    api.report.mockReset().mockResolvedValue(report());
  });

  it("lists the strong groups with reference counts and mirror flags", async () => {
    render(<PartnerDuplicatesPage />);
    const groups = await screen.findAllByTestId("duplicate-group");
    // strong group first, weak group tax last: the two sections are separate lists
    expect(within(groups[0]!).getByText("12345678")).toBeTruthy();
    expect(within(groups[0]!).getByText("Példa Kft.")).toBeTruthy();
    expect(within(groups[0]!).getByText("3 számla, 1 munkalap")).toBeTruthy();
    expect(within(groups[0]!).getByText("UNAS")).toBeTruthy();
    expect(
      within(groups[0]!).getAllByTestId("duplicate-customer"),
    ).toHaveLength(2);
  });

  it("keeps the 4-prefixed group tax keys in their own section", async () => {
    render(<PartnerDuplicatesPage />);
    await screen.findAllByTestId("duplicate-group");
    const weak = screen.getByRole("region", {
      name: "Csoportos adóalanyiság lehet",
    });
    expect(within(weak).getByText("45678901")).toBeTruthy();
    const strong = screen.getByRole("region", { name: "Egyező vevők" });
    expect(within(strong).queryByText("45678901")).toBeNull();
  });

  it("shows an unlinked supplier and customer pair", async () => {
    render(<PartnerDuplicatesPage />);
    const pair = await screen.findByTestId("duplicate-pair");
    expect(within(pair).getByText("Német Beszállító GmbH")).toBeTruthy();
    expect(within(pair).getByText("partner vevő-tükre")).toBeTruthy();
  });

  it("shows the UNAS totals in the summary", async () => {
    render(<PartnerDuplicatesPage />);
    const summary = await screen.findByTestId("duplicate-summary");
    expect(summary.textContent).toContain("vevő: 40");
    expect(summary.textContent).toContain("adószám nélkül: 7");
  });

  it("says so when a list is empty", async () => {
    api.report.mockResolvedValue({ ...report(), strong: [], unlinked: [] });
    render(<PartnerDuplicatesPage />);
    const strong = await screen.findByRole("region", { name: "Egyező vevők" });
    expect(within(strong).getByText("Nincs találat")).toBeTruthy();
  });

  it("does not call the endpoint without settings.manage", () => {
    auth.session = {
      ...session,
      user: { ...session.user, role: "SALES" },
    };
    render(<PartnerDuplicatesPage />);
    expect(
      screen.getByText("Nincs hozzáférésed a partner-duplikátumokhoz"),
    ).toBeTruthy();
    expect(api.report).not.toHaveBeenCalled();
  });

  it("shows the load error", async () => {
    api.report.mockRejectedValue(new Error("Szerverhiba"));
    render(<PartnerDuplicatesPage />);
    expect(await screen.findByText("Szerverhiba")).toBeTruthy();
  });

  it("summarises references and names the empty case", () => {
    expect(referenceSummary(noRefs)).toBe("nincs hivatkozás");
    expect(referenceSummary({ ...noRefs, quotes: 2 })).toBe("2 árajánlat");
  });
});
