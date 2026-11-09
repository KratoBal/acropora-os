import { render, screen, within } from "@testing-library/react";
import type { PartnerMigrationPlan, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_LABEL, PartnerMigrationPage } from "./partner-migration-page";

const api = vi.hoisted(() => ({ plan: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/partner-migration", () => ({ partnerMigrationApi: api }));
vi.mock("@/lib/api/partner-merge", () => ({
  partnerMergeApi: { list: vi.fn().mockResolvedValue([]) },
}));

const session: Session = {
  id: "s1",
  token: "t1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u1",
    email: "b@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const customer = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  customerNumber: `VEVO-${id}`,
  displayName: `Vevő ${id}`,
  taxNumber: "11111111-2-42",
  euTaxNumber: null,
  fromUnas: false,
  references: 0,
  ...over,
});

const plan = (): PartnerMigrationPlan => ({
  generatedAt: "2026-11-04T20:00:00.000Z",
  total: 3,
  byAction: { MERGE_CANDIDATES: 1, CREATE_NEW: 1, SKIP_OWN: 1 },
  rows: [
    {
      supplierId: "s-zoo",
      code: "FANK",
      name: "Fővárosi Állat- és Növénykert",
      taxNumber: "11111111-2-42",
      country: "HU",
      isActive: true,
      roles: ["SERVICE"],
      worksheetPartnerCode: "FANK",
      linkedCustomer: customer("m", { references: 12 }),
      candidates: [customer("u1", { fromUnas: true, references: 9 })],
      nameCandidates: [],
      action: "MERGE_CANDIDATES",
      notes: [],
    },
    {
      supplierId: "s-new",
      code: "NEW",
      name: "Új Beszállító Kft.",
      taxNumber: null,
      country: "HU",
      isActive: false,
      roles: ["SUPPLIER"],
      worksheetPartnerCode: null,
      linkedCustomer: null,
      candidates: [],
      nameCandidates: [customer("n1", { taxNumber: null })],
      action: "CREATE_NEW",
      notes: ["Nincs adószám: nincs adószám szerinti párosítás."],
    },
    {
      supplierId: "s-own",
      code: "ACR",
      name: "Acropora Kft.",
      taxNumber: "22222222-2-42",
      country: "HU",
      isActive: true,
      roles: ["SUPPLIER"],
      worksheetPartnerCode: null,
      linkedCustomer: null,
      candidates: [],
      nameCandidates: [],
      action: "SKIP_OWN",
      notes: [],
    },
  ],
});

describe("PartnerMigrationPage", () => {
  beforeEach(() => {
    auth.session = session;
    api.plan.mockReset().mockResolvedValue(plan());
  });

  it("lists every partner with its action, roles and the customer rows it concerns", async () => {
    render(<PartnerMigrationPage />);
    const rows = await screen.findAllByTestId("migration-row");
    expect(rows).toHaveLength(3);
    const zoo = within(rows[0]!);
    expect(zoo.getByText(ACTION_LABEL.MERGE_CANDIDATES)).toBeTruthy();
    expect(zoo.getByText("Szerviz-partner")).toBeTruthy();
    expect(zoo.getAllByTestId("migration-customer")).toHaveLength(2);
    expect(zoo.getByText("(már kötött sor)")).toBeTruthy();
    expect(zoo.getByText("(ugyanazon az adószámon)")).toBeTruthy();
    expect(zoo.getByText(/9 hivatkozás/)).toBeTruthy();
  });

  it("says when there is no tax number, shows the name candidates as information only, and marks an inactive partner", async () => {
    render(<PartnerMigrationPage />);
    const rows = await screen.findAllByTestId("migration-row");
    const fresh = within(rows[1]!);
    // a fejlécben és a jegyzetben is áll: két helyen mondja
    expect(fresh.getAllByText(/nincs adószám/).length).toBe(2);
    expect(fresh.getByText(/azonos nevű, csak tájékoztatás/)).toBeTruthy();
    expect(fresh.getByText("inaktív")).toBeTruthy();
    expect(fresh.getByText(ACTION_LABEL.CREATE_NEW)).toBeTruthy();
  });

  it("marks our own company as skipped", async () => {
    render(<PartnerMigrationPage />);
    const rows = await screen.findAllByTestId("migration-row");
    expect(within(rows[2]!).getByText(ACTION_LABEL.SKIP_OWN)).toBeTruthy();
  });

  it("sums up the actions", async () => {
    render(<PartnerMigrationPage />);
    const summary = await screen.findByTestId("migration-summary");
    expect(summary.textContent).toContain("3 partner");
    expect(summary.textContent).toContain(
      `1 × ${ACTION_LABEL.MERGE_CANDIDATES}`,
    );
  });

  it("does not call the endpoint without settings.manage", () => {
    auth.session = { ...session, user: { ...session.user, role: "SALES" } };
    render(<PartnerMigrationPage />);
    expect(
      screen.getByText("Nincs hozzáférésed a partner-átvezetéshez"),
    ).toBeTruthy();
    expect(api.plan).not.toHaveBeenCalled();
  });

  it("shows the load error", async () => {
    api.plan.mockRejectedValue(new Error("Szerverhiba"));
    render(<PartnerMigrationPage />);
    expect(await screen.findByText("Szerverhiba")).toBeTruthy();
  });
});
