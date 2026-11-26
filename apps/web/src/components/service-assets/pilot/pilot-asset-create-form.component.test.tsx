import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetCreatePage } from "./pilot-asset-create-page";

/**
 * AZ ÚJ ESZKÖZ A KÖZÖS ŰRLAP-VÁZON (picasso leltár 3.21, acrobot döntése 2026-11-26), mint az új hibajegy, munkalap és karbantartás. MI
 * PIROSÍT: a kötelező és a nem kötelező mező nem az egy szabály szerint jelölt; a hiány nem "Hiányzik: ..." alakban áll a gombsorban; a
 * halvány mentés hiányzó mezőnél mégis ment, vagy nem mondja meg a mezőnél, mi hiányzik; a Mégse nem a listára visz.
 * A duplázott kliensek a kategória-javaslat tesztjéből (ugyanaz az űrlap).
 */

const api = vi.hoisted(() => ({
  owners: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  nameCheck: vi.fn(),
  categorySuggestion: vi.fn(),
}));
const categories = vi.hoisted(() => ({ list: vi.fn() }));
const functions = vi.hoisted(() => ({ list: vi.fn() }));
const units = vi.hoisted(() => ({ list: vi.fn() }));
const suppliers = vi.hoisted(() => ({ units: vi.fn() }));
const aquariums = vi.hoisted(() => ({ list: vi.fn() }));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

/* A `next/font/local` a Next forditoi makroja: vitest alatt duplazni kell (lasd pilot-theme-root teszt). */
vi.mock("next/font/local", () => ({
  default: () => ({
    className: "font",
    style: { fontFamily: "Inter" },
    variable: "--font",
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/uj",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/szerviz/eszkozok", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s1",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "b@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    },
  }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: categories,
}));
vi.mock("@/lib/api/asset-functions", () => ({ assetFunctionsApi: functions }));
vi.mock("@/lib/api/units-of-measure", () => ({ unitsOfMeasureApi: units }));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
vi.mock("@/lib/api/aquariums", () => ({ aquariumsApi: aquariums }));

const KATEGORIAK = [
  {
    id: "cat_lig",
    name: "Világítás",
    code: "LIG",
    isActive: true,
    sortOrder: 0,
  },
  {
    id: "cat_com",
    name: "Komputer, vezérlő",
    code: "COM",
    isActive: true,
    sortOrder: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.owners.mockResolvedValue({
    items: [
      {
        type: "CUSTOMER",
        id: "customer-1",
        code: "VEVO",
        displayName: "Vevő Kft.",
        isActive: true,
        addresses: [],
      },
    ],
  });
  api.list.mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
  });
  api.nameCheck.mockResolvedValue([]);
  api.create.mockResolvedValue({ id: "asset-1" });
  categories.list.mockResolvedValue({ items: KATEGORIAK });
  functions.list.mockResolvedValue({ items: [] });
  units.list.mockResolvedValue({ items: [] });
  suppliers.units.mockResolvedValue({ items: [] });
  aquariums.list.mockResolvedValue({
    items: [],
    pagination: { totalItems: 0 },
  });
});

async function megjelenit() {
  render(<PilotAssetCreatePage />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Partner") as HTMLSelectElement).options.length,
    ).toBe(2),
  );
}

const save = () => screen.getByRole("button", { name: "Eszköz létrehozása" });

describe("az új eszköz a közös űrlap-vázon", () => {
  it("a kötelező és a nem kötelező mező egy szabály szerint jelölt, a hiány a gombsorban áll", async () => {
    await megjelenit();
    const label = (text: string) =>
      screen.getAllByText(text, { selector: "label" })[0]!;
    expect(label("Eszköz neve").textContent).toContain("(kötelező)");
    expect(label("Partner").textContent).toContain("(kötelező)");
    expect(label("Sorozatszám").textContent).toContain("(nem kötelező)");
    expect(label("Helyszín").textContent).toContain("(nem kötelező)");
    expect(
      screen.getByText("Hiányzik: Eszköz neve, Partner"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Kötelező:/)).toBeNull();
    expect(save()).toHaveAttribute("aria-disabled", "true");
  });

  it("hiányzó mezőnél a halvány mentés nem ment, hanem a mezőnél mondja meg, mi hiányzik", async () => {
    await megjelenit();
    fireEvent.click(save());
    expect(
      await screen.findByText("Add meg az eszköz nevét."),
    ).toBeInTheDocument();
    expect(screen.getByText("Válassz partnert.")).toBeInTheDocument();
    expect(api.nameCheck).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("az Enter is a gombsor útját járja: hiányzó mezőnél a hiba a mezőnél áll, és nem ment", async () => {
    await megjelenit();
    fireEvent.submit(screen.getByLabelText("Eszköz neve").closest("form")!);
    expect(
      await screen.findByText("Add meg az eszköz nevét."),
    ).toBeInTheDocument();
    expect(screen.getByText("Válassz partnert.")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("kitöltve a hiány eltűnik, és a mentés létrehozza az eszközt", async () => {
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "CUSTOMER:customer-1" },
    });
    fireEvent.change(screen.getByLabelText("Eszköz neve"), {
      target: { value: "Felnyomó szivattyú" },
    });
    expect(screen.queryByText(/^Hiányzik:/)).toBeNull();
    expect(save()).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(save());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  });

  it("a Mégse a listára visz, mentés nélkül", async () => {
    await megjelenit();
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/eszkozok");
    expect(api.create).not.toHaveBeenCalled();
  });
});

/**
 * A FÜGGŐ MEZŐK, MINT A HIBAJEGYEN (Picasso 3.21, acrobot 63427): ami még nem választható, a helyén kikapcsolt mező, benne amire
 * vár (PilotWaitingField), és a címke rá mutat. MI PIROSÍT: partner nélkül a Vevő címe, a Helyszín vagy a Szülőeszköz nem mondja,
 * hogy partnerre vár; vevőnél a Helyszín, szerviz partnernél a Vevő címe nem mondja, miért nem adható meg; vagy a választható mező
 * maga is a várakozót mutatja.
 */
describe("az új eszköz függő mezői", () => {
  const waiting = (label: RegExp) =>
    screen.getByLabelText(label, { selector: "select" }) as HTMLSelectElement;

  it("partner nélkül a Vevő címe, a Helyszín és a Szülőeszköz a partnerre vár, kikapcsolva", async () => {
    await megjelenit();
    for (const label of [/^Vevő címe/, /^Helyszín/, /^Szülőeszköz/]) {
      const field = waiting(label);
      expect(
        [field.disabled, field.options[0]?.textContent],
        String(label),
      ).toEqual([true, "Előbb válassz partnert"]);
    }
    expect(screen.queryByLabelText("Szülőeszköz keresése")).toBeNull();
  });

  it("vevőnél a Vevő címe és a Szülőeszköz választható, a Helyszín megmondja, miért nem", async () => {
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "CUSTOMER:customer-1" },
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Vevő címe") as HTMLSelectElement).disabled,
      ).toBe(false),
    );
    expect(screen.getByLabelText("Szülőeszköz keresése")).toBeTruthy();
    const site = waiting(/^Helyszín/);
    expect([site.disabled, site.options[0]?.textContent]).toEqual([
      true,
      "Csak szerviz partner eszközénél adható meg",
    ]);
  });

  it("szerviz partnernél a Helyszín választható, a Vevő címe megmondja, miért nem", async () => {
    api.owners.mockResolvedValue({
      items: [
        {
          type: "SUPPLIER",
          id: "supplier-1",
          code: "FANK",
          displayName: "Fánk Kft.",
          isActive: true,
          addresses: [],
        },
      ],
    });
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "SUPPLIER:supplier-1" },
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Helyszín") as HTMLSelectElement).disabled,
      ).toBe(false),
    );
    const address = waiting(/^Vevő címe/);
    expect([address.disabled, address.options[0]?.textContent]).toEqual([
      true,
      "Csak vevő eszközénél adható meg",
    ]);
  });
});
