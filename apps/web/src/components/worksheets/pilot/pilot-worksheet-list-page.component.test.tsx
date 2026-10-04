import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Session,
  WorksheetListItem,
  WorksheetListResponse,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotWorksheetListPage,
  worksheetHoursCell,
} from "./pilot-worksheet-list-page";

/**
 * THE WORKSHEET LIST OF THE SERVICE REDESIGN (Figma 423:448, Balázs,
 * 2026-10-04). The Pilot list had no render test; this one measures the
 * columns the redesign adds or keeps: Felelős, Munkaóra and Hibajegy (API
 * E4), the tiles as filters, and the "mine" and hidden controls.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => "/szerviz/munkalapok",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  selectablePartners: vi.fn(),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "teszt@example.invalid",
      displayName: "Teszt Kolléga",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

function row(overrides: Partial<WorksheetListItem> = {}): WorksheetListItem {
  return {
    id: "ws-1",
    number: "ML-2026-00814",
    label: "ML-2026-00814/1",
    customerName: "Kitalált Partner Kft.",
    departmentCode: "KIT",
    departmentPath: ["Gépház", "Fő keringetés"],
    subject: "Tömítéscsere és ellenőrzés",
    status: "DRAFT",
    lineCount: 3,
    version: 1,
    versionCount: 1,
    grossAmount: "0",
    assigneeNames: ["Ádám", "Péter"],
    laborHours: "2.5",
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-0142" },
    updatedAt: "2026-10-04T08:00:00.000Z",
    hidden: false,
    ...overrides,
  };
}

function response(items: WorksheetListItem[]): WorksheetListResponse {
  return {
    items,
    pagination: { page: 1, pageSize: 25, totalItems: 9, totalPages: 1 },
    counts: { DRAFT: 7, AWAITING_SIGNATURE: 2, SIGNED: 31, REJECTED: 1 },
  };
}

beforeEach(() => {
  auth.session = sessionAs("ADMIN");
  navigation.search = "";
  navigation.replace.mockReset();
  navigation.push.mockReset();
  api.list.mockReset();
  api.selectablePartners.mockReset().mockResolvedValue({ items: [] });
});

describe("worksheetHoursCell", () => {
  it("writes the hours in Hungarian form, and a dash without lines", () => {
    expect(worksheetHoursCell({ lineCount: 3, laborHours: "2.5" })).toBe(
      "2,5 óra",
    );
    expect(worksheetHoursCell({ lineCount: 0, laborHours: "0" })).toBe("—");
  });
});

describe("PilotWorksheetListPage -- redesign", () => {
  it("shows the assignees by name, or says nobody is assigned", async () => {
    api.list.mockResolvedValue(
      response([row(), row({ id: "ws-2", assigneeNames: [] })]),
    );
    render(<PilotWorksheetListPage />);
    expect(await screen.findByText("Ádám, Péter")).toBeTruthy();
    expect(screen.getByText("Nincs kiosztva")).toBeTruthy();
  });

  it("shows the hours and links the service job without opening the row", async () => {
    api.list.mockResolvedValue(
      response([
        row(),
        row({
          id: "ws-2",
          number: null,
          lineCount: 0,
          laborHours: "0",
          serviceJob: null,
        }),
      ]),
    );
    render(<PilotWorksheetListPage />);
    expect(await screen.findByText("2,5 óra")).toBeTruthy();
    expect(screen.getByText("Még nincs száma")).toBeTruthy();
    const link = screen.getByRole("link", { name: "HJ-2026-0142" });
    expect(link.getAttribute("href")).toBe("/szerviz/hibajegyek/job-1");
    fireEvent.click(link);
    expect(navigation.push).not.toHaveBeenCalledWith(
      "/szerviz/munkalapok/ws-1",
    );
  });

  it("filters by a tile's status", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    const tiles = await screen.findByLabelText("Munkalapok állapot szerint");
    await waitFor(() => expect(tiles.textContent).toContain("31"));
    fireEvent.click(screen.getByRole("button", { name: /Elkészült/ }));
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining("status=AWAITING_SIGNATURE"),
    );
  });

  it("keeps the 'only mine' filter on the assignee", async () => {
    api.list.mockResolvedValue(response([row()]));
    render(<PilotWorksheetListPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Csak amit rám osztottak" }),
    );
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining("assigneeId=user-1"),
    );
  });

  it("offers the hidden rows only with the hide permission", async () => {
    api.list.mockResolvedValue(response([row()]));
    const { unmount } = render(<PilotWorksheetListPage />);
    expect(
      await screen.findByRole("button", { name: "Rejtettek is" }),
    ).toBeTruthy();
    unmount();
    auth.session = sessionAs("SERVICE");
    render(<PilotWorksheetListPage />);
    await screen.findByText("Ádám, Péter");
    expect(screen.queryByRole("button", { name: "Rejtettek is" })).toBeNull();
  });

  it("shows a long partner in full, not cut off", async () => {
    const longName =
      "Kitalált Állatkert Nonprofit Zártkörűen Működő Részvénytársaság";
    api.list.mockResolvedValue(response([row({ customerName: longName })]));
    render(<PilotWorksheetListPage />);
    const name = await screen.findByText(longName);
    expect(name.className).not.toContain("truncate");
  });
});
