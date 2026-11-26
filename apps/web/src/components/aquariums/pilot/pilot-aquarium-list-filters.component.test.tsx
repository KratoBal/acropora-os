import { fireEvent, render, screen } from "@testing-library/react";
import type { AquariumListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AQUARIUM_COLUMNS,
  AQUARIUM_TABLE_MIN_WIDTH,
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
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

/*
  AZ AKVÁRIUMLISTA SZŰRŐI ÉS TÁBLÁJA (Picasso 3.15, acrobot 62134). MI PIROSÍT: ha a két szűrő újra szegmentált kapcsoló (a többi lista legördülővel szűr); ha a
  legördülő nem ugyanazt az URL-kulcsot és értéket írja, mint a kapcsoló; ha a tábla minimuma újra nagyobb, mint a tartalom szélessége 1440 px-en (1216), és a tábla
  görgetne, az utolsó oszlop a képernyő szélén, margó nélkül.
*/
describe("PilotAquariumListPage filters and table width", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response);
  });

  const lastReplace = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("the ownership and type filters are selects, not segmented switches", async () => {
    render(<PilotAquariumListPage />);
    await screen.findByRole("table");
    for (const [name, options] of [
      ["Tulajdon", ["Minden tulajdon", "Saját", "Ügyfél"]],
      ["Típus", ["Minden típus", "Akvárium", "Tó"]],
    ] as const) {
      const select = screen.getByRole("combobox", {
        name,
      }) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        ...options,
      ]);
      // fixed width that does not shrink: the filter row does not stretch a lone select
      expect(select.parentElement!.className).toContain("shrink-0");
    }
    // the old segmented switches had their own "Mind" buttons
    expect(screen.queryByRole("button", { name: "Mind" })).toBeNull();
  });

  it("choosing writes the same URL key and value the switch wrote, and resets the page; the empty choice clears the key", async () => {
    render(<PilotAquariumListPage />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Tulajdon" }), {
      target: { value: "CUSTOMER" },
    });
    expect(lastReplace().get("ownershipType")).toBe("CUSTOMER");
    expect(lastReplace().get("page")).toBe("1");
    fireEvent.change(screen.getByRole("combobox", { name: "Típus" }), {
      target: { value: "TO" },
    });
    expect(lastReplace().get("waterBodyType")).toBe("TO");
    fireEvent.change(screen.getByRole("combobox", { name: "Típus" }), {
      target: { value: "" },
    });
    expect(lastReplace().has("waterBodyType")).toBe(false);
  });

  it("the selects show the URL's current filter", async () => {
    navigation.params = new URLSearchParams(
      "ownershipType=OWN&waterBodyType=AKVARIUM",
    );
    render(<PilotAquariumListPage />);
    await screen.findByRole("table");
    expect(
      (screen.getByRole("combobox", { name: "Tulajdon" }) as HTMLSelectElement)
        .value,
    ).toBe("OWN");
    expect(
      (screen.getByRole("combobox", { name: "Típus" }) as HTMLSelectElement)
        .value,
    ).toBe("AKVARIUM");
  });

  it("an unknown filter value in the URL (an old or hand-written link) shows the empty choice AND is not sent: the select and the list say the same", async () => {
    navigation.params = new URLSearchParams(
      "ownershipType=BOTH&waterBodyType=POND",
    );
    render(<PilotAquariumListPage />);
    await screen.findByRole("table");
    expect(
      (screen.getByRole("combobox", { name: "Tulajdon" }) as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByRole("combobox", { name: "Típus" }) as HTMLSelectElement)
        .value,
    ).toBe("");
    // the empty choice is the one shown. React selects the first option when the value matches none, so this also holds without the check in the select itself: what really changes is the request below
    for (const name of ["Tulajdon", "Típus"]) {
      expect(
        (screen.getByRole("combobox", { name }) as HTMLSelectElement)
          .selectedIndex,
        name,
      ).toBe(0);
    }
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.has("ownershipType")).toBe(false);
    expect(query.has("waterBodyType")).toBe(false);
  });

  it("a known filter value is still sent", async () => {
    navigation.params = new URLSearchParams(
      "ownershipType=CUSTOMER&waterBodyType=TO",
    );
    render(<PilotAquariumListPage />);
    await screen.findByRole("table");
    const query = api.list.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("ownershipType")).toBe("CUSTOMER");
    expect(query.get("waterBodyType")).toBe("TO");
  });

  it("the table fits the content width at 1440 px (1216 px beside the 224 px menu): no sideways scroll, the last column keeps its margin", () => {
    expect(AQUARIUM_TABLE_MIN_WIDTH).toBeLessThanOrEqual(1216);
    const sum = AQUARIUM_COLUMNS.reduce(
      (total, column) =>
        total + Number(/^(\d+)px$/.exec(column.width ?? "")?.[1]),
      0,
    );
    expect(sum).toBeLessThanOrEqual(AQUARIUM_TABLE_MIN_WIDTH);
  });
});
