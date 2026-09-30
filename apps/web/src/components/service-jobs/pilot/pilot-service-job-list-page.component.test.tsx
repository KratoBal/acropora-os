import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusValue,
  Session,
} from "@acropora/types";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotServiceJobListPage,
  serviceJobListQuery,
  serviceJobListStateFromUrl,
} from "./pilot-service-job-list-page";

/**
 * BALÁZS KÉRÉSE (2026-09-30 12:29 UTC): egy szűrt listáról az adatlapra, majd
 * vissza, a szűrés maradjon meg. A hibajegy-lista eddig helyi állapotban
 * tartotta a fület, a keresést és a partner/helyszín szűrőt, tehát a
 * visszatérés mindig a "Nyitott hibajegy" fülre, szűretlenül ért vissza.
 * Ez a spec azt méri, hogy az állapot az URL-ből indul és oda íródik vissza.
 */

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
  cache: new Map<string, URLSearchParams>(),
}));

// Stable params per query string, the way Next.js keeps them between renders:
// a fresh object on every render would re-run the URL effect for nothing.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  usePathname: () => "/szerviz/hibajegyek",
  useSearchParams: () => {
    let params = navigation.cache.get(navigation.search);
    if (!params) {
      params = new URLSearchParams(navigation.search);
      navigation.cache.set(navigation.search, params);
    }
    return params;
  },
}));

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

function item(
  id: string,
  status: ServiceJobStatusValue,
  customerName: string,
): ServiceJobListItem {
  return {
    id,
    jobNumber: `HJ-${id}`,
    title: `Jegy ${id}`,
    kind: "REPAIR",
    status,
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName,
    departmentPath: null,
    departmentCode: null,
    assignees: [],
    worksheetCount: 0,
    createdAt: "2026-09-30T10:00:00.000Z",
    hidden: false,
  };
}

const response: ServiceJobListResponse = {
  items: [
    item("1", "COMPLETED", "Alfa Kft"),
    item("2", "COMPLETED", "Beta Kft"),
    item("3", "NEW", "Alfa Kft"),
  ],
  counts: {
    NEW: 1,
    TRIAGED: 0,
    SCHEDULED: 0,
    IN_PROGRESS: 0,
    WAITING_FOR_PARTS: 0,
    WAITING_FOR_CUSTOMER: 0,
    COMPLETED: 2,
    CANCELLED: 0,
  },
  truncated: false,
};

/*
  STRICT MODE-BAN RENDERELÜNK, mert a fejlesztői szerver is abban fut, és ott
  minden effekt kétszer indul. Egy "az első futást kihagyom" jelzőre épített
  nullázás itt a második futáson nullázná az URL-ből jött partnert.
*/
function renderAt(search: string) {
  navigation.search = search;
  return render(
    <StrictMode>
      <PilotServiceJobListPage />
    </StrictMode>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.cache.clear();
  api.list.mockReset();
  api.list.mockResolvedValue(response);
});

describe("service-job list state in the URL", () => {
  it("reads the tab, search and partner from the URL, and leaves the URL alone", async () => {
    renderAt("tab=closed&q=szivatty&partner=Beta+Kft");

    await screen.findByText("Jegy 2");
    await settle();

    // the closed tab asks for every job, with the URL's search
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "szivatty",
      false,
      "REPAIR",
    );
    expect(
      (screen.getByLabelText("Partner szűrő") as HTMLSelectElement).value,
    ).toBe("Beta Kft");
    expect(screen.queryByText("Jegy 1")).toBeNull();
    // nothing was reset, so there is nothing to write back
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("writes a filter change back to the URL", async () => {
    renderAt("tab=closed");
    await screen.findByText("Jegy 1");

    fireEvent.change(screen.getByLabelText("Partner szűrő"), {
      target: { value: "Alfa Kft" },
    });
    await settle();

    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?tab=closed&partner=Alfa+Kft",
      { scroll: false },
    );
  });

  it("clears the partner when the tab changes, and the URL follows", async () => {
    renderAt("tab=closed&partner=Beta+Kft");
    await screen.findByText("Jegy 2");

    fireEvent.click(screen.getByRole("button", { name: /^Összes/ }));
    await settle();

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith(
        "/szerviz/hibajegyek?tab=all",
        { scroll: false },
      ),
    );
  });
});

describe("serviceJobListStateFromUrl / serviceJobListQuery", () => {
  it("round-trips a full state and keeps the default tab out of the URL", () => {
    const state = {
      tab: "waiting" as const,
      search: "pumpa",
      includeHidden: true,
      partner: "Alfa Kft",
      location: "A / B",
    };
    const query = serviceJobListQuery(state);
    expect(serviceJobListStateFromUrl(new URLSearchParams(query))).toEqual(
      state,
    );
    expect(
      serviceJobListQuery({
        ...serviceJobListStateFromUrl(new URLSearchParams()),
      }),
    ).toBe("");
  });

  it("falls back to the open tab on an unknown tab value", () => {
    expect(
      serviceJobListStateFromUrl(new URLSearchParams("tab=bogus")).tab,
    ).toBe("open");
  });
});
