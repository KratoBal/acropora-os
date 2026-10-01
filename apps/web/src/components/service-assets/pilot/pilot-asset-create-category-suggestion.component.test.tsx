import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAssetCreatePage } from "./pilot-asset-create-page";
import { applyCategorySuggestion } from "./use-category-suggestion";

/**
 * A JEV KATEGORIA-JAVASLAT A LETREHOZO URLAPON (V1 pilot, #1199 P-012/P-013).
 *
 * A VALODI URLAP, DUPLAZOTT KLIENSEKKEL. A kerdes nem az, hogy a hook hiv-e,
 * hanem hogy mi all a KATEGORIA-VALASZTOBAN es mi megy a MENTESBEN: az
 * elotoltes, az ember valasztasanak tiszteletben tartasa, a kiurites, es a
 * muvelet-azonosito, ami a szerveren a futast az eszkozhoz koti.
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

const kategoria = () => screen.getByLabelText("Kategória") as HTMLSelectElement;

async function megjelenit() {
  render(<PilotAssetCreatePage />);
  await waitFor(() => expect(kategoria().options.length).toBe(3));
}

/** Beiras, majd a mezo elhagyasa: a javaslat a mezo elhagyasakor indul. */
function nevetIr(nev: string) {
  const mezo = screen.getByLabelText("Eszköz neve");
  fireEvent.change(mezo, { target: { value: nev } });
  fireEvent.blur(mezo);
}

describe("a létrehozó űrlap: Jev kategória-javaslat", () => {
  it("a névre késleltetve kér, a javaslat a választóba kerül, és jelölve van", async () => {
    api.categorySuggestion.mockResolvedValue({
      enabled: true,
      categoryId: "cat_lig",
    });
    await megjelenit();
    nevetIr("Kessil lámpa");
    await waitFor(() => expect(kategoria().value).toBe("cat_lig"));
    expect(
      screen.getByText("Javasolt kategória. Ellenőrizd, mielőtt mented."),
    ).toBeTruthy();
    const [, bemenet] = api.categorySuggestion.mock.calls.at(-1) ?? [];
    expect(bemenet).toMatchObject({ name: "Kessil lámpa", kind: "EQUIPMENT" });
    expect(bemenet.clientOperationId).toMatch(/^asset-create:web:/);
  });

  it("üres névre nem kér", async () => {
    await megjelenit();
    await new Promise((r) => setTimeout(r, 600));
    expect(api.categorySuggestion).not.toHaveBeenCalled();
  });

  /** AZ EMBER VALASZTASA ELSOBBSEGET ELVEZ: utana semmi nem irja felul. */
  it("ha az ember kategóriát választott, a javaslat nem írja felül", async () => {
    api.categorySuggestion.mockResolvedValue({
      enabled: true,
      categoryId: "cat_lig",
    });
    await megjelenit();
    fireEvent.change(kategoria(), { target: { value: "cat_com" } });
    nevetIr("Kessil lámpa");
    await waitFor(() => expect(api.categorySuggestion).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(kategoria().value).toBe("cat_com");
  });

  /**
   * A JAVASLAT ELMARADT (a mezok valtoztak, az uj javaslat rejtett): a korabbi
   * elotoltes kiurul, kulonben a mentes egy mar ervenytelen javaslatot
   * rogzitene elfogadottkent.
   */
  it("ha a javaslat elmarad, a korábbi előtöltés kiürül", async () => {
    api.categorySuggestion
      .mockResolvedValueOnce({ enabled: true, categoryId: "cat_lig" })
      .mockResolvedValue({ enabled: true, categoryId: null });
    await megjelenit();
    nevetIr("Kessil lámpa");
    await waitFor(() => expect(kategoria().value).toBe("cat_lig"));
    nevetIr("Kessil lámpa vezérlő");
    await waitFor(() => expect(kategoria().value).toBe(""));
  });

  it("a Jev hibája csendes: az űrlap javaslat nélkül működik tovább", async () => {
    api.categorySuggestion.mockRejectedValue(new Error("hálózati hiba"));
    await megjelenit();
    nevetIr("Kessil lámpa");
    await waitFor(() => expect(api.categorySuggestion).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(kategoria().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** A MENTES UGYANAZT A MUVELET-AZONOSITOT KULDI: ezzel kotodik a futas az eszkozhoz. */
  it("a mentés ugyanazt a művelet-azonosítót küldi, mint a javaslat-kérés", async () => {
    api.categorySuggestion.mockResolvedValue({
      enabled: true,
      categoryId: "cat_lig",
    });
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "CUSTOMER:customer-1" },
    });
    fireEvent.change(screen.getByLabelText("Matrica kódja"), {
      target: { value: "V2196" },
    });
    nevetIr("Kessil lámpa");
    await waitFor(() => expect(kategoria().value).toBe("cat_lig"));
    fireEvent.click(screen.getByRole("button", { name: "Eszköz létrehozása" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, mentes] = api.create.mock.calls[0] ?? [];
    const [, kerdes] = api.categorySuggestion.mock.calls.at(-1) ?? [];
    expect(mentes.clientOperationId).toBe(kerdes.clientOperationId);
    expect(mentes.categoryId).toBe("cat_lig");
  });
});

describe("az előtöltés döntése", () => {
  it("új javaslat: a választóba kerül", () => {
    expect(
      applyCategorySuggestion({
        categoryId: "",
        prefilled: null,
        touched: false,
        suggestion: "a",
      }),
    ).toEqual({ categoryId: "a", prefilled: "a" });
  });
  it("az érintett választót semmi nem írja felül", () => {
    expect(
      applyCategorySuggestion({
        categoryId: "b",
        prefilled: "a",
        touched: true,
        suggestion: "c",
      }),
    ).toEqual({ categoryId: "b", prefilled: "a" });
  });
  it("elmaradt javaslat: csak a saját előtöltését üríti", () => {
    expect(
      applyCategorySuggestion({
        categoryId: "a",
        prefilled: "a",
        touched: false,
        suggestion: null,
      }),
    ).toEqual({ categoryId: "", prefilled: null });
    expect(
      applyCategorySuggestion({
        categoryId: "",
        prefilled: null,
        touched: false,
        suggestion: null,
      }),
    ).toEqual({ categoryId: "", prefilled: null });
  });
});

/**
 * GEPELES KOZBEN NINCS KERES (acrobot staging-merese, 2026-09-28: a "Homoks",
 * "Homoksz" reszszavakra is futas keletkezett). A szovegmezo a mezo
 * elhagyasakor kuld, es a 3 karakternel rovidebb nevre nem.
 */
describe("a létrehozó űrlap: mikor indul a javaslat-kérés", () => {
  it("gépelés közben (mező elhagyása nélkül) nem kér", async () => {
    api.categorySuggestion.mockResolvedValue({
      enabled: true,
      categoryId: "cat_lig",
    });
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Eszköz neve"), {
      target: { value: "Homokszűrő" },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(api.categorySuggestion).not.toHaveBeenCalled();
  });

  it("a mező elhagyásakor egyszer kér, a teljes névvel", async () => {
    api.categorySuggestion.mockResolvedValue({
      enabled: true,
      categoryId: null,
    });
    await megjelenit();
    const mezo = screen.getByLabelText("Eszköz neve");
    for (const reszlet of ["Hom", "Homoks", "Homokszűrő"])
      fireEvent.change(mezo, { target: { value: reszlet } });
    fireEvent.blur(mezo);
    await waitFor(() =>
      expect(api.categorySuggestion).toHaveBeenCalledTimes(1),
    );
    expect(api.categorySuggestion.mock.calls[0]?.[1]).toMatchObject({
      name: "Homokszűrő",
    });
  });

  it("3 karakternél rövidebb névre nem kér", async () => {
    await megjelenit();
    nevetIr("BI");
    await new Promise((r) => setTimeout(r, 400));
    expect(api.categorySuggestion).not.toHaveBeenCalled();
  });
});

describe("a létrehozó űrlap: a szülőeszköz keresése", () => {
  /**
   * Balázs, 2026-10-01: a szülőeszköz-lista a partner első 100 eszközét hozta
   * betűrendben, a FANK 406 eszközéből így csak AKV kezdetűek jöttek fel. A
   * kérés most az alegység részfájára és a keresőre szűkít.
   */
  const utolsoKeres = () =>
    (api.list.mock.calls.at(-1)?.[1] as URLSearchParams | undefined) ??
    new URLSearchParams();

  it("a beírt keresést és a választott alegységet is elküldi", async () => {
    api.owners.mockResolvedValue({
      items: [
        {
          type: "SUPPLIER",
          id: "supplier-1",
          code: "FANK",
          displayName: "FANK",
          isActive: true,
          addresses: [],
        },
      ],
    });
    suppliers.units.mockResolvedValue({
      items: [
        {
          id: "dep-biodom",
          name: "Biodóm",
          code: "BIO",
          parentId: null,
          isActive: true,
        },
      ],
    });
    await megjelenit();
    fireEvent.change(screen.getByLabelText("Partner"), {
      target: { value: "SUPPLIER:supplier-1" },
    });
    await waitFor(() =>
      expect(utolsoKeres().get("ownerId")).toBe("supplier-1"),
    );
    expect(utolsoKeres().get("departmentId")).toBeNull();

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Alegység") as HTMLSelectElement).options.length,
      ).toBe(2),
    );
    fireEvent.change(screen.getByLabelText("Alegység"), {
      target: { value: "dep-biodom" },
    });
    await waitFor(() =>
      expect(utolsoKeres().get("departmentId")).toBe("dep-biodom"),
    );

    fireEvent.change(screen.getByLabelText("Szülőeszköz keresése"), {
      target: { value: "szűrő" },
    });
    await waitFor(() => expect(utolsoKeres().get("search")).toBe("szűrő"));
    expect(utolsoKeres().get("departmentId")).toBe("dep-biodom");
  });
});
