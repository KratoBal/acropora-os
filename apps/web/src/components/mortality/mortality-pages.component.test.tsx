import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MortalityDetail,
  MortalityListResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MortalityDetailPage } from "./mortality-detail-page";
import {
  MORTALITY_PLACE_REQUIRED,
  MortalityFormPage,
  mortalityFormInput,
} from "./mortality-form-page";
import { budapestDay } from "./mortality-format";
import { MortalityListPage } from "./mortality-list-page";
import { freeTextOption } from "./mortality-search-picker";

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
  locationOptions: vi.fn(),
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
  productName: null,
  quantity: 1,
  aquarium: { id: "a1", name: "Tengeri halak", aquariumNumber: "A-12" },
  location: null as { id: string; name: string } | null,
  source: {
    type: "SUPPLIER" as const,
    supplier: { id: "s1", name: "De Jong Marinelife" },
    note: null,
  },
  recordedBy: { id: "u1", name: "Nagy Anna" },
  // utólag rögzítve: az elhullás napja a rögzítés előtti nap
  occurredOn: "2026-10-05",
  recordedAt: "2026-10-06T07:42:00Z",
  photoCount: 0,
};

const RACKS = [
  { id: "r1", name: "JOBB 1. oszlop" },
  { id: "r2", name: "Bal hátsó nagy halas (dühöngő)" },
  { id: "r3", name: "Rákos 1" },
];

const LIST: MortalityListResponse = {
  items: [ITEM],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

const DETAIL: MortalityDetail = {
  ...ITEM,
  note: "Reggel már étvágytalan volt.",
  stock: { deducted: 1, sku: "ZEB-1", reason: null },
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
  api.locationOptions.mockResolvedValue(RACKS);
  api.detail.mockResolvedValue(DETAIL);
});

afterEach(() => vi.clearAllMocks());

describe("lista", () => {
  it("a sorok, a kártyák és az új bejegyzés gombja", async () => {
    render(<MortalityListPage />);
    expect(await screen.findByText("Zebrasoma flavescens")).toBeTruthy();
    expect(screen.getByText("Sárga doktorhal")).toBeTruthy();
    expect(screen.getByText("De Jong Marinelife")).toBeTruthy();
    // az elhullás napja áll elöl, a rögzítés ideje a második sorban
    expect(screen.getByText("2026.10.05.")).toBeTruthy();
    expect(screen.getByText("rögzítve 2026.10.06. 09:42")).toBeTruthy();
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

  it("szabad szöveges élőlény és beszállító: a beírt név és a jelölés látszik", async () => {
    api.list.mockResolvedValue({
      ...LIST,
      items: [
        {
          ...ITEM,
          product: null,
          productName: "Ismeretlen gébféle",
          source: { type: "SUPPLIER", supplier: null, note: "Kis Pál" },
        },
      ],
    });
    render(<MortalityListPage />);
    expect(await screen.findByText("Ismeretlen gébféle")).toBeTruthy();
    expect(screen.getByText("nincs a rendszerben")).toBeTruthy();
    expect(screen.getByText("Kis Pál")).toBeTruthy();
    expect(screen.getByText("Beszállító, nincs a rendszerben")).toBeTruthy();
  });

  it("a halas rack az akvárium alatt látszik", async () => {
    api.list.mockResolvedValue({
      ...LIST,
      items: [{ ...ITEM, location: RACKS[1] }],
    });
    render(<MortalityListPage />);
    expect(
      await screen.findByText("Bal hátsó nagy halas (dühöngő)"),
    ).toBeTruthy();
  });

  it("akvárium nélkül a rack áll az akvárium helyén", async () => {
    api.list.mockResolvedValue({
      ...LIST,
      items: [{ ...ITEM, aquarium: null, location: RACKS[2] }],
    });
    render(<MortalityListPage />);
    expect(await screen.findByText("Rákos 1")).toBeTruthy();
    expect(screen.getByText("Halas rack")).toBeTruthy();
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
    expect(screen.getByText("1 db levonva a készletből (ZEB-1).")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Módosítás/ })).toBeTruthy();
  });

  it("az elhullás napja és a halas rack", async () => {
    api.detail.mockResolvedValue({ ...DETAIL, location: RACKS[0] });
    render(<MortalityDetailPage recordId="rec-1" />);
    expect(await screen.findByText("2026. október 5.")).toBeTruthy();
    expect(screen.getByText("JOBB 1. oszlop")).toBeTruthy();
  });

  it("akvárium nélkül a rack a fejlécben és a sorában, az akvárium sor jelzi", async () => {
    api.detail.mockResolvedValue({
      ...DETAIL,
      aquarium: null,
      location: RACKS[2],
    });
    render(<MortalityDetailPage recordId="rec-1" />);
    expect(await screen.findByText("Nincs megadva (halas rack)")).toBeTruthy();
    expect(screen.getAllByText("Rákos 1").length).toBe(2);
  });

  it("rack nélkül „Nincs megadva”", async () => {
    render(<MortalityDetailPage recordId="rec-1" />);
    expect(await screen.findByText("Nincs megadva")).toBeTruthy();
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
    occurredOn: "2026-10-05",
    locationId: "",
  };
  const TODAY = "2026-10-07";

  it("a beküldött bemenet a szerver alakjában", () => {
    expect(mortalityFormInput(filled, TODAY)).toEqual({
      input: {
        productId: "p1",
        productName: null,
        quantity: 2,
        aquariumId: "a1",
        sourceType: "TRADE",
        supplierId: null,
        sourceNote: "Béla",
        note: null,
        occurredOn: "2026-10-05",
        locationId: null,
      },
    });
  });

  it("az elhullás napja kötelező, és nem lehet a jövőben; a mai nap jó", () => {
    expect(mortalityFormInput({ ...filled, occurredOn: "" }, TODAY)).toEqual({
      problem: "Add meg az elhullás napját.",
    });
    expect(
      mortalityFormInput({ ...filled, occurredOn: "2026-10-08" }, TODAY),
    ).toEqual({ problem: "Az elhullás napja nem lehet a jövőben." });
    expect(
      mortalityFormInput({ ...filled, occurredOn: TODAY }, TODAY),
    ).toMatchObject({ input: { occurredOn: TODAY } });
  });

  it("akvárium VAGY halas rack kell: egyik nélkül sem megy, csak rackkel igen", () => {
    expect(
      mortalityFormInput({ ...filled, aquariumId: "", locationId: "" }, TODAY),
    ).toEqual({ problem: MORTALITY_PLACE_REQUIRED });
    expect(
      mortalityFormInput(
        { ...filled, aquariumId: "", locationId: "r1" },
        TODAY,
      ),
    ).toMatchObject({ input: { aquariumId: null, locationId: "r1" } });
  });

  it("csak halas rackkel menthető: az akvárium elhagyható, a rack megy el", async () => {
    api.productOptions.mockResolvedValue([
      { id: "p1", name: "Zebrasoma flavescens", commonName: null },
    ]);
    api.create.mockResolvedValue(DETAIL);
    render(<MortalityFormPage />);
    const input = await screen.findByRole("textbox", { name: "Élőlény" });
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("button", { name: /Zebrasoma flavescens/ }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Forrás típusa" }), {
      target: { value: "TRADE" },
    });
    // egyik helyszín sincs: magyar mondat, nincs küldés
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés mentése" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      MORTALITY_PLACE_REQUIRED,
    );
    expect(api.create).not.toHaveBeenCalled();

    await screen.findByRole("option", { name: "Rákos 1" });
    fireEvent.change(screen.getByRole("combobox", { name: "Halas rack" }), {
      target: { value: "r3" },
    });
    expect(screen.getByText("Halas racknél elhagyható.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés mentése" }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1]).toMatchObject({
      aquariumId: null,
      locationId: "r3",
    });
  });

  it("a választott halas rack az azonosítójával megy", () => {
    expect(
      mortalityFormInput({ ...filled, locationId: "r2" }, TODAY),
    ).toMatchObject({ input: { locationId: "r2" } });
  });

  it("új bejegyzésnél a nap a mai, a rack választható, és mindkettő elmegy", async () => {
    api.productOptions.mockResolvedValue([
      { id: "p1", name: "Zebrasoma flavescens", commonName: null },
    ]);
    api.create.mockResolvedValue(DETAIL);
    render(<MortalityFormPage />);
    const day = (await screen.findByLabelText(
      "Elhullás napja",
    )) as HTMLInputElement;
    const today = budapestDay(new Date());
    expect(day.value).toBe(today);
    expect(day.max).toBe(today);
    fireEvent.change(day, { target: { value: "2026-10-01" } });
    await screen.findByRole("option", { name: "JOBB 1. oszlop" });
    fireEvent.change(screen.getByRole("combobox", { name: "Halas rack" }), {
      target: { value: "r2" },
    });
    const input = screen.getByRole("textbox", { name: "Élőlény" });
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("button", { name: /Zebrasoma flavescens/ }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Akvárium" }), {
      target: { value: "a1" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Forrás típusa" }), {
      target: { value: "TRADE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés mentése" }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1]).toMatchObject({
      productId: "p1",
      occurredOn: "2026-10-01",
      locationId: "r2",
    });
  });

  it("módosításnál a napot és a kivezetett racket is kitöltve hozza", async () => {
    api.detail.mockResolvedValue({
      ...DETAIL,
      location: { id: "old", name: "Régi rack" },
    });
    render(<MortalityFormPage recordId="rec-1" />);
    const day = (await screen.findByLabelText(
      "Elhullás napja",
    )) as HTMLInputElement;
    expect(day.value).toBe("2026-10-05");
    const rack = screen.getByRole("combobox", {
      name: "Halas rack",
    }) as HTMLSelectElement;
    expect(rack.value).toBe("old");
    expect(screen.getByRole("option", { name: "Régi rack" })).toBeTruthy();
  });

  it("a hiányzó mezők sorban", () => {
    expect(mortalityFormInput({ ...filled, product: null }, TODAY)).toEqual({
      problem: "Válaszd ki az élőlényt, vagy írd be a nevét.",
    });
    expect(mortalityFormInput({ ...filled, quantity: "0" }, TODAY)).toEqual({
      problem: "A példányszám legalább 1, egész szám.",
    });
    expect(
      mortalityFormInput({ ...filled, sourceType: "SUPPLIER" }, TODAY),
    ).toEqual({
      problem: "Válaszd ki a beszállítót, vagy írd be a nevét.",
    });
    expect(
      mortalityFormInput(
        { ...filled, sourceType: "OTHER", sourceNote: " " },
        TODAY,
      ),
    ).toEqual({
      problem: "Az „Egyéb” forrásnál nevezd meg, honnan érkezett.",
    });
  });

  it("beszállítónál a megnevezés nem megy el", () => {
    const result = mortalityFormInput(
      {
        ...filled,
        sourceType: "SUPPLIER",
        supplier: { id: "s1", title: "TMC" },
      },
      TODAY,
    );
    expect(result).toMatchObject({
      input: { supplierId: "s1", sourceNote: null },
    });
  });

  it("a beírt élőlény és beszállító a szabad szöveges mezőbe megy, nem az azonosítóba", () => {
    expect(
      mortalityFormInput(
        {
          ...filled,
          product: freeTextOption(" Ismeretlen gébféle ", 200),
          sourceType: "SUPPLIER",
          supplier: freeTextOption("Kis Pál", 200),
        },
        TODAY,
      ),
    ).toMatchObject({
      input: {
        productId: null,
        productName: "Ismeretlen gébféle",
        supplierId: null,
        sourceNote: "Kis Pál",
      },
    });
  });

  it("a választóban a beírt név is választható, ha nincs a listában", async () => {
    api.productOptions.mockResolvedValue([]);
    api.aquariumOptions.mockResolvedValue([
      { id: "a1", name: "Tengeri halak", aquariumNumber: "A-12" },
    ]);
    render(<MortalityFormPage />);
    const input = await screen.findByRole("textbox", { name: "Élőlény" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ismeretlen gébféle" } });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /„Ismeretlen gébféle” megadása/,
      }),
    );
    expect(screen.getByText("Ismeretlen gébféle")).toBeTruthy();
    expect(screen.getByText("nincs a rendszerben")).toBeTruthy();
  });

  it("szabad szöveges élőlény módosításnál kitöltve nyílik, és a nevet küldi", async () => {
    api.detail.mockResolvedValue({
      ...DETAIL,
      product: null,
      productName: "Ismeretlen gébféle",
      source: { type: "SUPPLIER", supplier: null, note: "Kis Pál" },
      stock: { deducted: 0, sku: null, reason: "FREE_TEXT" },
    });
    api.update.mockResolvedValue(DETAIL);
    render(<MortalityFormPage recordId="rec-1" />);
    expect(await screen.findByText("Ismeretlen gébféle")).toBeTruthy();
    expect(screen.getByText("Kis Pál")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Módosítás mentése" }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]![2]).toMatchObject({
      productId: null,
      productName: "Ismeretlen gébféle",
      supplierId: null,
      sourceNote: "Kis Pál",
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
