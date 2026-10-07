import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  QuoteCostingDto,
  QuoteDetailDto,
  QuoteInternalVersion,
  QuoteListResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dayAfter } from "./quote-format";
import { QuoteDetailPage } from "./quote-detail-page";
import { QuoteEditorPage } from "./quote-editor-page";
import { QuoteListPage } from "./quote-list-page";
import { QuoteNewPage } from "./quote-new-page";
import { QuoteSnippetsPage } from "./quote-snippets-page";

/** Az árajánlat modul képernyői (#1582 P1, Figma 35). */
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
  usePathname: () => "/ajanlatok",
  useSearchParams: () => navigation.search,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  templates: vi.fn(),
  newVersion: vi.fn(),
  updateVersion: vi.fn(),
  costing: vi.fn(),
  addBlock: vi.fn(),
  reorderBlocks: vi.fn(),
  updateBlock: vi.fn(),
  deleteBlock: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  addBomItem: vi.fn(),
  updateBomItem: vi.fn(),
  deleteBomItem: vi.fn(),
  createProductFromBomItem: vi.fn(),
  setMilestones: vi.fn(),
  insertSnippet: vi.fn(),
  snippets: vi.fn(),
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
  archiveSnippet: vi.fn(),
}));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: api }));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));

const auth = vi.hoisted(() => ({ role: "ADMIN" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Balázs",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const LIST: QuoteListResponse = {
  items: [
    {
      id: "q1",
      quoteNumber: "AJ-2026-0042",
      title: "180 cm-es irodai bemutató akvárium",
      status: "SENT",
      customerId: "c1",
      ownerUserId: null,
      customerName: "Blue Office Kft.",
      createdByName: "Balázs",
      createdAt: "2026-10-07T10:00:00Z",
      updatedAt: "2026-10-07T10:00:00Z",
      latestVersion: {
        id: "v2",
        versionNumber: 2,
        status: "DRAFT",
        validUntil: "2026-11-06",
        currency: "HUF",
        priceDisplay: "NET",
        publishedAt: null,
        netTotal: "4860000.0000",
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};

function version(
  over: Partial<QuoteInternalVersion> = {},
): QuoteInternalVersion {
  return {
    id: "v2",
    versionNumber: 2,
    status: "DRAFT",
    validUntil: "2026-11-06",
    currency: "HUF",
    priceDisplay: "NET",
    customerSnapshot: null,
    templateId: null,
    createdFromVersionId: null,
    publishedAt: null,
    netTotal: "53000.0000",
    optionalNetTotal: "7.0000",
    milestones: [],
    blocks: [
      {
        id: "b1",
        position: 0,
        kind: "SECTION",
        title: "Akvárium és bútor",
        content: null,
        keepWithNext: false,
        startOnNewPage: false,
        sourceSnippetId: null,
        items: [
          {
            id: "i1",
            position: 0,
            name: "Egyedi szűrő",
            description: null,
            quantity: "1",
            unit: "db",
            unitNetPrice: "50000",
            vatRatePercent: "27",
            isOptional: false,
            source: "BOM",
            variantId: null,
            variantLabel: null,
          },
        ],
      },
    ],
    bomItems: [
      {
        id: "bom1",
        quoteItemId: "i1",
        position: 0,
        kind: "CUSTOM",
        variantId: null,
        variantLabel: null,
        customName: "Szűrőház",
        quantity: "1",
        unit: "db",
        createdProductVariantId: null,
      },
    ],
    ...over,
  };
}

function quote(versions: QuoteInternalVersion[]): QuoteDetailDto {
  return {
    audience: "internal",
    id: "q1",
    quoteNumber: "AJ-2026-0042",
    title: "180 cm-es irodai bemutató akvárium",
    status: "SENT",
    customerId: "c1",
    ownerUserId: null,
    createdById: "u",
    customerName: "Blue Office Kft.",
    ownerName: null,
    createdByName: "Balázs",
    createdAt: "2026-10-07T10:00:00Z",
    updatedAt: "2026-10-07T10:00:00Z",
    versions,
    events: [],
  };
}

const COSTING: QuoteCostingDto = {
  versionId: "v2",
  currency: "HUF",
  lines: [],
  totals: {
    net: "53000.0000",
    cost: "20000.0000",
    costComplete: true,
    marginAmount: "33000.0000",
    marginPercent: "62.26",
  },
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = new URLSearchParams();
  auth.role = "ADMIN";
  api.list.mockResolvedValue(LIST);
  api.snippets.mockResolvedValue([]);
  api.templates.mockResolvedValue([]);
  api.costing.mockResolvedValue(COSTING);
});

describe("Árajánlatok lista (567:2)", () => {
  it("a sorban a partner, a nettó összeg, az állapot és a készítő áll", async () => {
    render(<QuoteListPage />);
    const row = (await screen.findByText("AJ-2026-0042")).closest("tr")!;
    expect(within(row).getByText("Blue Office Kft.")).toBeTruthy();
    expect(within(row).getByText(/4\s860\s000 Ft/)).toBeTruthy();
    expect(within(row).getByText("Kiküldve")).toBeTruthy();
    expect(within(row).getByText("Balázs")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Új árajánlat" })).toBeTruthy();
  });

  it("a sor az ajánlat adatlapjára visz", async () => {
    render(<QuoteListPage />);
    fireEvent.click(await screen.findByText("AJ-2026-0042"));
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });

  it("quotes.view nélkül nincs lekérés, csak a jogosultsági üzenet", () => {
    auth.role = "VIEWER";
    render(<QuoteListPage />);
    expect(
      screen.getByText("Nincs hozzáférésed az árajánlatokhoz"),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("Új árajánlat (567:190)", () => {
  it("partner és cím nélkül nem küldhető; a sablon érvényessége átjön", async () => {
    customers.list.mockResolvedValue({
      items: [{ id: "c1", displayName: "Blue Office Kft." }],
      total: 1,
    });
    api.templates.mockResolvedValue([
      {
        id: "t1",
        name: "Komplett kivitelezés",
        priceDisplay: "NET",
        defaultValidityDays: 60,
      },
    ]);
    api.create.mockResolvedValue({ id: "q9" });
    render(<QuoteNewPage />);
    const submit = screen.getByRole("button", { name: "Ajánlat létrehozása" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    // a cím önmagában kevés: partner nélkül sem küldhető
    fireEvent.change(screen.getByLabelText("Ajánlat címe"), {
      target: { value: "Irodai akvárium" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Partner keresése"), {
      target: { value: "Blue" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Blue Office Kft." }),
    );
    fireEvent.change(screen.getByLabelText("Ajánlat címe"), {
      target: { value: "Irodai akvárium" },
    });
    await screen.findByRole("option", { name: "Komplett kivitelezés" });
    fireEvent.change(screen.getByLabelText("Sablon"), {
      target: { value: "t1" },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1]).toEqual({
      title: "Irodai akvárium",
      customerId: "c1",
      validUntil: dayAfter(60),
      currency: "HUF",
      templateId: "t1",
    });
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q9/szerkesztes");
  });
});

describe("Ajánlat adatlap (569:504)", () => {
  it("piszkozattal a Szerkesztés, csak publikálttal az Új verzió jelenik meg", async () => {
    api.detail.mockResolvedValue(
      quote([
        version({
          id: "v1",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-10-07T10:42:00Z",
        }),
      ]),
    );
    api.newVersion.mockResolvedValue(quote([]));
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Új verzió" }));
    await waitFor(() =>
      expect(api.newVersion).toHaveBeenCalledWith("token-1", "q1"),
    );
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1/szerkesztes");
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
  });
});

describe("Ajánlat szerkesztő (569:171)", () => {
  it("piszkozat nélkül nem szerkeszt, és nem kér kalkulációt", async () => {
    api.detail.mockResolvedValue(quote([version({ status: "PUBLISHED" })]));
    render(<QuoteEditorPage quoteId="q1" />);
    expect(
      await screen.findByText("Nincs szerkeszthető piszkozat"),
    ).toBeTruthy();
    expect(api.costing).not.toHaveBeenCalled();
  });

  it("költségjoggal a belső kalkuláció látszik, anélkül le sem kéri", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    const { unmount } = render(<QuoteEditorPage quoteId="q1" />);
    expect(await screen.findByText("Belső kalkuláció")).toBeTruthy();
    expect(await screen.findByText(/33\s000 Ft · 62.26%/)).toBeTruthy();
    unmount();

    vi.clearAllMocks();
    auth.role = "SALES";
    api.detail.mockResolvedValue(quote([version()]));
    api.snippets.mockResolvedValue([]);
    render(<QuoteEditorPage quoteId="q1" />);
    await screen.findByText("BOM / belső összetevők");
    expect(screen.queryByText("Belső kalkuláció")).toBeNull();
    expect(api.costing).not.toHaveBeenCalled();
  });

  it("új blokk: a szöveges blokk üres dokumentummal, a fejezet szöveg nélkül jön létre", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.addBlock.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Szöveg" }));
    await waitFor(() => expect(api.addBlock).toHaveBeenCalledTimes(1));
    expect(api.addBlock.mock.calls[0]![3]).toEqual({
      kind: "TEXT",
      title: "Szöveg",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fejezet" }));
    await waitFor(() => expect(api.addBlock).toHaveBeenCalledTimes(2));
    expect(api.addBlock.mock.calls[1]![3]).toEqual({
      kind: "SECTION",
      title: "Fejezet",
    });
    expect(
      (screen.getByRole("button", { name: "Kép" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("új tétel: önálló forrással, üres magyarázó szöveg nélkül megy", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.addItem.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
    );
    fireEvent.change(screen.getByLabelText("Megnevezés"), {
      target: { value: "Szerelés" },
    });
    fireEvent.change(screen.getByLabelText("Nettó egységár"), {
      target: { value: "120000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.addItem).toHaveBeenCalled());
    expect(api.addItem.mock.calls[0]!.slice(1)).toEqual([
      "q1",
      "v2",
      "b1",
      {
        source: "STANDALONE",
        variantId: null,
        name: "Szerelés",
        description: null,
        quantity: "1",
        unit: "db",
        unitNetPrice: "120000",
        vatRatePercent: "27",
        isOptional: false,
      },
    ]);
  });

  it("BOM: termékké alakítás csak products.manage mellett; költségmező csak költségjoggal", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.createProductFromBomItem.mockResolvedValue({
      product: { productId: "p", variantId: "pv", sku: "ACR-L-000001" },
      quote: quote([version()]),
    });
    const { unmount } = render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Egyedi szűrő: BOM" }),
    );
    fireEvent.change(screen.getByLabelText("Fajta"), {
      target: { value: "CUSTOM" },
    });
    expect(screen.getByLabelText("BOM egységköltség")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Szűrőház: termékké alakítás" }),
    );
    // the catalog write asks first (barracuda's #1596 review)
    expect(api.createProductFromBomItem).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Új helyi termék jön létre »Szűrőház« néven/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.createProductFromBomItem).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Szűrőház: termékké alakítás" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Termék létrehozása" }));
    await waitFor(() =>
      expect(api.createProductFromBomItem).toHaveBeenCalledWith(
        "token-1",
        "bom1",
      ),
    );
    unmount();

    auth.role = "SALES";
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Egyedi szűrő: BOM" }),
    );
    expect(
      screen.queryByRole("button", { name: "Szűrőház: termékké alakítás" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Fajta"), {
      target: { value: "SERVICE" },
    });
    expect(screen.queryByLabelText("BOM egységköltség")).toBeNull();
  });
});

describe("Törlés csak kérdés után", () => {
  it("a blokk törlése előbb kérdez, és csak a megerősítés után hív", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.deleteBlock.mockResolvedValue(quote([version({ blocks: [] })]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Fejezet: törlés" }),
    );
    expect(api.deleteBlock).not.toHaveBeenCalled();
    expect(screen.getByText("Fejezet törlése")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await waitFor(() =>
      expect(api.deleteBlock).toHaveBeenCalledWith("token-1", "q1", "v2", "b1"),
    );
  });

  it("a BOM-sor törlése is kérdez; a Mégsem nem töröl", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Egyedi szűrő: BOM" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Szűrőház: törlés" }));
    expect(screen.getByText("Szűrőház törlése")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));
    expect(api.deleteBomItem).not.toHaveBeenCalled();
  });
});

describe("Mentetlen blokkszöveg", () => {
  it("tiszta állapotban az adatlap gomb azonnal visz", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Ajánlat adatlapja" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });

  it("mentetlen címmel előbb kérdez, és csak megerősítés után visz", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajánlat adatlapja" }));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByText(/1 blokk szövege még nincs mentve/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Elmegyek mentés nélkül" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });
});

describe("Ajánlat szövegrészletek (Beállítások)", () => {
  it("quotes.templates.manage nélkül nem kér le semmit", () => {
    auth.role = "SALES";
    render(<QuoteSnippetsPage />);
    expect(
      screen.getByText("Nincs hozzáférésed az ajánlati szövegrészletekhez"),
    ).toBeTruthy();
    expect(api.snippets).not.toHaveBeenCalled();
  });

  it("fizetési feltétel mérföldkövekkel jön létre", async () => {
    api.createSnippet.mockResolvedValue({});
    render(<QuoteSnippetsPage />);
    await screen.findByText("Még nincs szövegrészlet");
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Előleg" },
    });
    fireEvent.change(screen.getByLabelText("Fajta"), {
      target: { value: "PAYMENT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Mérföldkő" }));
    fireEvent.change(screen.getByLabelText("1. mérföldkő neve"), {
      target: { value: "Teljes" },
    });
    fireEvent.change(screen.getByLabelText("1. mérföldkő százaléka"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.createSnippet).toHaveBeenCalled());
    expect(api.createSnippet.mock.calls[0]![1]).toEqual({
      name: "Előleg",
      kind: "PAYMENT",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      milestones: [{ label: "Teljes", percent: "100" }],
    });
  });
});
