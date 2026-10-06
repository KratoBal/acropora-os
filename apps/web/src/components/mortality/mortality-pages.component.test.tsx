import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MortalityDetail,
  MortalityListResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MortalityDetailPage } from "./mortality-detail-page";
import { MortalityFormPage, mortalityFormInput } from "./mortality-form-page";
import { MortalityListPage } from "./mortality-list-page";

/** Az elhullási napló három képernyője (kártya 115c9740). */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/elhullasi-naplo",
  useSearchParams: () => navigation.search,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  productOptions: vi.fn(),
  aquariumOptions: vi.fn(),
  supplierOptions: vi.fn(),
  recorderOptions: vi.fn(),
  uploadPhotos: vi.fn(),
  downloadPhotoThumbnail: vi.fn(),
  downloadPhoto: vi.fn(),
}));
vi.mock("@/lib/api/mortality", () => ({ mortalityApi: api }));

const auth = vi.hoisted(() => ({ role: "SERVICE" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const ITEM = {
  id: "rec-1",
  recordNumber: "ELH-1",
  product: {
    id: "p1",
    name: "Zebrasoma flavescens",
    commonName: "Sárga doktorhal",
  },
  quantity: 1,
  aquarium: { id: "a1", name: "Tengeri halak", aquariumNumber: "A-12" },
  source: {
    type: "SUPPLIER" as const,
    supplier: { id: "s1", name: "De Jong Marinelife" },
    note: null,
  },
  recordedBy: { id: "u1", name: "Nagy Anna" },
  recordedAt: "2026-10-06T07:42:00Z",
  photoCount: 0,
};

const LIST: MortalityListResponse = {
  items: [ITEM],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

const DETAIL: MortalityDetail = {
  ...ITEM,
  note: "Reggel már étvágytalan volt.",
  createdAt: "2026-10-06T07:42:00Z",
  lastModified: null,
  photos: [],
};

beforeEach(() => {
  auth.role = "SERVICE";
  navigation.search = new URLSearchParams();
  api.list.mockResolvedValue(LIST);
  api.summary.mockResolvedValue({
    thisMonth: 18,
    thisMonthAquariumCount: 3,
    last7Days: 5,
    previous7Days: 7,
    mostAffectedAquarium: {
      id: "a1",
      name: "Tengeri halak",
      aquariumNumber: "A-12",
      quantity: 6,
    },
  });
  api.aquariumOptions.mockResolvedValue([
    { id: "a1", name: "Tengeri halak", aquariumNumber: "A-12" },
  ]);
  api.recorderOptions.mockResolvedValue([{ id: "u1", name: "Nagy Anna" }]);
  api.detail.mockResolvedValue(DETAIL);
});

afterEach(() => vi.clearAllMocks());

describe("lista", () => {
  it("a sorok, a kártyák és az új bejegyzés gombja", async () => {
    render(<MortalityListPage />);
    expect(await screen.findByText("Zebrasoma flavescens")).toBeTruthy();
    expect(screen.getByText("Sárga doktorhal")).toBeTruthy();
    expect(screen.getByText("De Jong Marinelife")).toBeTruthy();
    expect(screen.getByText("2026.10.06. 09:42")).toBeTruthy();
    expect(await screen.findByText("18 példány")).toBeTruthy();
    expect(screen.getByText("3 akváriumban")).toBeTruthy();
    expect(
      screen.getByText("2 példánnyal kevesebb, mint az előző héten"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Új bejegyzés/ })).toBeTruthy();
  });

  it("az időszak-szűrő a nap-határokat küldi a szervernek", async () => {
    navigation.search = new URLSearchParams("period=ma&sourceType=TRADE");
    render(<MortalityListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const query = api.list.mock.calls[0]![1] as URLSearchParams;
    expect(query.get("sourceType")).toBe("TRADE");
    expect(query.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.get("from")).toBe(query.get("to"));
  });

  it("a beszállító-szűrő a választott beszállítót küldi, a nevét mutatja", async () => {
    navigation.search = new URLSearchParams(
      "sourceType=SUPPLIER&supplierId=s1&supplierName=De+Jong+Marinelife",
    );
    render(<MortalityListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const query = api.list.mock.calls[0]![1] as URLSearchParams;
    expect(query.get("sourceType")).toBe("SUPPLIER");
    expect(query.get("supplierId")).toBe("s1");
    expect(screen.getByRole("button", { name: "Csere" })).toBeTruthy();
  });

  it("más forrás mellett a beszállító nem megy el, és a választó sincs ott", async () => {
    navigation.search = new URLSearchParams("sourceType=TRADE&supplierId=s1");
    render(<MortalityListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const query = api.list.mock.calls[0]![1] as URLSearchParams;
    expect(query.get("sourceType")).toBe("TRADE");
    expect(query.has("supplierId")).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Beszállító" })).toBeNull();
  });

  it("a beszállító kiválasztása az URL-be írja az azonosítót és a nevet", async () => {
    navigation.search = new URLSearchParams("sourceType=SUPPLIER");
    api.supplierOptions.mockResolvedValue([
      { id: "s1", name: "De Jong Marinelife" },
    ]);
    render(<MortalityListPage />);
    fireEvent.focus(screen.getByRole("textbox", { name: "Beszállító" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "De Jong Marinelife" }),
    );
    const url = navigation.replace.mock.calls.at(-1)![0] as string;
    const written = new URLSearchParams(url.split("?")[1]);
    expect(written.get("supplierId")).toBe("s1");
    expect(written.get("supplierName")).toBe("De Jong Marinelife");
    expect(written.get("sourceType")).toBe("SUPPLIER");
  });

  it("a forrás váltása törli a választott beszállítót", async () => {
    navigation.search = new URLSearchParams(
      "sourceType=SUPPLIER&supplierId=s1&supplierName=X&page=3",
    );
    render(<MortalityListPage />);
    fireEvent.change(screen.getByRole("combobox", { name: "Forrás" }), {
      target: { value: "TRADE" },
    });
    const url = navigation.replace.mock.calls.at(-1)![0] as string;
    const written = new URLSearchParams(url.split("?")[1]);
    expect(written.get("sourceType")).toBe("TRADE");
    expect(written.has("supplierId")).toBe(false);
    expect(written.has("supplierName")).toBe(false);
    expect(written.has("page")).toBe(false);
  });

  it("a VIEWER lát, de nem rögzíthet", async () => {
    auth.role = "VIEWER";
    render(<MortalityListPage />);
    expect(await screen.findByText("Zebrasoma flavescens")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Új bejegyzés/ })).toBeNull();
  });

  it("jog nélkül nem kér adatot", () => {
    auth.role = "PARTNER_SERVICE";
    render(<MortalityListPage />);
    expect(
      screen.getByText("Nincs hozzáférésed az elhullási naplóhoz"),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("részlet", () => {
  it("az adatok, a megjegyzés és a „Nem módosították”", async () => {
    render(<MortalityDetailPage recordId="rec-1" />);
    expect(
      await screen.findByText("Reggel már étvágytalan volt."),
    ).toBeTruthy();
    expect(screen.getByText("Nem módosították")).toBeTruthy();
    expect(screen.getAllByText("#ELH-1").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Módosítás/ })).toBeTruthy();
  });

  it("az utolsó módosító neve az auditnaplóból", async () => {
    api.detail.mockResolvedValue({
      ...DETAIL,
      lastModified: {
        at: "2026-10-06T10:00:00Z",
        by: { id: "u2", name: "Kovács Márk" },
      },
    });
    render(<MortalityDetailPage recordId="rec-1" />);
    expect(
      await screen.findByText("Kovács Márk · 2026. október 6. · 12:00"),
    ).toBeTruthy();
  });

  it("nincs törlés gomb, és a VIEWER nem módosíthat", async () => {
    auth.role = "VIEWER";
    render(<MortalityDetailPage recordId="rec-1" />);
    await screen.findByText("Reggel már étvágytalan volt.");
    expect(screen.queryByRole("link", { name: /Módosítás/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Törlés/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Fotók hozzáadása/ }),
    ).toBeNull();
  });
});

describe("űrlap", () => {
  const filled = {
    product: { id: "p1", title: "Zebrasoma flavescens" },
    quantity: "2",
    aquariumId: "a1",
    sourceType: "TRADE" as const,
    supplier: null,
    sourceNote: "  Béla  ",
    note: " ",
  };

  it("a beküldött bemenet a szerver alakjában", () => {
    expect(mortalityFormInput(filled)).toEqual({
      input: {
        productId: "p1",
        quantity: 2,
        aquariumId: "a1",
        sourceType: "TRADE",
        supplierId: null,
        sourceNote: "Béla",
        note: null,
      },
    });
  });

  it("a hiányzó mezők sorban", () => {
    expect(mortalityFormInput({ ...filled, product: null })).toEqual({
      problem: "Válaszd ki az élőlényt.",
    });
    expect(mortalityFormInput({ ...filled, quantity: "0" })).toEqual({
      problem: "A példányszám legalább 1, egész szám.",
    });
    expect(mortalityFormInput({ ...filled, sourceType: "SUPPLIER" })).toEqual({
      problem: "Válaszd ki a beszállítót.",
    });
    expect(
      mortalityFormInput({ ...filled, sourceType: "OTHER", sourceNote: " " }),
    ).toEqual({
      problem: "Az „Egyéb” forrásnál nevezd meg, honnan érkezett.",
    });
  });

  it("beszállítónál a megnevezés nem megy el", () => {
    const result = mortalityFormInput({
      ...filled,
      sourceType: "SUPPLIER",
      supplier: { id: "s1", title: "TMC" },
    });
    expect(result).toMatchObject({
      input: { supplierId: "s1", sourceNote: null },
    });
  });

  it("hiányos űrlapot nem küld el", async () => {
    render(<MortalityFormPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Bejegyzés mentése" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("módosításnál kitöltve nyílik, és PATCH-csel ment", async () => {
    api.update.mockResolvedValue(DETAIL);
    render(<MortalityFormPage recordId="rec-1" />);
    expect(await screen.findByText("Zebrasoma flavescens")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).toMatchObject({
      productId: "p1",
      supplierId: "s1",
      sourceType: "SUPPLIER",
    });
    expect(api.create).not.toHaveBeenCalled();
    expect(navigation.push).toHaveBeenCalledWith("/elhullasi-naplo/rec-1");
  });

  it("a VIEWER nem nyithatja meg", () => {
    auth.role = "VIEWER";
    render(<MortalityFormPage />);
    expect(
      screen.getByText("Nincs jogosultságod elhullási bejegyzést rögzíteni"),
    ).toBeTruthy();
  });
});
