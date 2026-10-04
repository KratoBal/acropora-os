import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotWorksheetDetailPage } from "./pilot-worksheet-detail-page";

/**
 * THE WORKSHEET DETAIL OF THE SERVICE REDESIGN (Figma 423:662, Balázs,
 * 2026-10-04). The Pilot page had no render test; this one measures what the
 * redesign moved or must not lose: no price, the lines with people and
 * hours, the assignees in the sheet data, and "Helyszíni lezárás", whose
 * facts never gate the close (decision E7).
 *
 * The embedded widgets are stubbed: each has its own spec, and this one is
 * about the page around them.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("../worksheet-entries", () => ({
  WorksheetEntries: () => <div data-testid="entries-stub" />,
}));
vi.mock("../worksheet-material-requests", () => ({
  WorksheetMaterialRequests: () => <div data-testid="material-stub" />,
}));
vi.mock("../worksheet-asset-editor", () => ({
  WorksheetAssetEditor: () => <div data-testid="assets-stub" />,
}));
vi.mock("../worksheet-assignee-editor", () => ({
  WorksheetAssigneeEditor: () => <div data-testid="assignees-stub" />,
}));
vi.mock("../worksheet-documents", () => ({
  WorksheetDocuments: () => <div data-testid="documents-stub" />,
}));

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  signers: vi.fn(),
  close: vi.fn(),
  setHandedOver: vi.fn(),
  setHidden: vi.fn(),
  continueFrom: vi.fn(),
  sendForSignature: vi.fn(),
  sign: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: (fallbackHref: string) => ({
    href: fallbackHref,
    fromWithinApp: false,
  }),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "teszt@example.invalid",
      displayName: "Teszt Szerelő",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

function sheet(overrides: Partial<WorksheetDetail> = {}): WorksheetDetail {
  const base: WorksheetDetail = {
    id: "ws-1",
    number: null,
    numberYear: null,
    sequence: null,
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-0001" },
    customer: {
      id: "customer-1",
      customerNumber: "VEVO-000001",
      displayName: "Kitalált Partner Kft.",
      worksheetPartnerCode: "KIT",
    },
    department: {
      id: "department-1",
      parentId: null,
      code: "KIT",
      name: "Gépház",
      isActive: true,
      path: ["Gépház", "Fő keringetés"],
    },
    createdByName: "Teszt Szerelő",
    handedOverAt: null,
    handedOverByName: null,
    assignees: [],
    assets: [],
    createdAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
    continues: null,
    continuedBy: [],
    currentVersion: {
      id: "version-1",
      version: 1,
      label: null,
      status: "DRAFT",
      changeReason: null,
      createdByName: "Teszt Szerelő",
      createdAt: "2026-10-04T08:00:00.000Z",
      closedAt: null,
      closedByName: null,
      sentForSignatureAt: null,
      sentForSignatureToName: null,
      netAmount: "30000",
      vatAmount: "8100",
      grossAmount: "38100",
      signature: null,
      subject: "Tömítéscsere és ellenőrzés",
      unitName: "Fő keringetés",
      description: "Szivárgás feltárása és tömítéscsere.",
      issueDate: "2026-10-04",
      fulfillmentDate: null,
      dueDate: null,
      currency: "HUF",
      laborHours: "3",
      lines: [
        {
          id: "line-1",
          position: 1,
          description: "Hiba feltárása",
          detail: null,
          assetId: null,
          assetNumber: null,
          partnerInternalCode: null,
          quantity: "1.5",
          unit: "óra",
          kind: "LABOR",
          workerCount: 2,
          laborHours: "3",
          unitNet: "10000",
          vatRatePercent: "27",
          netAmount: "30000",
          vatAmount: "8100",
          grossAmount: "38100",
        },
      ],
    },
    versions: [],
    hidden: false,
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  auth.session = sessionAs("SERVICE");
  for (const fn of Object.values(api)) fn.mockReset();
  api.signers.mockResolvedValue({ items: [], emptyReason: null });
});

describe("PilotWorksheetDetailPage -- redesign", () => {
  it("shows no price anywhere on the sheet", async () => {
    api.detail.mockResolvedValue(sheet());
    const { container } = render(
      <PilotWorksheetDetailPage worksheetId="ws-1" />,
    );
    await screen.findByText("Hiba feltárása");
    expect(container.textContent).not.toMatch(
      /30\s?000|38\s?100|10\s?000|HUF|\bFt\b|nettó|bruttó|ÁFA/i,
    );
  });

  it("shows each line with quantity, people and hours, and the total", async () => {
    api.detail.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    expect(await screen.findByText("1,5 óra")).toBeTruthy();
    expect(screen.getByText("2 fő")).toBeTruthy();
    expect(screen.getByText("3 munkaóra")).toBeTruthy();
    expect(screen.getAllByText("3 óra").length).toBeGreaterThan(0);
  });

  it("names the assignees in the sheet data, or says nobody is assigned", async () => {
    api.detail.mockResolvedValue(
      sheet({
        assignees: [
          { userId: "u-1", name: "Ádám", assignedAt: "2026-10-04T08:00:00Z" },
          { userId: "u-2", name: "Péter", assignedAt: "2026-10-04T08:00:00Z" },
        ],
      }),
    );
    const { unmount } = render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    expect(await screen.findByText("Ádám, Péter")).toBeTruthy();
    unmount();
    api.detail.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    expect(await screen.findByText("Nincs kiosztva")).toBeTruthy();
  });

  it("lets a draft be closed although the hand-over is not recorded", async () => {
    api.detail.mockResolvedValue(sheet());
    api.close.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    const panel = await screen.findByRole("region", {
      name: "Helyszíni lezárás",
    });
    expect(panel.textContent).toContain("Átadás: még nincs rögzítve");
    const close = screen.getByRole("button", { name: "Kiállítás és lezárás" });
    expect((close as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(close);
    await waitFor(() =>
      expect(api.close).toHaveBeenCalledWith("token-1", "ws-1"),
    );
  });

  it("records the hand-over from the closing panel", async () => {
    api.detail.mockResolvedValue(sheet());
    api.setHandedOver.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Átadás rögzítése" }),
    );
    await waitFor(() =>
      expect(api.setHandedOver).toHaveBeenCalledWith("token-1", "ws-1", true),
    );
  });

  it("offers no close on a sheet that is already issued", async () => {
    api.detail.mockResolvedValue(
      sheet({
        number: "ML-2026-00001",
        currentVersion: {
          ...sheet().currentVersion,
          label: "ML-2026-00001/1",
          status: "SIGNED",
        },
      }),
    );
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    const panel = await screen.findByRole("region", {
      name: "Helyszíni lezárás",
    });
    expect(panel.textContent).toContain("Kiállítani csak piszkozatot lehet");
    expect(
      screen.queryByRole("button", { name: "Kiállítás és lezárás" }),
    ).toBeNull();
  });

  it("shows no closing panel to a reader without the manage permission", async () => {
    auth.session = sessionAs("VIEWER");
    api.detail.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    expect(await screen.findByText("Hiba feltárása")).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Helyszíni lezárás" }),
    ).toBeNull();
    expect(screen.queryByText("Tételek szerkesztése")).toBeNull();
  });

  it("links the service job from the sheet data", async () => {
    api.detail.mockResolvedValue(sheet());
    render(<PilotWorksheetDetailPage worksheetId="ws-1" />);
    const link = await screen.findByRole("link", { name: "HJ-2026-0001" });
    expect(link.getAttribute("href")).toBe("/szerviz/hibajegyek/job-1");
  });
});
