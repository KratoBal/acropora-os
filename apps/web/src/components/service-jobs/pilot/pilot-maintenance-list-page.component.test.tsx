import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ServiceJobListItem,
  ServiceJobListResponse,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { urlNavigation } from "@/test/url-navigation";

import {
  MAINTENANCE_PAGE_SIZE,
  PilotMaintenanceListPage,
  maintenanceTabCounts,
} from "./pilot-maintenance-list-page";

/*
  A KARBANTARTÁS-LISTA A HIBAJEGY-LISTA MINTÁJÁRA (picasso képernyő-leltár 3.9, acrobot 62090): fülek a szerver számlálójával, 25-ös
  lapozás a szerveren, a fül, a keresés és az oldal az URL-ben.
  MI PIROSÍT: ha a fül száma nem a szerver `maintenanceCounts`-ából jön (a fixtúra számai nagyobbak a betöltött sornál); ha a lista nem
  lapozva kér, vagy nem a jelvény szerinti fület kéri; ha a fül- vagy keresésváltás nem az első oldalra visz; ha a sor nem a
  karbantartási lapot nyitja; ha az állapot nem a jelvény szavával szól.
*/

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "admin@acropora.local",
    displayName: "Admin",
    nickname: null,
    role: "ADMIN",
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

function sheet(
  id: string,
  overrides: Partial<ServiceJobListItem> = {},
): ServiceJobListItem {
  return {
    id,
    jobNumber: `KT-${id}`,
    title: `Karbantartás ${id}`,
    kind: "MAINTENANCE",
    status: "IN_PROGRESS",
    commonStatus: "IN_PROGRESS",
    commonReason: null,
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName: "Fővárosi Állatkert",
    departmentPath: ["Biodóm", "Fókamedence"],
    departmentCode: "FOK",
    assignees: [],
    worksheetCount: 2,
    createdAt: "2026-11-20T10:00:00.000Z",
    hidden: false,
    maintenanceDone: false,
    ...overrides,
  };
}

// the counts are larger than the loaded rows on purpose: a count from the page would say 3, the server's says 30 / 12 / 42
function response(
  page: number,
  overrides: Partial<ServiceJobListResponse> = {},
): ServiceJobListResponse {
  return {
    items: [sheet("1"), sheet("2"), sheet("3")],
    counts: {
      NEW: 0,
      TRIAGED: 0,
      SCHEDULED: 0,
      IN_PROGRESS: 42,
      WAITING_FOR_PARTS: 0,
      WAITING_FOR_CUSTOMER: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    },
    maintenanceCounts: { progress: 30, done: 12 },
    truncated: false,
    pagination: { page, pageSize: 25, totalItems: 30, totalPages: 2 },
    ...overrides,
  };
}

const extra = (page: number) => ({ page, pageSize: MAINTENANCE_PAGE_SIZE });

beforeEach(() => {
  api.list.mockReset();
  api.list.mockImplementation(async (...args: unknown[]) =>
    response((args[8] as { page: number } | undefined)?.page ?? 1),
  );
});

describe("a karbantartás-lista a Pilot lista-mintán", () => {
  it("az alap fül a Folyamatban, az első oldal 25-ösével, a szerver szűr a jelvényre", async () => {
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "",
      false,
      "MAINTENANCE",
      "progress",
      undefined,
      extra(1),
    );
    expect(
      screen.getByText("1–3 / 30 folyamatban lévő karbantartási lap"),
    ).toBeTruthy();
  });

  it("a fülek száma a szerver számlálójából jön, nem a betöltött sorokból", async () => {
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Folyamatban30",
      "Lezárt12",
      "Összes42",
    ]);
  });

  it("régi válasznál (számláló nélkül) a fülön nincs szám", async () => {
    api.list.mockResolvedValue(response(1, { maintenanceCounts: undefined }));
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Folyamatban",
      "Lezárt",
      "Összes",
    ]);
    expect(maintenanceTabCounts(undefined)).toBeNull();
  });

  it("az URL oldalát kéri, és a lapozó csak az oldalszámot írja át", async () => {
    urlNavigation.reset("/szerviz/karbantartas", "tab=all&page=2");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "",
      false,
      "MAINTENANCE",
      undefined,
      undefined,
      extra(2),
    );
    expect(screen.getByText("26–28 / 30 karbantartási lap")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Előző" }));
    await waitFor(() => expect(urlNavigation.search).toBe("tab=all"));
  });

  it("a fülváltás és a keresés az első oldalra visz", async () => {
    urlNavigation.reset("/szerviz/karbantartas", "page=2");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    fireEvent.click(screen.getByRole("tab", { name: /^Lezárt/ }));
    await waitFor(() => expect(urlNavigation.search).toBe("tab=done"));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        "token-1",
        "all",
        expect.anything(),
        "",
        false,
        "MAINTENANCE",
        "done",
        undefined,
        extra(1),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));
    await waitFor(() => expect(urlNavigation.search).toBe("tab=done&page=2"));
    fireEvent.change(screen.getByLabelText("Karbantartás keresése"), {
      target: { value: "szűrő" },
    });
    await waitFor(() =>
      expect(urlNavigation.search).toBe(
        `tab=done&${new URLSearchParams({ q: "szűrő" })}`,
      ),
    );
  });

  it("az URL-ből jövő keresés nem dobja el az URL oldalát betöltéskor", async () => {
    urlNavigation.reset("/szerviz/karbantartas", "q=pumpa&page=2");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(urlNavigation.replace).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Karbantartás keresése") as HTMLInputElement)
        .value,
    ).toBe("pumpa");
  });

  it("a sor a karbantartási lapot nyitja, soha a hibajegyet", async () => {
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    const rows = await screen.findAllByTestId("maintenance-job-row");
    // a click on a plain cell (the partner column)
    fireEvent.click(rows[1]!.querySelectorAll("td")[1]!);
    expect(urlNavigation.push).toHaveBeenCalledTimes(1);
    expect(urlNavigation.push).toHaveBeenCalledWith("/szerviz/karbantartas/2");
    expect(rows[1]!.getAttribute("aria-label")).toBe(
      "KT-2 Karbantartás 2 megnyitása",
    );
  });

  it("az állapot a jelvény szava; régi válasznál a `maintenanceDone` mondja", async () => {
    api.list.mockResolvedValue(
      response(1, {
        items: [
          sheet("1", { commonStatus: "CLOSED" }),
          sheet("2"),
          sheet("3", {
            commonStatus: undefined,
            commonReason: undefined,
            maintenanceDone: true,
          }),
        ],
      }),
    );
    urlNavigation.reset("/szerviz/karbantartas", "tab=all");
    render(<PilotMaintenanceListPage />);
    const rows = await screen.findAllByTestId("maintenance-job-row");
    const statusOf = (row: HTMLElement) =>
      row.querySelector("td[data-label='Állapot']")?.textContent;
    expect(rows.map(statusOf)).toEqual([
      "Lezártminden munkalap aláírva",
      "Folyamatban",
      "Lezártminden munkalap aláírva",
    ]);
  });
});

/*
  KAPCSOLAT NÉLKÜL A SÁV A LAP ÁLLAPOTÁRÓL BESZÉL (a régi karbantartás-lapról átvéve, 2026-11-26): betöltött lista mellett a frissítésről,
  üres képernyőn arról, hogy ezért nincs adat. Két állítás, mert egy rögzült `loaded` vagy `empty` csak az egyiken pirosodik.
*/
describe("a karbantartás-lista kapcsolat nélkül", () => {
  afterEach(() => setOnLine(true));

  it("betöltött lista mellett a frissítésről beszél", async () => {
    setOnLine(false);
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    await screen.findByText("Karbantartás 1");
    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    setOnLine(false);
    api.list.mockReturnValue(new Promise(() => {}));
    urlNavigation.reset("/szerviz/karbantartas");
    render(<PilotMaintenanceListPage />);
    expect(await savotMond("empty")).toBeTruthy();
  });
});
