import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AquariumListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aquariumListQuery,
  PilotAquariumListPage,
} from "./pilot-aquarium-list-page";

// The page's imports reach the Inter font loader, which only runs inside Next.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));
const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/akvariumok",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: api }));

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

const response: AquariumListResponse = {
  items: [
    {
      id: "aquarium-1",
      aquariumNumber: "AKV-1",
      name: "Korallmedence",
      ownershipType: "OWN",
      waterBodyType: "AKVARIUM",
      systemVolumeLiters: 450,
      equipmentCount: 2,
      maintainers: [],
      isActive: true,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
    },
  ],
  pagination: { page: 3, pageSize: 25, totalItems: 60, totalPages: 3 },
};

/*
  A LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a név, az ügyfél vagy a liter fejléce nem a saját
  szerver-mezőjét írja az URL-be; ha a ciklus (növekvő, csökkenő, alap) elakad; ha a rendezés nem nullázza a lapot, vagy elveszíti a
  szűrőt; ha az URL rendezése nem jut a kérésbe, vagy egy ismeretlen mező (régi vagy kézzel írt link) igen (az API 400-at adna, és az
  egész lista eltörne); ha egy másik oszlop (tulajdon, típus, víz, berendezések, karbantartók, utolsó vízmérés) rendezhetőnek látszik.
*/
describe("PilotAquariumListPage sorting", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=3&ownershipType=OWN");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response);
  });

  const lastReplace = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("each sortable header writes its own server field, ascending first, drops the page and keeps the filter", async () => {
    render(<PilotAquariumListPage />);
    const table = await screen.findByRole("table");
    for (const [name, field] of [
      ["Név", "name"],
      ["Ügyfél", "customerName"],
      ["Liter", "systemVolumeLiters"],
    ] as const) {
      navigation.replace.mockReset();
      fireEvent.click(within(table).getByRole("button", { name }));
      const url = lastReplace();
      expect(url.get("sort"), name).toBe(field);
      expect(url.get("direction"), name).toBe("asc");
      expect(url.has("page"), name).toBe(false);
      expect(url.get("ownershipType"), name).toBe("OWN");
    }
  });

  it("the second click is descending, the third clears the sort", async () => {
    navigation.params = new URLSearchParams("sort=name&direction=asc");
    render(<PilotAquariumListPage />);
    await screen.findAllByTestId("aquarium-row");
    fireEvent.click(screen.getByRole("button", { name: "Név" }));
    expect(lastReplace().get("direction")).toBe("desc");

    // a mock a címet csak értesítésre olvassa újra: az URL "megváltozott"
    navigation.params = new URLSearchParams("sort=name&direction=desc");
    act(() => {
      for (const listener of navigation.listeners) listener();
    });
    navigation.replace.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Név" }));
    expect(lastReplace().has("sort")).toBe(false);
    expect(lastReplace().has("direction")).toBe(false);
  });

  it("the URL's sort reaches the request, and an unknown or incomplete one does not", async () => {
    navigation.params = new URLSearchParams(
      "sort=systemVolumeLiters&direction=desc",
    );
    render(<PilotAquariumListPage />);
    await screen.findAllByTestId("aquarium-row");
    const sent = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(sent.get("sort")).toBe("systemVolumeLiters");
    expect(sent.get("direction")).toBe("desc");

    for (const bad of [
      "sort=waterBodyType&direction=asc",
      "sort=name",
      "sort=name&direction=up",
      "direction=asc",
    ]) {
      const query = aquariumListQuery(new URLSearchParams(bad));
      expect(query.has("sort"), bad).toBe(false);
      expect(query.has("direction"), bad).toBe(false);
    }
    expect(
      Object.fromEntries(
        aquariumListQuery(new URLSearchParams("ownershipType=OWN")),
      ),
    ).toEqual({ ownershipType: "OWN", page: "1", pageSize: "25" });
  });

  it("only the name, the customer and the litres columns have a sort button", async () => {
    render(<PilotAquariumListPage />);
    const table = await screen.findByRole("table");
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((header) => within(header).queryByRole("button"))
      .map((header) => header.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual(["Név", "Ügyfél", "Liter"]);
  });
});
