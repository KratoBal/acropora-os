import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  QuoteCostingDto,
  QuoteHandoffPlanDto,
  QuoteDetailDto,
  QuoteInternalVersion,
  QuoteListResponse,
  Session,
  Permission,
  UserRole,
} from "@acropora/types";
import { CUSTOMER_LIST_PAGE_SIZE } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { dayAfter } from "./quote-format";
import { QuoteDetailPage } from "./quote-detail-page";
import { QuoteEditorPage } from "./quote-editor-page";
import { QuoteListPage } from "./quote-list-page";
import { QuoteNewPage } from "./quote-new-page";
import { QuotePdfPage } from "./quote-pdf-page";
import { QuoteSnippetsPage } from "./quote-snippets-page";
import { QuoteTemplateEditorPage } from "./quote-template-editor-page";
import { QuoteTemplatesPage } from "./quote-templates-page";

/** Az árajánlat modul képernyői (#1582 P1, Figma 35). */

/*
  A "TOVÁBBIAK" MENÜ MÖGÖTT ÁLLÓ MŰVELETEK (Picasso 3.4, acrobot 61933): az Elutasítás, a Halasztás, a Visszavonás, a Másolat,
  a Cím szerkesztése és a Partner cseréje a lenyíló menüben van. A zárt menü gombjai nem látszanak a szerepkör-lekérdezésnek,
  ezért ezek a segédek nyitják le előbb. A HIÁNY-állítás is lenyitja a menüt: zárt menünél egy `toBeNull` üresen igaz lenne.
*/
function openMoreMenu(): void {
  const trigger = screen.queryByRole("button", { name: "Továbbiak" });
  if (trigger && trigger.getAttribute("aria-expanded") !== "true")
    fireEvent.click(trigger);
}
async function moreItem(name: string): Promise<HTMLElement> {
  await screen.findByRole("button", { name: "Továbbiak" });
  openMoreMenu();
  return screen.findByRole("button", { name });
}
function queryMoreItem(name: string): HTMLElement | null {
  openMoreMenu();
  return screen.queryByRole("button", { name });
}

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
  deleteDraft: vi.fn(),
  copyAsNew: vi.fn(),
  updateHeader: vi.fn(),
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
  publish: vi.fn(),
  accept: vi.fn(),
  revokeAcceptance: vi.fn(),
  reject: vi.fn(),
  postpone: vi.fn(),
  cancel: vi.fn(),
  templateList: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  archiveTemplate: vi.fn(),
  sendDraft: vi.fn(),
  send: vi.fn(),
  resend: vi.fn(),
  pdf: vi.fn(),
  // P4b: no live link unless a test says so
  acceptanceLink: vi.fn(async () => ({ link: null })),
  issueAcceptanceLink: vi.fn(),
  revokeAcceptanceLink: vi.fn(),
  handoffPreview: vi.fn(),
  handoff: vi.fn(),
  proformaDraft: vi.fn(),
  variantListPrice: vi.fn(),
}));
vi.mock("@/lib/api/quotes", () => ({ quotesApi: api }));
const products = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/api/products", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/products")>()),
  productApi: products,
}));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));

const auth = vi.hoisted(() => ({
  role: "ADMIN" as UserRole,
  // per-user permissions (undefined: the role's own set)
  permissions: undefined as Permission[] | undefined,
}));
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
        ...(auth.permissions ? { permissions: auth.permissions } : {}),
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
      isExpired: false,
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
    proformas: [],
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

function quote(
  versions: QuoteInternalVersion[],
  over: Partial<QuoteDetailDto> = {},
): QuoteDetailDto {
  return {
    audience: "internal",
    id: "q1",
    quoteNumber: "AJ-2026-0042",
    title: "180 cm-es irodai bemutató akvárium",
    status: "SENT",
    closeReason: null,
    closeNote: null,
    postponedUntil: null,
    acceptedVersionId: null,
    acceptances: [],
    deliveries: [],
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
    ...over,
  } as QuoteDetailDto;
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
  auth.permissions = undefined;
  api.list.mockResolvedValue(LIST);
  api.snippets.mockResolvedValue([]);
  api.templates.mockResolvedValue([]);
  api.costing.mockResolvedValue(COSTING);
});

describe("Lejárt ajánlat és szűrők (P8)", () => {
  it("a lejárt ajánlat jelölést kap, és a szűrők az URL-ből a lekérésbe mennek", async () => {
    navigation.search = new URLSearchParams("expired=1&closeReason=PRICE");
    api.list.mockResolvedValue({
      ...LIST,
      items: [{ ...LIST.items[0]!, isExpired: true }],
    });
    render(<QuoteListPage />);
    const row = (await screen.findByText("AJ-2026-0042")).closest("tr")!;
    const query = String(api.list.mock.calls[0]?.[1]);
    expect(
      [
        within(row).queryByText("Lejárt") !== null,
        query.includes("expired=1"),
        query.includes("closeReason=PRICE"),
        (screen.getByLabelText("Csak a lejártak") as HTMLInputElement).checked,
      ],
      "WEB-EXPIRED-LIST",
    ).toEqual([true, true, true, true]);
  });
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

  /* Luca (kártya 7e5d3658): Készítve oszlop, szűrés a készítés napjára; Balázs (kártya 2f6369a4): rendezés az oszlopfejre kattintva */
  it("a Készítve oszlop a létrehozás BUDAPESTI napját mutatja, nem az UTC dátumot", async () => {
    api.list.mockResolvedValue({
      ...LIST,
      items: [
        { ...LIST.items[0]! },
        {
          ...LIST.items[0]!,
          id: "q-late",
          quoteNumber: "AJ-2026-0099",
          // 22:30 UTC = 00:30 on the 8th in Budapest (summer time)
          createdAt: "2026-10-07T22:30:00Z",
        },
      ],
    });
    render(<QuoteListPage />);
    const early = (await screen.findByText("AJ-2026-0042")).closest("tr")!;
    const late = screen.getByText("AJ-2026-0099").closest("tr")!;
    expect(within(early).getByText("2026. 10. 07.")).toBeTruthy();
    expect(within(late).getByText("2026. 10. 08.")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Készítve/ })).toBeTruthy();
  });

  it("a készítés napja és a rendezés az URL-ből a lekérésbe megy", async () => {
    navigation.search = new URLSearchParams(
      "createdFrom=2026-10-01&createdTo=2026-10-31&sort=createdAt&direction=desc",
    );
    render(<QuoteListPage />);
    await screen.findByText("AJ-2026-0042");
    const query = new URLSearchParams(String(api.list.mock.calls[0]?.[1]));
    expect(query.get("createdFrom")).toBe("2026-10-01");
    expect(query.get("createdTo")).toBe("2026-10-31");
    expect(query.get("sort")).toBe("createdAt");
    expect(query.get("direction")).toBe("desc");
  });

  it("a dátum beírása az URL-be írja a szűrőt, és a lapot nullázza", async () => {
    navigation.search = new URLSearchParams("page=3");
    render(<QuoteListPage />);
    await screen.findByText("AJ-2026-0042");
    fireEvent.change(screen.getByLabelText("Készítve ettől a naptól"), {
      target: { value: "2026-10-01" },
    });
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(target).toContain("createdFrom=2026-10-01");
    expect(target).not.toContain("page=");
  });

  it("a Készítve fejlécre kattintva növekvő, majd csökkenő, végül alap rendezés jön, és a lap nullázódik", async () => {
    navigation.search = new URLSearchParams("page=2");
    const view = render(<QuoteListPage />);
    await screen.findByText("AJ-2026-0042");
    fireEvent.click(screen.getByRole("button", { name: /Készítve/ }));
    const first = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(first).toContain("sort=createdAt");
    expect(first).toContain("direction=asc");
    expect(first).not.toContain("page=");
    view.unmount();

    navigation.search = new URLSearchParams("sort=createdAt&direction=asc");
    render(<QuoteListPage />);
    await screen.findByText("AJ-2026-0042");
    fireEvent.click(screen.getByRole("button", { name: /Készítve/ }));
    expect(String(navigation.replace.mock.calls.at(-1)?.[0])).toContain(
      "direction=desc",
    );
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
    expect(submit).toHaveAttribute("aria-disabled", "true");
    // a cím önmagában kevés: partner nélkül sem küldhető (a halvány gomb kattintható, de nem küld)
    fireEvent.change(screen.getByLabelText("Ajánlat címe"), {
      target: { value: "Irodai akvárium" },
    });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(api.create).not.toHaveBeenCalled();

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
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q9/szerkesztes"),
    );
  });

  /*
    Balázs on stage, 2026-10-08: the search listed nothing, because it asked
    for 8 rows and the API's lower bound is 10 (a 400, swallowed). The fake
    answers like the API's query validation does.
  */
  it("a partnerkereső az API határán belüli lapméretet kér, és talál", async () => {
    customers.list.mockImplementation(
      (_token: string, query: URLSearchParams) => {
        const size = Number(query.get("pageSize"));
        return size < CUSTOMER_LIST_PAGE_SIZE.min ||
          size > CUSTOMER_LIST_PAGE_SIZE.max
          ? Promise.reject(
              new Error(
                `pageSize must not be less than ${CUSTOMER_LIST_PAGE_SIZE.min}`,
              ),
            )
          : Promise.resolve({
              items: [{ id: "c1", displayName: "Blue Office Kft." }],
              total: 1,
            });
      },
    );
    api.templates.mockResolvedValue([]);
    render(<QuoteNewPage />);
    fireEvent.change(screen.getByLabelText("Partner keresése"), {
      target: { value: "Blue" },
    });
    expect(
      await screen.findByRole("button", { name: "Blue Office Kft." }),
    ).toBeTruthy();
  });

  it("a sikertelen keresés hibát mutat, nem üres listát", async () => {
    customers.list.mockRejectedValue(new Error("A szerver nem válaszolt."));
    api.templates.mockResolvedValue([]);
    render(<QuoteNewPage />);
    fireEvent.change(screen.getByLabelText("Partner keresése"), {
      target: { value: "Blue" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "A szerver nem válaszolt.",
    );
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
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1/szerkesztes"),
    );
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
  });
});

/*
  AZ AJÁNLAT ADATLAP MŰVELETEI (Picasso 3.4, acrobot 61933): nyolc egyforma gomb helyett EGY elsődleges (Szerkesztés vagy Új
  verzió), mellette a Kiküldés/Újraküldés, ahol van publikált verzió; a ritkább műveletek a "Továbbiak" menüben; a Törlés
  elkülönítve, az oldal alján, piros gombbal és megerősítéssel. MI PIROSÍT: ha egy ritka művelet kikerül a menüből a sorba; ha
  a Törlés bekerül a menübe; ha a veszélyes menüpont nem piros; ha a menü nem zárul Escape-re; ha a verziók sora újra magas.
*/
describe("Ajánlat adatlap: egy elsődleges gomb, a többi a Továbbiak mögött (3.4)", () => {
  const draftOnly = () =>
    quote([version({ id: "v1", versionNumber: 1, status: "DRAFT" })], {
      status: "DRAFT",
    });
  const published = () =>
    quote(
      [
        version({
          id: "v1",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-10-07T10:42:00Z",
        }),
      ],
      { status: "SENT" },
    );
  const MOVED = [
    "Elutasítás",
    "Halasztás",
    "Visszavonás",
    "Másolat új ajánlatként",
    "Cím szerkesztése",
    "Partner cseréje",
  ];

  it("a draft shows Szerkesztés and Továbbiak in the row, and none of the rare actions until the menu opens", async () => {
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    expect(
      await screen.findByRole("button", { name: "Szerkesztés" }),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Továbbiak" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    for (const name of MOVED)
      expect(screen.queryByRole("button", { name })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    for (const name of MOVED)
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("the send sits next to the primary button on a published quote, not in the menu", async () => {
    api.detail.mockResolvedValue(published());
    render(<QuoteDetailPage quoteId="q1" />);
    const send = await screen.findByRole("button", { name: "Kiküldés" });
    const trigger = screen.getByRole("button", { name: "Továbbiak" });
    const group = document.getElementById(
      trigger.getAttribute("aria-controls") ?? "",
    );
    expect(group).not.toBeNull();
    expect(group!.contains(send)).toBe(false);
    expect(
      screen.getByRole("button", { name: "Új verzió" }),
    ).toBeInTheDocument();
  });

  // the primary button is the filled one; the secondary ones are not (PilotButton variants)
  const isPrimary = (name: string) =>
    screen
      .getByRole("button", { name })
      .className.includes("bg-pilot-aqua-600");

  it("with a published version the Kiküldés is the primary button and Új verzió is secondary (acrobot 61941)", async () => {
    api.detail.mockResolvedValue(published());
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Kiküldés" });
    expect(isPrimary("Kiküldés")).toBe(true);
    expect(isPrimary("Új verzió")).toBe(false);
  });

  it("a draft the user can publish: Publikálás is primary and asks first, Szerkesztés is secondary", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.publish.mockResolvedValue(
      quote(
        [
          version({
            id: "v1",
            versionNumber: 1,
            status: "PUBLISHED",
            publishedAt: "2026-10-07T10:42:00Z",
          }),
        ],
        { status: "DRAFT" },
      ),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Publikálás" });
    expect(isPrimary("Publikálás")).toBe(true);
    expect(isPrimary("Szerkesztés")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Publikálás" }));
    const dialog = await screen.findByRole("dialog");
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publikálás" }));
    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith("token-1", "q1", "v1"),
    );
    // the page now offers the send, the step after the publish
    expect(
      await screen.findByRole("button", { name: "Kiküldés" }),
    ).toBeInTheDocument();
  });

  it("without the publish permission the Szerkesztés stays the primary button and there is no Publikálás", async () => {
    auth.permissions = ["quotes.view", "quotes.manage"] as Permission[];
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Szerkesztés" });
    expect(isPrimary("Szerkesztés")).toBe(true);
    expect(screen.queryByRole("button", { name: "Publikálás" })).toBeNull();
  });

  it("Elutasítás and Visszavonás are red in the menu, Halasztás is not", async () => {
    api.detail.mockResolvedValue(published());
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Továbbiak" }));
    const red = (name: string) =>
      screen
        .getByRole("button", { name })
        .className.includes("text-pilot-red-700");
    expect(red("Elutasítás")).toBe(true);
    expect(red("Visszavonás")).toBe(true);
    expect(red("Halasztás")).toBe(false);
  });

  it("choosing an item closes the menu and opens its dialog; Escape closes without choosing", async () => {
    api.detail.mockResolvedValue(published());
    render(<QuoteDetailPage quoteId="q1" />);
    const trigger = await screen.findByRole("button", { name: "Továbbiak" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Elutasítás" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("the Törlés is NOT in the menu: it is its own card at the bottom, red, and still asks first", async () => {
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    const del = await screen.findByRole("button", { name: "Törlés" });
    fireEvent.click(screen.getByRole("button", { name: "Továbbiak" }));
    const group = screen.getByRole("group", { name: "További műveletek" });
    expect(group.contains(del)).toBe(false);
    // the card comes after the versions table in the page
    const versions = screen.getByText("Verziók");
    expect(
      versions.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(del);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Törlés" })).toBeTruthy();
    expect(api.deleteDraft).not.toHaveBeenCalled();
  });

  it("a published quote has no Törlés card at all", async () => {
    api.detail.mockResolvedValue(published());
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Új verzió" });
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
  });

  it("the versions table rows are the dense ones", async () => {
    api.detail.mockResolvedValue(published());
    const { container } = render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Új verzió" });
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain("md:h-[44px]");
      expect(row.className).not.toContain("md:h-[72px]");
    }
  });
});

/*
  A TERVEZET TÖRLÉSE ÉS A LEZÁRT AJÁNLAT MÁSOLATA (Luca, kártya 5937bdf2).
  MI PIROSÍT: ha a Törlés megerősítés nélkül törölne; ha publikált vagy küldött
  ajánlaton megjelenne a Törlés; ha nyitott ajánlaton megjelenne a másolat; ha
  a másolat gombja a régi ajánlatra és nem az újra vinne; ha a szerver 409-ét
  elnyelné.
*/
describe("Tervezet törlése és másolat (5937bdf2)", () => {
  const draftOnly = () =>
    quote([version({ id: "v1", versionNumber: 1, status: "DRAFT" })], {
      status: "DRAFT",
    });

  it("a never-published draft: Törlés asks first, then deletes and goes back to the list", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.deleteDraft.mockResolvedValue({
      id: "q1",
      quoteNumber: "AJ-2026-0042",
    });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Törlés" }));
    expect(api.deleteDraft).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Törlés" }));
    await waitFor(() =>
      expect(api.deleteDraft).toHaveBeenCalledWith("token-1", "q1"),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/ajanlatok"),
    );
  });

  it("a server refusal is shown and nothing navigates", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.deleteDraft.mockRejectedValue(
      new ApiError(
        "Küldött vagy elfogadásra kiadott ajánlat nem törölhető; lemondható.",
        409,
      ),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Törlés" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Törlés" }));
    expect(await screen.findByText(/nem törölhető; lemondható/)).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  // card 534b2de4 (Luca): an open quote can be copied too; it still has no Törlés
  it("a published or sent quote has no Törlés, but has the copy button", async () => {
    api.detail.mockResolvedValue(
      quote([version({ id: "v1", versionNumber: 1, status: "PUBLISHED" })]),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Új verzió" });
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    expect(queryMoreItem("Másolat új ajánlatként")!).toBeTruthy();
  });

  it("an open quote: Másolat új ajánlatként creates the copy, opens the NEW quote, and leaves the open one alone", async () => {
    api.detail.mockResolvedValue(
      quote([version({ id: "v1", versionNumber: 1, status: "PUBLISHED" })], {
        status: "SENT",
      }),
    );
    api.copyAsNew.mockResolvedValue({ id: "q9", quoteNumber: "AJ-2026-0099" });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Másolat új ajánlatként"));
    await waitFor(() =>
      expect(api.copyAsNew).toHaveBeenCalledWith("token-1", "q1"),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q9"),
    );
  });

  it("a closed quote: Másolat új ajánlatként creates the copy and opens the NEW quote", async () => {
    api.detail.mockResolvedValue(
      quote([version({ id: "v1", versionNumber: 1, status: "PUBLISHED" })], {
        status: "CANCELLED",
      }),
    );
    api.copyAsNew.mockResolvedValue({ id: "q9", quoteNumber: "AJ-2026-0099" });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Másolat új ajánlatként"));
    await waitFor(() =>
      expect(api.copyAsNew).toHaveBeenCalledWith("token-1", "q1"),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q9"),
    );
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
  });
});

describe("Az ajánlat kimenetele (P4a)", () => {
  /** v1 published, with an offered and an optional item */
  const published = (over: Partial<QuoteInternalVersion> = {}) => {
    const base = version({
      id: "v1",
      versionNumber: 1,
      status: "PUBLISHED",
      publishedAt: "2026-10-07T10:42:00Z",
      validUntil: "2099-12-31",
      ...over,
    });
    const block = base.blocks[0]!;
    return {
      ...base,
      blocks: [
        {
          ...block,
          items: [
            ...block.items,
            {
              ...block.items[0]!,
              id: "i-opt",
              position: 1,
              name: "Opcionális fedőlap",
              isOptional: true,
            },
          ],
        },
      ],
    };
  };
  const ACCEPTANCE = {
    id: "acc1",
    versionId: "v1",
    versionNumber: 1,
    source: "PHONE" as const,
    acceptedAt: "2026-10-08",
    acceptedByName: "Kovács Anna",
    acceptedByEmail: null,
    recordedByName: "Balázs",
    selectedOptionalItemIds: ["i-opt"],
    note: null,
    createdAt: "2026-10-08T08:00:00Z",
    revokedAt: null,
    revokedByName: null,
    revokeReason: null,
  };

  it("az elfogadás a kért opcióval, egy kérés-azonosítóval megy, és dupla kattintásra is egyszer", async () => {
    api.detail.mockResolvedValue(quote([published()]));
    let answer: (value: QuoteDetailDto) => void = () => {};
    api.accept.mockReturnValue(
      new Promise<QuoteDetailDto>((resolve) => (answer = resolve)),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Elfogadás rögzítése" }),
    );
    fireEvent.change(screen.getByLabelText("Elfogadó neve"), {
      target: { value: "Kovács Anna" },
    });
    fireEvent.click(screen.getByLabelText("Opcionális fedőlap"));
    fireEvent.click(screen.getByRole("button", { name: "Rögzítem" }));
    fireEvent.click(screen.getByRole("button", { name: "Rögzítem" }));
    expect(api.accept).toHaveBeenCalledTimes(1);
    expect(api.accept).toHaveBeenCalledWith(
      "token-1",
      "q1",
      expect.objectContaining({
        versionId: "v1",
        source: "PHONE",
        acceptedAt: dayAfter(0),
        acceptedByName: "Kovács Anna",
        selectedOptionalItemIds: ["i-opt"],
        requestId: expect.any(String),
      }),
    );
    answer(
      quote([published()], {
        status: "ACCEPTED",
        acceptedVersionId: "v1",
        acceptances: [ACCEPTANCE],
      }),
    );
    expect(await screen.findByText("Opcionális fedőlap")).toBeTruthy();
    expect(screen.getByText(/v1 · 2026\. 10\. 08\. · Telefonon/)).toBeTruthy();
  });

  it("lejárt verziónál figyelmeztet, de engedi rögzíteni", async () => {
    api.detail.mockResolvedValue(
      quote([published({ validUntil: "2020-01-31" })]),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Elfogadás rögzítése" }),
    );
    expect(screen.getByText("Az ajánlat érvényessége lejárt")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Rögzítem" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("csak piszkozat mellett nincs Elfogadás rögzítése", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Szerkesztés" });
    expect(
      screen.queryByRole("button", { name: "Elfogadás rögzítése" }),
    ).toBeNull();
  });

  it("az elutasítás okot kér", async () => {
    api.detail.mockResolvedValue(quote([published()]));
    api.reject.mockResolvedValue(
      quote([published()], { status: "REJECTED", closeReason: "COMPETITOR" }),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Elutasítás"));
    const submit = screen.getByRole("button", { name: "Elutasítom" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Ok"), {
      target: { value: "COMPETITOR" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.reject).toHaveBeenCalledWith("token-1", "q1", {
        reason: "COMPETITOR",
        note: null,
      }),
    );
    expect(await screen.findByText("Versenytárs")).toBeTruthy();
  });

  it("elfogadott ajánlatnál csak a visszavonás marad, és az indoklást kér", async () => {
    api.detail.mockResolvedValue(
      quote([published()], {
        status: "ACCEPTED",
        acceptedVersionId: "v1",
        acceptances: [ACCEPTANCE],
      }),
    );
    api.revokeAcceptance.mockResolvedValue(quote([published()]));
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Elfogadás visszavonása" }),
    );
    expect(queryMoreItem("Elutasítás")).toBeNull();
    expect(screen.queryByRole("button", { name: "Új verzió" })).toBeNull();
    const submit = screen.getByRole("button", {
      name: "Visszavonom az elfogadást",
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Miért vonod vissza"), {
      target: { value: "Módosítást kért." },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.revokeAcceptance).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "acc1",
        { reason: "Módosítást kért." },
      ),
    );
  });
});

describe("Projekt indítása (P6)", () => {
  const accepted = (over: Partial<QuoteDetailDto> = {}) =>
    quote(
      [
        version({
          id: "v1",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-10-07T10:42:00Z",
        }),
      ],
      {
        status: "ACCEPTED",
        acceptedVersionId: "v1",
        acceptances: [
          {
            id: "acc1",
            versionId: "v1",
            versionNumber: 1,
            source: "PHONE",
            acceptedAt: "2026-10-08",
            acceptedByName: "Kovács Anna",
            acceptedByEmail: null,
            recordedByName: "Balázs",
            selectedOptionalItemIds: [],
            note: null,
            createdAt: "2026-10-08T08:00:00Z",
            revokedAt: null,
            revokedByName: null,
            revokeReason: null,
          },
        ],
        ...over,
      },
    );
  const plan = (hash: string, fromStock: string): QuoteHandoffPlanDto => ({
    quoteId: "q1",
    versionId: "v1",
    acceptanceId: "acc1",
    projectName: "180 cm-es irodai bemutató akvárium",
    lines: [
      {
        quoteBomItemId: "b1",
        kind: "PRODUCT",
        name: "Kitalált szivattyú",
        variantId: "var1",
        unit: "db",
        needed: "5",
        fromStock,
        shortage: String(5 - Number(fromStock)),
      },
    ],
    reservations: [
      {
        quoteBomItemId: "b1",
        stockItemId: "s1",
        variantId: "var1",
        warehouseId: "w1",
        warehouseName: "Kitalált raktár",
        quantity: fromStock,
      },
    ],
    warehouses: [{ id: "w1", name: "Kitalált raktár", excluded: false }],
    planHash: hash,
  });
  const HANDOFF = {
    projectId: "p1",
    projectNumber: "PRJ-000042",
    projectName: "180 cm-es irodai bemutató akvárium",
    executedAt: "2026-10-08T12:00:00Z",
    executedByName: "Balázs",
    materialRequestId: "mr1",
    reservationCount: 1,
  };

  it("az előnézet után a terv lenyomatával indít, és utána a projektet mutatja", async () => {
    api.detail
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted({ handoff: HANDOFF }));
    api.handoffPreview.mockResolvedValue(plan("h1", "3"));
    api.handoff.mockResolvedValue({ ...HANDOFF, replayed: false });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Projekt indítása" }),
    );
    expect(await screen.findByText("Kitalált szivattyú")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Projekt indítása" }),
    );
    expect(
      [
        await screen.findByText(/PRJ-000042/).then(Boolean),
        api.handoff.mock.calls,
      ],
      "WEB-HANDOFF-HASH",
    ).toEqual([
      true,
      [
        [
          "token-1",
          "q1",
          {
            planHash: "h1",
            excludedWarehouseIds: [],
            createProforma: false,
          },
        ],
      ],
    ]);
  });

  it("ha a készlet közben változott, új előnézetet tölt, és nem indít magától", async () => {
    api.detail.mockResolvedValue(accepted());
    api.handoffPreview
      .mockResolvedValueOnce(plan("h1", "3"))
      .mockResolvedValueOnce(plan("h2", "2"));
    api.handoff.mockRejectedValue(
      new ApiError("A készlet az előnézet óta változott.", 409),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Projekt indítása" }),
    );
    await screen.findByText("Kitalált szivattyú");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Projekt indítása",
      }),
    );
    // the notice, the second preview, and no second start: one labelled check
    await waitFor(() =>
      expect(
        [
          screen.queryByText("A készlet az előnézet óta változott.") !== null,
          api.handoffPreview.mock.calls.length,
          screen.queryByText(/: 2 · Kitalált raktár/) !== null,
          api.handoff.mock.calls.length,
        ],
        "WEB-HANDOFF-409",
      ).toEqual([true, 2, true, 1]),
    );
  });

  it("elindult projekt mellett nincs indítás és nincs elfogadás-visszavonás", async () => {
    api.detail.mockResolvedValue(accepted({ handoff: HANDOFF }));
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText(/PRJ-000042/);
    expect(
      [
        screen.queryByRole("button", { name: "Projekt indítása" }),
        screen.queryByRole("button", { name: "Elfogadás visszavonása" }),
      ],
      "WEB-HANDOFF-DONE",
    ).toEqual([null, null]);
  });
});

describe("Díjbekérő a mérföldkőből (P7)", () => {
  const MILESTONES = [
    { id: "m1", position: 0, label: "Előleg", percent: "40.00" },
    { id: "m2", position: 1, label: "Átadáskor", percent: "60.00" },
  ];
  const acceptedWith = (over: Partial<QuoteInternalVersion> = {}) =>
    quote(
      [
        version({
          id: "v1",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-10-07T10:42:00Z",
          milestones: MILESTONES,
          ...over,
        }),
      ],
      { status: "ACCEPTED", acceptedVersionId: "v1" },
    );

  it("a tizedes nélküli százalék ép marad a mérföldkő feliratán: a 60 nem lesz 6 (az API a Decimal szövegét küldi, nulla nélkül; Luca, 2026-11-17)", async () => {
    api.detail.mockResolvedValue(
      acceptedWith({
        milestones: [
          { id: "m1", position: 0, label: "Előleg", percent: "40" },
          { id: "m2", position: 1, label: "Átadáskor", percent: "60" },
          { id: "m3", position: 2, label: "Zárás", percent: "62.5" },
        ],
      }),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    expect(await screen.findByText("Előleg (40%)")).toBeInTheDocument();
    expect(screen.getByText("Átadáskor (60%)")).toBeInTheDocument();
    expect(screen.getByText("Zárás (62.5%)")).toBeInTheDocument();
  });

  it("a díjbekérő nélküli mérföldkőnél előkészít, a meglévőnél a vázlatra visz", async () => {
    api.detail.mockResolvedValue(
      acceptedWith({
        proformas: [{ milestoneId: "m2", invoiceId: "inv-2", status: "DRAFT" }],
      }),
    );
    api.proformaDraft.mockResolvedValue({ invoiceId: "inv-1", created: true });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Díjbekérő előkészítése" }),
    );
    await waitFor(() =>
      expect(
        [
          api.proformaDraft.mock.calls,
          screen
            .getByRole("link", { name: "Díjbekérő (vázlat)" })
            .getAttribute("href"),
          screen.getAllByRole("button", { name: "Díjbekérő előkészítése" })
            .length,
        ],
        "WEB-PROFORMA",
      ).toEqual([[["token-1", "q1", "m1"]], "/penzugy/szamlazas/inv-2", 1]),
    );
  });

  it("a projekt indítása alapból kéri az első mérföldkő díjbekérőjét, és kikapcsolható", async () => {
    api.detail.mockResolvedValue(acceptedWith());
    api.handoffPreview.mockResolvedValue({
      quoteId: "q1",
      versionId: "v1",
      acceptanceId: "acc1",
      projectName: "P",
      lines: [],
      reservations: [],
      warehouses: [],
      planHash: "h1",
    } satisfies QuoteHandoffPlanDto);
    api.handoff.mockResolvedValue({
      projectId: "p1",
      projectNumber: "PRJ-000043",
      projectName: "P",
      executedAt: "2026-10-08T12:00:00Z",
      executedByName: "Balázs",
      materialRequestId: null,
      reservationCount: 0,
      replayed: false,
      proforma: { invoiceId: "inv-1", skipped: null },
    });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Projekt indítása" }),
    );
    const box = (await screen.findByLabelText(
      /Díjbekérő az első mérföldkőből/,
    )) as HTMLInputElement;
    const checkedAtFirst = box.checked;
    fireEvent.click(box);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Projekt indítása",
      }),
    );
    await waitFor(() =>
      expect(
        [checkedAtFirst, api.handoff.mock.calls[0]?.[2]?.createProforma],
        "WEB-HANDOFF-PROFORMA",
      ).toEqual([true, false]),
    );
  });
});

describe("Ajánlatsablonok (579:2243, 579:2562)", () => {
  const doc = (text: string) => ({
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [{ type: "text" as const, text }],
      },
    ],
  });
  const TEMPLATE = {
    id: "t1",
    name: "Komplett akvárium kivitelezés",
    priceDisplay: "GROSS" as const,
    defaultValidityDays: 30,
    blocks: [
      {
        kind: "TEXT" as const,
        title: "Bevezető",
        content: doc("Köszönjük!"),
        keepWithNext: false,
        startOnNewPage: false,
      },
      {
        kind: "SECTION" as const,
        title: "Akvárium és bútor",
        content: null,
        keepWithNext: false,
        startOnNewPage: false,
      },
    ],
    milestones: [
      { label: "Előleg", percent: "40" },
      { label: "Telepítés", percent: "60" },
    ],
    archivedAt: null,
    updatedAt: "2026-10-08T07:00:00Z",
  };

  it("a lista kártyán mutatja a sablont, és a Másolat új sablont vesz fel", async () => {
    api.templateList.mockResolvedValue([TEMPLATE]);
    api.snippets.mockResolvedValue([]);
    api.createTemplate.mockResolvedValue({ ...TEMPLATE, id: "t2" });
    render(<QuoteTemplatesPage />);
    expect(
      await screen.findByText("Komplett akvárium kivitelezés"),
    ).toBeTruthy();
    expect(screen.getByText("2 blokk")).toBeTruthy();
    expect(screen.getByText("Bevezető · Akvárium és bútor")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Komplett akvárium kivitelezés: másolat",
      }),
    );
    await waitFor(() =>
      expect(api.createTemplate).toHaveBeenCalledWith("token-1", {
        name: "Komplett akvárium kivitelezés (másolat)",
        priceDisplay: "GROSS",
        defaultValidityDays: 30,
        blocks: TEMPLATE.blocks,
        milestones: TEMPLATE.milestones,
      }),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/beallitasok/ajanlat-sablonok/t2",
      ),
    );
  });

  it("a szerkesztő az egész sablont menti, a szöveg nélküli blokk nélkül", async () => {
    api.templateList.mockResolvedValue([TEMPLATE]);
    api.updateTemplate.mockResolvedValue({
      ...TEMPLATE,
      defaultValidityDays: 45,
    });
    render(<QuoteTemplateEditorPage templateId="t1" />);
    fireEvent.change(
      await screen.findByLabelText("Ajánlat érvényessége (nap)"),
      {
        target: { value: "45" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Sablon mentése" }));
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledTimes(1));
    expect(api.updateTemplate.mock.calls[0]![2]).toEqual({
      name: "Komplett akvárium kivitelezés",
      priceDisplay: "GROSS",
      defaultValidityDays: 45,
      blocks: [
        { kind: "TEXT", title: "Bevezető", content: doc("Köszönjük!") },
        { kind: "SECTION", title: "Akvárium és bútor", content: null },
      ],
      milestones: TEMPLATE.milestones,
    });
  });

  it("szöveg nélküli feltétel-blokkal és nem 100%-os ütemezéssel nem menthető", async () => {
    api.templateList.mockResolvedValue([TEMPLATE]);
    render(<QuoteTemplateEditorPage templateId="t1" />);
    const save = await screen.findByRole("button", { name: "Sablon mentése" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("2. mérföldkő százaléka"), {
      target: { value: "50" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("2. mérföldkő százaléka"), {
      target: { value: "60" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Új blokk fajtája"), {
      target: { value: "TERMS" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Blokk hozzáadása" }));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/a szöveg még hiányzik/)).toBeTruthy();
  });

  it("az új sablon mentés után a saját oldalára visz", async () => {
    api.createTemplate.mockResolvedValue({ ...TEMPLATE, id: "t9" });
    render(<QuoteTemplateEditorPage templateId={null} />);
    fireEvent.change(screen.getByLabelText("Sablon neve"), {
      target: { value: "Új sablon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sablon mentése" }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalled());
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/beallitasok/ajanlat-sablonok/t9",
      ),
    );
  });
});

describe("Az ajánlat kiküldése (P3)", () => {
  const published = () =>
    version({
      id: "v1",
      versionNumber: 1,
      status: "PUBLISHED",
      publishedAt: "2026-10-07T10:42:00Z",
    });
  const DRAFT = {
    source: "default" as const,
    to: ["info@blue.test"],
    subject: "Acropora árajánlat: AJ-2026-0042",
    body: "Tisztelt Blue Office Kft.!",
    fileName: "AJ-2026-0042-v1.pdf",
    alreadySent: false,
  };
  const DELIVERY = {
    id: "d1",
    versionId: "v1",
    versionNumber: 1,
    to: ["info@blue.test"],
    cc: [],
    bcc: [],
    subject: "Acropora árajánlat: AJ-2026-0042",
    outcome: "SENT" as const,
    error: null,
    isResend: false,
    redirectedTo: null,
    initiatedByName: "Balázs",
    createdAt: "2026-10-08T07:12:00Z",
  };

  it("a kitöltött vázlattal nyílik, és dupla kattintásra is egyszer küld", async () => {
    api.detail.mockResolvedValue(quote([published()], { status: "DRAFT" }));
    api.sendDraft.mockResolvedValue(DRAFT);
    let answer: (value: QuoteDetailDto) => void = () => {};
    api.send.mockReturnValue(
      new Promise<QuoteDetailDto>((resolve) => (answer = resolve)),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiküldés" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Tárgy")).toHaveValue(DRAFT.subject),
    );
    expect(screen.getByLabelText("Címzett")).toHaveValue("info@blue.test");
    fireEvent.change(screen.getByLabelText("Másolat"), {
      target: { value: "iroda@blue.test; penzugy@blue.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Elküldöm" }));
    fireEvent.click(screen.getByRole("button", { name: "Elküldöm" }));
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith("token-1", "q1", "v1", {
      requestId: expect.any(String),
      to: ["info@blue.test"],
      cc: ["iroda@blue.test", "penzugy@blue.test"],
      subject: DRAFT.subject,
      body: DRAFT.body,
    });
    answer(quote([published()], { status: "SENT", deliveries: [DELIVERY] }));
    expect(await screen.findByText("Kiment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Újraküldés" })).toBeTruthy();
  });

  it("a már kiment verziót újraküldéssel küldi, a másik végponton", async () => {
    api.detail.mockResolvedValue(
      quote([published()], { deliveries: [DELIVERY] }),
    );
    api.sendDraft.mockResolvedValue({ ...DRAFT, alreadySent: true });
    api.resend.mockResolvedValue(
      quote([published()], {
        deliveries: [{ ...DELIVERY, id: "d2", isResend: true }, DELIVERY],
      }),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Újraküldés" }));
    fireEvent.click(await screen.findByRole("button", { name: "Újraküldöm" }));
    await waitFor(() => expect(api.resend).toHaveBeenCalledTimes(1));
    expect(api.send).not.toHaveBeenCalled();
  });

  /*
    A VEVONEK NINCS E-MAILJE (Luca, 2026-11-12, kartya 7dd76d60). MI PIROSIT: ha a szurke Elkuldom mellett nem all, MIERT
    szurke; ha a figyelmeztetes nem a vevo adatlapjara visz; ha egy kitoltott cimzettnel is ott marad; ha egy vevo
    nelkuli ajanlatnal link keletkezik; ha a kezzel beirt cimzett nem engedi a kuldest.
  */
  it("a vevő e-mail címe nélkül megmondja, miért szürke a gomb, és a vevő adatlapjára visz", async () => {
    api.detail.mockResolvedValue(quote([published()], { status: "DRAFT" }));
    api.sendDraft.mockResolvedValue({ ...DRAFT, to: [] });
    api.send.mockResolvedValue(
      quote([published()], { status: "SENT", deliveries: [DELIVERY] }),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiküldés" }));
    expect(
      await screen.findByText("A vevőnek nincs e-mail címe"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Blue Office Kft\. adatlapján nincs e-mail cím/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "A vevő adatlapja" });
    expect(link).toHaveAttribute("href", "/vevok/c1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Elküldöm" })).toBeDisabled();

    // a typed address is a way out: the warning goes, the button wakes
    fireEvent.change(screen.getByLabelText("Címzett"), {
      target: { value: "kezzel@blue.test" },
    });
    expect(
      screen.queryByText("A vevőnek nincs e-mail címe"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Elküldöm" }));
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "v1",
        expect.objectContaining({ to: ["kezzel@blue.test"] }),
      ),
    );
  });

  it("says nothing when the customer has an e-mail, and a cleared field gets the plainer sentence", async () => {
    api.detail.mockResolvedValue(quote([published()], { status: "DRAFT" }));
    api.sendDraft.mockResolvedValue(DRAFT);
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiküldés" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Címzett")).toHaveValue("info@blue.test"),
    );
    expect(screen.queryByRole("link", { name: "A vevő adatlapja" })).toBeNull();
    expect(screen.queryByText("Nincs címzett")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Címzett"), {
      target: { value: "" },
    });
    expect(screen.getByText("Nincs címzett")).toBeInTheDocument();
    expect(screen.queryByText("A vevőnek nincs e-mail címe")).toBeNull();
    expect(screen.getByRole("button", { name: "Elküldöm" })).toBeDisabled();
  });

  it("links no customer page when the quote has no customer", async () => {
    api.detail.mockResolvedValue(
      quote([published()], {
        status: "DRAFT",
        customerId: null,
        customerName: null,
      }),
    );
    api.sendDraft.mockResolvedValue({ ...DRAFT, to: [] });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiküldés" }));
    // no customer: not "the customer has no e-mail", just no recipient, and no customer page to send anyone to
    expect(await screen.findByText("Nincs címzett")).toBeInTheDocument();
    expect(screen.queryByText("A vevőnek nincs e-mail címe")).toBeNull();
    expect(screen.queryByText(/adatlapján nincs e-mail cím/)).toBeNull();
    expect(screen.queryByRole("link", { name: "A vevő adatlapja" })).toBeNull();
  });

  it("bizonytalan kiküldés után Újraküldés a gomb, és a napló kiírja a próbacímet", async () => {
    api.detail.mockResolvedValue(
      quote([published()], {
        deliveries: [
          {
            ...DELIVERY,
            outcome: "INDETERMINATE",
            redirectedTo: "proba@example.test",
          },
        ],
      }),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    expect(
      await screen.findByRole("button", { name: "Újraküldés" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kiküldés" })).toBeNull();
    expect(
      screen.getByText("próbacímre irányítva: proba@example.test"),
    ).toBeTruthy();
  });

  it("csak piszkozattal nincs Kiküldés", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByRole("button", { name: "Szerkesztés" });
    expect(screen.queryByRole("button", { name: "Kiküldés" })).toBeNull();
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

  // LUCA 2026-11-20: a tétel felvitelekor a nettó ÉS a bruttó beírható, a sorban viszont csak egy "1x nettó" összeg látszott
  it("a tételsor a nettó ÉS a bruttó egységárat mutatja, több darabnál a sor összesen nettóját és bruttóját, a blokk részösszege mindkettőt", async () => {
    const item = (
      id: string,
      name: string,
      quantity: string,
      unitNetPrice: string,
      vatRatePercent = "27",
    ) => ({
      id,
      position: 0,
      name,
      description: null,
      quantity,
      unit: "db",
      unitNetPrice,
      vatRatePercent,
      isOptional: false,
      source: "STANDALONE" as const,
      variantId: null,
      variantLabel: null,
    });
    const base = version();
    api.detail.mockResolvedValue(
      quote([
        {
          ...base,
          blocks: [
            {
              ...base.blocks[0]!,
              items: [
                item("i1", "Egy darab", "1", "50000"),
                item("i2", "Három darab", "3", "10000"),
                item("i3", "Kedvezményes ÁFA", "1", "1000", "5"),
              ],
            },
          ],
        },
      ]),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    await screen.findByText("Egy darab");
    const text = document.body.textContent ?? "";
    const flat = text.replace(/[\s\u00a0]+/g, " ");
    // egy darab: egységár nettó és bruttó, és a sorösszeg is (Luca: a nettó, a bruttó ÉS az összesen mindig látszik)
    expect(flat).toMatch(/1 db × 50 000(,00)? Ft nettó/);
    expect(flat).toMatch(/63 500(,00)? Ft bruttó · ÁFA 27%/);
    expect(flat).toMatch(
      /Összesen: 50 000(,00)? Ft nettó · 63 500(,00)? Ft bruttó/,
    );
    // három darab: az egységár és a sor összesen is mindkét alakban
    expect(flat).toMatch(/3 db × 10 000(,00)? Ft nettó/);
    expect(flat).toMatch(/12 700(,00)? Ft bruttó · ÁFA 27%/);
    expect(flat).toMatch(
      /Összesen: 30 000(,00)? Ft nettó · 38 100(,00)? Ft bruttó/,
    );
    // más ÁFA-kulcs: a bruttó a tétel saját kulcsával
    expect(flat).toMatch(/1 ?050(,00)? Ft bruttó · ÁFA 5%/);
    // a blokk részösszege: nettó 81 000, bruttó 63 500 + 38 100 + 1 050 = 102 650
    expect(flat).toMatch(
      /Részösszeg: 81 000(,00)? Ft nettó · 102 650(,00)? Ft bruttó/,
    );
  });

  it("költségjoggal a belső kalkuláció látszik, anélkül le sem kéri", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    const { unmount } = render(<QuoteEditorPage quoteId="q1" />);
    expect(await screen.findByText("Belső kalkuláció")).toBeTruthy();
    expect(await screen.findByText(/33\s000 Ft · 62,26%/)).toBeTruthy();
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

  it("az árak megjelenítése ajánlatonként váltható: a verzió értékét mutatja, váltáskor elküldi", async () => {
    api.detail.mockResolvedValue(quote([version({ priceDisplay: "GROSS" })]));
    api.updateVersion.mockResolvedValue(
      quote([version({ priceDisplay: "NET" })]),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    const select = (await screen.findByLabelText(
      "Árak megjelenítése",
    )) as HTMLSelectElement;
    expect(select.value).toBe("GROSS");
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual(["Csak nettó + ÁFA", "Bruttó (ÁFA-val)", "Nettó és bruttó"]);
    fireEvent.change(select, { target: { value: "NET" } });
    await waitFor(() => expect(api.updateVersion).toHaveBeenCalledTimes(1));
    expect(api.updateVersion.mock.calls[0]!.slice(2)).toEqual([
      "v2",
      { priceDisplay: "NET" },
    ]);
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
    // the add buttons are off while the first block is being created: the second click waits for them
    const section = screen.getByRole("button", { name: "Fejezet" });
    await waitFor(() => expect(section).toBeEnabled());
    fireEvent.click(section);
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

  it("új tétel bruttó árral: a nettó az ÁFA-kulccsal visszaszámolva megy, és a mezők egymást követik", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.addItem.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
    );
    fireEvent.change(screen.getByLabelText("Megnevezés"), {
      target: { value: "Szűrőbetét" },
    });
    const net = screen.getByLabelText("Nettó egységár") as HTMLInputElement;
    const gross = screen.getByLabelText("Bruttó egységár") as HTMLInputElement;

    fireEvent.change(gross, { target: { value: "1270" } });
    expect(net.value).toBe("1000");

    // a nettó átírása a bruttót számolja újra
    fireEvent.change(net, { target: { value: "2000" } });
    expect(gross.value).toBe("2540");

    // a bruttó marad fix, ha az ÁFA-kulcs változik (a vevő a bruttót látja)
    fireEvent.change(gross, { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("ÁFA %"), {
      target: { value: "5" },
    });
    expect(gross.value).toBe("1000");
    expect(net.value).toBe("952.381");

    fireEvent.click(screen.getByRole("button", { name: "Tétel mentése" }));
    await waitFor(() => expect(api.addItem).toHaveBeenCalled());
    expect(api.addItem.mock.calls[0]![4]).toMatchObject({
      unitNetPrice: "952.381",
      vatRatePercent: "5",
    });
  });

  it("érvénytelen bruttó összegnél a nettó üres, és a tétel nem menthető", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
    );
    fireEvent.change(screen.getByLabelText("Megnevezés"), {
      target: { value: "Szűrőbetét" },
    });
    fireEvent.change(screen.getByLabelText("Bruttó egységár"), {
      target: { value: "12a" },
    });
    expect(
      screen.getByText(/Az összeg csak szám lehet, szóköz nélkül/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "Tétel mentése",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  /*
    A BOM FORRÁS FELIRATA (Luca kérdése, 2026-11-13: „mit jelent, hogy BOM belső rendszerből menjen?"). MI
    PIROSÍT: ha a felirat ismét azt sugallja, hogy a tétel már kapcsolódik valamihez; ha a segédszöveg nem
    mondja ki, hogy az ügyfél nem látja az anyaglistát, és hogy azt a tétel mentése után kell felvenni.
  */
  it("a BOM forrás felirata megmondja, mi ez, hol veszed fel, és hogy az ügyfél nem látja", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
    );
    const radio = screen.getByRole("radio", {
      name: /Belső anyaglistából \(BOM\) számolva/,
    });
    expect(radio).toBeTruthy();
    const label = radio.closest("label")!;
    expect(label.textContent).toMatch(/mentése után a tétel alatt/);
    expect(label.textContent).toMatch(/Az ügyfél csak a sort látja/);
    expect(label.textContent).not.toMatch(/kapcsolva/);
  });

  /*
    A TERMÉK KIVÁLASZTÁSA KITÖLTI A MEGNEVEZÉST ÉS AZ ÁRAT (Luca, 2026-11-13: „kiválasztás után nem adja
    ki az adott termék nevét és árát"). MI PIROSÍT: ha a kiválasztás után a név vagy a nettó ár üres marad;
    ha egy kézzel beírt név vagy ár felülíródik; ha az ár hiánya nulla Ft-ként tűnik el az ok nélkül.
  */
  describe("termék kiválasztása a tétel ablakában", () => {
    const pickProduct = async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
      );
      fireEvent.click(
        await screen.findByRole("radio", { name: /OS-termékhez kapcsolva/ }),
      );
      fireEvent.change(
        within(
          screen.getByRole("dialog", { name: "Új ajánlati tétel" }),
        ).getByLabelText("OS-termék keresése"),
        {
          target: { value: "szűrő" },
        },
      );
      fireEvent.click(
        await screen.findByRole("button", { name: /Szűrőbetét/ }),
      );
    };
    beforeEach(() => {
      api.detail.mockResolvedValue(quote([version()]));
      products.list.mockResolvedValue({
        items: [{ id: "p1", name: "Szűrőbetét 20 µm" }],
      });
      products.detail.mockResolvedValue({
        variants: [
          {
            id: "pv1",
            sku: "SZB-20",
            name: null,
            unit: "db",
            isActive: true,
            vatRate: "27",
          },
        ],
      });
    });

    it("kitölti a nevet és a nettó árat (a bruttó követi), és az árat a szerver mai eladási árából veszi", async () => {
      api.variantListPrice.mockResolvedValue({
        variantId: "pv1",
        unitNetPrice: "1000.0000",
        sale: false,
        reason: null,
      });
      render(<QuoteEditorPage quoteId="q1" />);
      await pickProduct();

      await waitFor(() =>
        expect(
          (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
        ).toBe("1000.0000"),
      );
      expect(
        (screen.getByLabelText("Megnevezés") as HTMLInputElement).value,
      ).toBe("Szűrőbetét 20 µm");
      expect(
        (screen.getByLabelText("Bruttó egységár") as HTMLInputElement).value,
      ).toBe("1270");
      expect(api.variantListPrice).toHaveBeenCalledWith(
        "token-1",
        "q1",
        "v2",
        "pv1",
      );
    });

    it("a kézzel beírt nevet és árat nem írja felül, de szól a mai árról", async () => {
      api.variantListPrice.mockResolvedValue({
        variantId: "pv1",
        unitNetPrice: "1000.0000",
        sale: false,
        reason: null,
      });
      render(<QuoteEditorPage quoteId="q1" />);
      fireEvent.click(
        await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
      );
      fireEvent.change(screen.getByLabelText("Megnevezés"), {
        target: { value: "Saját név" },
      });
      fireEvent.change(screen.getByLabelText("Nettó egységár"), {
        target: { value: "900" },
      });
      fireEvent.click(
        screen.getByRole("radio", { name: /OS-termékhez kapcsolva/ }),
      );
      fireEvent.change(
        within(
          screen.getByRole("dialog", { name: "Új ajánlati tétel" }),
        ).getByLabelText("OS-termék keresése"),
        {
          target: { value: "szűrő" },
        },
      );
      fireEvent.click(
        await screen.findByRole("button", { name: /Szűrőbetét/ }),
      );

      expect(
        await screen.findByText(/A beírt árat nem írtam felül/),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Megnevezés") as HTMLInputElement).value,
      ).toBe("Saját név");
      expect(
        (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
      ).toBe("900");
    });

    /*
      A KÉSVE ÉRKEZŐ ÁR-VÁLASZ (barracuda, #2535 review): MI PIROSÍT, ha egy korábbi választás válasza az
      újabb termék tételére ír; ha a bruttó a régi ÁFA-kulccsal számolódik, miközben a mező már az újat mutatja.
    */
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };
    const twoProducts = (vatB = "27") => {
      products.list.mockResolvedValue({
        items: [
          { id: "pA", name: "Szűrőbetét A" },
          { id: "pB", name: "Szűrőbetét B" },
        ],
      });
      products.detail.mockImplementation(
        async (_token: string, id: string) => ({
          variants: [
            {
              id: id === "pA" ? "vA" : "vB",
              sku: id === "pA" ? "A-1" : "B-1",
              name: null,
              unit: "db",
              isActive: true,
              vatRate: id === "pA" ? "27" : vatB,
            },
          ],
        }),
      );
    };
    const search = async (productName: RegExp) => {
      const drawer = screen.getByRole("dialog", { name: "Új ajánlati tétel" });
      fireEvent.change(within(drawer).getByLabelText("OS-termék keresése"), {
        target: { value: "szűrő" },
      });
      fireEvent.click(await screen.findByRole("button", { name: productName }));
    };

    it("az A termék késve érkező ára nem írja felül a B termékét", async () => {
      twoProducts();
      const a = deferred<unknown>();
      const b = deferred<unknown>();
      api.variantListPrice.mockImplementation(
        async (_t: string, _q: string, _v: string, variantId: string) =>
          variantId === "vA" ? a.promise : b.promise,
      );
      render(<QuoteEditorPage quoteId="q1" />);
      fireEvent.click(
        await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
      );
      fireEvent.click(
        await screen.findByRole("radio", { name: /OS-termékhez kapcsolva/ }),
      );
      await search(/Szűrőbetét A/);
      fireEvent.click(await screen.findByRole("button", { name: "Csere" }));
      await search(/Szűrőbetét B/);

      b.resolve({
        variantId: "vB",
        unitNetPrice: "2000.0000",
        sale: false,
        reason: null,
      });
      await waitFor(() =>
        expect(
          (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
        ).toBe("2000.0000"),
      );
      // az A válasza csak most érkezik
      a.resolve({
        variantId: "vA",
        unitNetPrice: "1000.0000",
        sale: false,
        reason: null,
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(
        (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
      ).toBe("2000.0000");
      expect(
        (screen.getByLabelText("Megnevezés") as HTMLInputElement).value,
      ).toBe("Szűrőbetét B");
    });

    it("eltérő ÁFA-kulcsú változatnál a bruttó az új kulccsal számolódik", async () => {
      twoProducts("5");
      api.variantListPrice.mockImplementation(
        async (_t: string, _q: string, _v: string, variantId: string) => ({
          variantId,
          unitNetPrice: "1000.0000",
          sale: false,
          reason: null,
        }),
      );
      render(<QuoteEditorPage quoteId="q1" />);
      fireEvent.click(
        await screen.findByRole("button", { name: "+ Tétel hozzáadása" }),
      );
      fireEvent.click(
        await screen.findByRole("radio", { name: /OS-termékhez kapcsolva/ }),
      );
      await search(/Szűrőbetét A/);
      await waitFor(() =>
        expect(
          (screen.getByLabelText("Bruttó egységár") as HTMLInputElement).value,
        ).toBe("1270"),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Csere" }));
      await search(/Szűrőbetét B/);
      // az ár a B-ről jön (1000 nettó), a kulcs 5 %: a bruttó 1050, nem 1270
      await waitFor(() =>
        expect((screen.getByLabelText("ÁFA %") as HTMLInputElement).value).toBe(
          "5",
        ),
      );
      await waitFor(() =>
        expect(
          (screen.getByLabelText("Bruttó egységár") as HTMLInputElement).value,
        ).toBe("1050"),
      );
    });

    it("ha nincs eladási ár, megnevezi az okot, és az ár üres marad (nem nulla)", async () => {
      api.variantListPrice.mockResolvedValue({
        variantId: "pv1",
        unitNetPrice: null,
        sale: false,
        reason: "price-missing",
      });
      render(<QuoteEditorPage quoteId="q1" />);
      await pickProduct();

      expect(
        await screen.findByText(/a termékhez nincs ár megadva/),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Nettó egységár") as HTMLInputElement).value,
      ).toBe("");
      expect(
        (screen.getByLabelText("Megnevezés") as HTMLInputElement).value,
      ).toBe("Szűrőbetét 20 µm");
    });
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

describe("Tétel-blokk nélküli ajánlat (5937bdf2)", () => {
  it("no Fejezet or Opciók block: the editor says an item needs one and offers it with one click", async () => {
    api.detail.mockResolvedValue(
      quote([
        version({ id: "v2", versionNumber: 2, status: "DRAFT", blocks: [] }),
      ]),
    );
    api.addBlock.mockResolvedValue(
      quote([version({ id: "v2", status: "DRAFT" })]),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    const hint = await screen.findByTestId("no-item-block");
    fireEvent.click(
      within(hint).getByRole("button", { name: "Fejezet hozzáadása" }),
    );
    await waitFor(() => expect(api.addBlock).toHaveBeenCalledTimes(1));
    expect(api.addBlock.mock.calls[0]![3]).toMatchObject({ kind: "SECTION" });
  });

  it("with an item block the hint is not shown", async () => {
    api.detail.mockResolvedValue(
      quote([version({ id: "v2", versionNumber: 2, status: "DRAFT" })]),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    await screen.findByText("+ Új blokk hozzáadása");
    expect(screen.queryByTestId("no-item-block")).toBeNull();
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
    expect(
      screen.getByText(
        /1 mentetlen rész \(blokk vagy fizetési ütemezés\) elvész/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Elmegyek mentés nélkül" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });
});

describe("Mentetlen állapot: barracuda négy pontja", () => {
  it("a törölt blokk nem marad a mentetlenek között", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.deleteBlock.mockResolvedValue(quote([version({ blocks: [] })]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fejezet: törlés" }));
    /*
      THE CLICK LANDS THE MOMENT THE BLOCK LEAVES THE PAGE, before React's
      deferred effects run: the deletion answers asynchronously, so a cleanup
      in useEffect would still be pending, and the click read a stale set
      (a full-suite run caught it, 2026-10-08).
    */
    const clicked = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (screen.queryByLabelText("Fejezet címe")) return;
        observer.disconnect();
        fireEvent.click(
          screen.getByRole("button", { name: "Ajánlat adatlapja" }),
        );
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    await clicked;
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });

  it("a cím végén álló szóköz nem mentetlen változás", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Akvárium és bútor " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajánlat adatlapja" }));
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1");
  });

  it("a mentetlen fizetési ütemezés is kérdez", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Mérföldkő" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajánlat adatlapja" }));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /1 mentetlen rész \(blokk vagy fizetési ütemezés\) elvész/,
      ),
    ).toBeTruthy();
    // the way back names the schedule's own save button too
    expect(screen.getByText(/„Ütemezés mentése” gombbal/)).toBeTruthy();
  });

  it("a csak horgonyra mutató link (#...) nem hagyja el az oldalt, nem kérdez", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(
      <>
        <a href="#osszesito">Összesítő</a>
        <QuoteEditorPage quoteId="q1" />
      </>,
    );
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Összesítő" }));
    // no confirmation dialog (the header badge reads "N mentetlen rész" too, so look for the dialog's own sentence)
    expect(screen.queryByText(/elvész, ha most elmész/)).toBeNull();
  });

  it("egy alkalmazáson belüli link (menü) is kérdez, és megerősítés után oda visz", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    render(
      <>
        <a href="/beszerzes">Beszerzés</a>
        <QuoteEditorPage quoteId="q1" />
      </>,
    );
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Beszerzés" }));
    expect(
      screen.getByText(
        /1 mentetlen rész \(blokk vagy fizetési ütemezés\) elvész/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Elmegyek mentés nélkül" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/beszerzes");
  });
});

describe("PDF előnézet és publikálás (569:363)", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "about:blank#quote-pdf");
    URL.revokeObjectURL = vi.fn();
    api.pdf.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  });

  it("a piszkozat előnézete, és a publikálás csak megerősítés után fut", async () => {
    api.detail.mockResolvedValue(quote([version()]));
    api.publish.mockResolvedValue(
      quote([
        version({ status: "PUBLISHED", publishedAt: "2026-10-08T08:00:00Z" }),
      ]),
    );
    render(<QuotePdfPage quoteId="q1" />);
    expect(
      await screen.findByText("Piszkozat · még nincs publikálva"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(api.pdf).toHaveBeenCalledWith("token-1", "q1", "v2"),
    );
    expect(
      (await screen.findByTitle("AJ-2026-0042 v2 PDF")).getAttribute("src"),
    ).toBe("about:blank#quote-pdf");
    fireEvent.click(screen.getByRole("button", { name: "Verzió publikálása" }));
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Publikálás" }));
    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith("token-1", "q1", "v2"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Verzió publikálása" }),
      ).toBeNull(),
    );
  });

  it("publikált verziónál nincs publikáló gomb, a kért verzió PDF-je töltődik", async () => {
    navigation.search = new URLSearchParams("v=v1");
    api.detail.mockResolvedValue(
      quote([
        version({
          id: "v1",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-10-07T10:00:00Z",
        }),
        version(),
      ]),
    );
    render(<QuotePdfPage quoteId="q1" />);
    await waitFor(() =>
      expect(api.pdf).toHaveBeenCalledWith("token-1", "q1", "v1"),
    );
    expect(
      screen.queryByRole("button", { name: "Verzió publikálása" }),
    ).toBeNull();
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

/*
  AZ AJÁNLAT CÍME A MÁSOLATON (Luca, 2026-11-12, task quote-masolat-cim). Az ok, mérve: az API (PATCH /quotes/:id) a címet csak piszkozat
  ajánlaton, soha nem publikált verziókkal engedi, de a felületen NINCS cím-szerkesztő (az új ajánlat oldala egyszer beállítja), ezért a
  másolat ("... (másolat)") nem nevezhető át. MI PIROSÍT: ha a gomb nem látszik egy soha nem publikált piszkozaton; ha látszik elküldött vagy
  publikált verziós ajánlaton, vagy jog nélkül; ha a mentés nem a címet, az ajánlat azonosítóját és a tokent küldi; ha az új cím nem jelenik
  meg; ha az API elutasítása nem látszik; ha üres cím elmenne; ha a Mégse is mentene.
*/
describe("Az ajánlat címe: a másolat átnevezhető (quote-masolat-cim)", () => {
  const draftOnly = () =>
    quote([version({ id: "v1", versionNumber: 1, status: "DRAFT" })], {
      status: "DRAFT",
      title: "180 cm-es irodai bemutató akvárium (másolat)",
    });
  // the detail page keeps it behind "Továbbiak"; the editor page shows the button itself
  const open = async (viaMenu = true) =>
    fireEvent.click(
      viaMenu
        ? await moreItem("Cím szerkesztése")
        : await screen.findByRole("button", { name: "Cím szerkesztése" }),
    );
  const field = () => screen.getByLabelText("Az ajánlat címe");

  it("renames a never-published draft from the detail page, and the new title shows", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.updateHeader.mockResolvedValue({
      ...LIST.items[0]!,
      title: "Cápasuli lámpák, Állatkert",
    });
    render(<QuoteDetailPage quoteId="q1" />);
    expect(
      await screen.findByText("180 cm-es irodai bemutató akvárium (másolat)"),
    ).toBeInTheDocument();
    await open();
    expect(field()).toHaveValue("180 cm-es irodai bemutató akvárium (másolat)");
    fireEvent.change(field(), {
      target: { value: "  Cápasuli lámpák, Állatkert  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cím mentése" }));
    await waitFor(() =>
      expect(api.updateHeader).toHaveBeenCalledWith("token-1", "q1", {
        title: "Cápasuli lámpák, Állatkert",
      }),
    );
    expect(
      await screen.findByText("Cápasuli lámpák, Állatkert"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Az ajánlat címe")).toBeNull();
  });

  it("is offered only on a draft that was never published, and only with the manage right", async () => {
    api.detail.mockResolvedValue(quote([version({ status: "PUBLISHED" })]));
    const { unmount } = render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("Aktuális verzió: v2", { exact: false });
    expect(queryMoreItem("Cím szerkesztése")).toBeNull();
    unmount();

    // a DRAFT quote that already has a published version (a new draft on a sent one) is refused by the API too
    api.detail.mockResolvedValue(
      quote(
        [
          version({ id: "v1", versionNumber: 1, status: "PUBLISHED" }),
          version({ id: "v2", versionNumber: 2, status: "DRAFT" }),
        ],
        { status: "DRAFT" },
      ),
    );
    const second = render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("Aktuális verzió: v2", { exact: false });
    expect(queryMoreItem("Cím szerkesztése")).toBeNull();
    second.unmount();

    auth.permissions = ["quotes.view"];
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("AJ-2026-0042 · Blue Office Kft.");
    expect(queryMoreItem("Cím szerkesztése")).toBeNull();
  });

  it("shows the API's refusal and keeps the old title", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.updateHeader.mockRejectedValue(
      new ApiError("Az adat időközben megváltozott. Frissítsd a listát.", 409),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    await open();
    fireEvent.change(field(), { target: { value: "Más cím" } });
    fireEvent.click(screen.getByRole("button", { name: "Cím mentése" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Az adat időközben megváltozott.",
    );
    expect(
      screen.getByText("180 cm-es irodai bemutató akvárium (másolat)", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("an empty title says why the button is grey and sends nothing; Mégse and an unchanged title send nothing", async () => {
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    await open();
    fireEvent.change(field(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Cím mentése" })).toBeDisabled();
    expect(
      screen.getByText("Az ajánlat címe nem lehet üres."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(screen.queryByLabelText("Az ajánlat címe")).toBeNull();

    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cím mentése" }));
    expect(screen.queryByLabelText("Az ajánlat címe")).toBeNull();
    expect(api.updateHeader).not.toHaveBeenCalled();
  });

  it("the editor page renames too, and its header follows", async () => {
    api.detail.mockResolvedValue(draftOnly());
    api.updateHeader.mockResolvedValue({
      ...LIST.items[0]!,
      title: "Új cím a szerkesztőben",
    });
    render(<QuoteEditorPage quoteId="q1" />);
    await open(false);
    fireEvent.change(field(), { target: { value: "Új cím a szerkesztőben" } });
    fireEvent.click(screen.getByRole("button", { name: "Cím mentése" }));
    await waitFor(() =>
      expect(api.updateHeader).toHaveBeenCalledWith("token-1", "q1", {
        title: "Új cím a szerkesztőben",
      }),
    );
    expect(
      await screen.findByText("AJ-2026-0042 · Új cím a szerkesztőben"),
    ).toBeInTheDocument();
  });
});

/*
  A PARTNER CSERÉJE A PISZKOZAT AJÁNLATON (Luca, 2026-11-20, Discord: a "Másolat új ajánlatként" másolat címe átírható, a partnere nem).
  Az API (PATCH /quotes/:id, customerId) már tudta; a felületen csak kiírás volt. MI PIROSÍT: ha a gomb nem látszik egy soha nem
  publikált piszkozaton; ha látszik elküldött vagy publikált verziós ajánlaton, vagy jog nélkül; ha a mentés nem csak a partner
  azonosítóját küldi; ha a találat kiválasztása mentés nélkül is cserélne; ha ugyanaz a partner is menthető; ha az API elutasítása
  nem látszik; ha a csere után a régi partner neve marad a lapon; ha a keresés nem ugyanaz, mint az új ajánlat oldalán.
*/
describe("Az ajánlat partnere: a piszkozaton cserélhető", () => {
  const draftOnly = () =>
    quote([version({ id: "v1", versionNumber: 1, status: "DRAFT" })], {
      status: "DRAFT",
      customerId: "c1",
      customerName: "Blue Office Kft.",
    });
  const searchFor = async (text: string) => {
    fireEvent.change(await screen.findByLabelText("Partner keresése"), {
      target: { value: text },
    });
  };

  it("swaps the partner: the search is the new-quote page's, only the pick plus the button saves, and the page shows the new partner", async () => {
    api.detail.mockResolvedValue(draftOnly());
    customers.list.mockResolvedValue({
      items: [{ id: "c2", displayName: "Állatkert Zrt.", partnerMirror: true }],
    });
    api.updateHeader.mockResolvedValue({
      ...LIST.items[0]!,
      customerId: "c2",
      customerName: "Állatkert Zrt.",
    });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Partner cseréje"));
    await searchFor("Állat");
    // the same search as on the new-quote page: the partners' mirrors are included
    await waitFor(() => expect(customers.list).toHaveBeenCalled());
    expect(customers.list.mock.calls[0]![1].get("includePartnerMirrors")).toBe(
      "true",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Állatkert Zrt\./ }),
    );
    // a pick alone saves nothing
    expect(api.updateHeader).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Partner mentése" }));
    await waitFor(() =>
      expect(api.updateHeader).toHaveBeenCalledWith("token-1", "q1", {
        customerId: "c2",
      }),
    );
    expect(await screen.findByText("Állatkert Zrt.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Partner keresése")).toBeNull();
  });

  it("is offered only on a draft that was never published, and only with the manage right", async () => {
    api.detail.mockResolvedValue(quote([version({ status: "PUBLISHED" })]));
    const first = render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("Aktuális verzió: v2", { exact: false });
    expect(queryMoreItem("Partner cseréje")).toBeNull();
    first.unmount();

    api.detail.mockResolvedValue(
      quote(
        [
          version({ id: "v1", versionNumber: 1, status: "PUBLISHED" }),
          version({ id: "v2", versionNumber: 2, status: "DRAFT" }),
        ],
        { status: "DRAFT" },
      ),
    );
    const second = render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("Aktuális verzió: v2", { exact: false });
    expect(queryMoreItem("Partner cseréje")).toBeNull();
    second.unmount();

    auth.permissions = ["quotes.view"];
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    await screen.findByText("AJ-2026-0042 · Blue Office Kft.");
    expect(queryMoreItem("Partner cseréje")).toBeNull();
  });

  it("does not save the partner it already has", async () => {
    api.detail.mockResolvedValue(draftOnly());
    customers.list.mockResolvedValue({
      items: [{ id: "c1", displayName: "Blue Office Kft." }],
    });
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Partner cseréje"));
    await searchFor("Blue");
    fireEvent.click(
      await screen.findByRole("button", { name: "Blue Office Kft." }),
    );
    expect(
      await screen.findByText("Ez már az ajánlat partnere."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Partner mentése" }),
    ).toBeDisabled();
  });

  it("shows the API's refusal and keeps the old partner", async () => {
    api.detail.mockResolvedValue(draftOnly());
    customers.list.mockResolvedValue({
      items: [{ id: "c2", displayName: "Állatkert Zrt." }],
    });
    api.updateHeader.mockRejectedValue(
      new ApiError(
        "P0-ban csak publikálás előtti DRAFT ajánlat fej-adatai módosíthatók.",
        409,
      ),
    );
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Partner cseréje"));
    await searchFor("Állat");
    fireEvent.click(
      await screen.findByRole("button", { name: /Állatkert Zrt\./ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Partner mentése" }));
    expect(
      await screen.findByText(/csak publikálás előtti DRAFT ajánlat/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Jelenlegi partner: Blue Office Kft\./),
    ).toBeInTheDocument();
  });

  it("Mégse closes the editor without saving", async () => {
    api.detail.mockResolvedValue(draftOnly());
    render(<QuoteDetailPage quoteId="q1" />);
    fireEvent.click(await moreItem("Partner cseréje"));
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(screen.queryByLabelText("Partner keresése")).toBeNull();
    expect(api.updateHeader).not.toHaveBeenCalled();
  });
});

/**
 * AZ AJÁNLAT-SZERKESZTŐ FEJLÉCE (Balázs 2026-11-25, card b22949e8, emlék 2961): egy "Minden mentve / N mentetlen rész" jelző és a "Kiküldés"
 * gomb. MI PIROSÍT: ha a jelző nem a blokkok és az ütemezés mentetlen állapotából jön (ugyanaz a szám, mint az elhagyáskori kérdésben);
 * ha mentetlen rész mellett a gomb küld, vagy nem mondja meg, miért szürke; ha a gomb a PISZKOZATOT mondja kiküldendőnek (a publikált verzió
 * megy ki); ha sosem publikált ajánlatnál, quotes.send nélkül vagy lezárt ajánlatnál megjelenik; ha más úton küld, mint az adatlap.
 */
describe("Ajánlat szerkesztő: mentés-jelző és Kiküldés a fejlécben (b22949e8)", () => {
  const publishedV1 = () =>
    version({
      id: "v1",
      versionNumber: 1,
      status: "PUBLISHED",
      publishedAt: "2026-10-07T10:42:00Z",
    });
  const editing = (over: Partial<QuoteDetailDto> = {}) =>
    quote([publishedV1(), version({ id: "v2", versionNumber: 2 })], {
      status: "SENT",
      ...over,
    });
  const MAIL = {
    source: "default" as const,
    to: ["info@blue.test"],
    subject: "Acropora árajánlat: AJ-2026-0042",
    body: "Tisztelt Blue Office Kft.!",
    fileName: "AJ-2026-0042-v1.pdf",
    alreadySent: false,
  };

  it("a jelző Minden mentve, amíg nincs mentetlen rész, és számolja a mentetleneket", async () => {
    api.detail.mockResolvedValue(editing());
    render(<QuoteEditorPage quoteId="q1" />);
    const status = await screen.findByText("Minden mentve");
    expect(status.closest('[role="status"]')).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    expect(await screen.findByText("1 mentetlen rész")).toBeTruthy();
    expect(screen.queryByText("Minden mentve")).toBeNull();
    // back to the saved text: saved again, no stale count
    fireEvent.change(screen.getByLabelText("Fejezet címe"), {
      target: { value: "Akvárium és bútor" },
    });
    expect(await screen.findByText("Minden mentve")).toBeTruthy();
  });

  it("mentetlen rész mellett a Kiküldés szürke és kimondja, miért; mentve már a publikált verziót nevezi meg", async () => {
    api.detail.mockResolvedValue(editing());
    render(<QuoteEditorPage quoteId="q1" />);
    const send = await screen.findByRole("button", { name: "Kiküldés" });
    expect(send).not.toBeDisabled();
    expect(
      screen.getByText("A publikált v1 megy ki, nem a szerkesztett piszkozat."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Fejezet címe"), {
      target: { value: "Átírt cím" },
    });
    expect(screen.getByRole("button", { name: "Kiküldés" })).toBeDisabled();
    expect(screen.getByText("Előbb mentsd a mentetlen részeket.")).toBeTruthy();
    expect(send.getAttribute("aria-describedby")).toBe("quote-send-note");
    fireEvent.click(screen.getByRole("button", { name: "Kiküldés" }));
    expect(api.sendDraft).not.toHaveBeenCalled();
  });

  it("ugyanazt a fiókot és küldési utat használja, mint az adatlap: a publikált verziót küldi, egy kérés-azonosítóval", async () => {
    api.detail.mockResolvedValue(editing());
    api.sendDraft.mockResolvedValue(MAIL);
    api.send.mockResolvedValue(
      editing({
        status: "SENT",
        deliveries: [
          {
            id: "d1",
            versionId: "v1",
            versionNumber: 1,
            to: ["info@blue.test"],
            cc: [],
            bcc: [],
            subject: MAIL.subject,
            outcome: "SENT",
            error: null,
            isResend: false,
            redirectedTo: null,
            initiatedByName: "Balázs",
            createdAt: "2026-10-08T07:12:00Z",
          },
        ],
      }),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Kiküldés" }));
    // the draft of the mail is the PUBLISHED version's, not the edited draft's
    await waitFor(() =>
      expect(api.sendDraft).toHaveBeenCalledWith("token-1", "q1", "v1"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Tárgy")).toHaveValue(MAIL.subject),
    );
    fireEvent.click(screen.getByRole("button", { name: "Elküldöm" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    expect(api.send).toHaveBeenCalledWith("token-1", "q1", "v1", {
      requestId: expect.any(String),
      to: ["info@blue.test"],
      cc: [],
      subject: MAIL.subject,
      body: MAIL.body,
    });
    // sent: the button turns into the resend one, the drawer is gone
    expect(
      await screen.findByRole("button", { name: "Újraküldés" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Tárgy")).toBeNull();
  });

  it("sosem publikált ajánlatnál nincs Kiküldés (nincs mit küldeni), quotes.send nélkül sincs, lezárt ajánlatnál sincs", async () => {
    api.detail.mockResolvedValue(
      quote([version({ id: "v1", versionNumber: 1 })], { status: "DRAFT" }),
    );
    const first = render(<QuoteEditorPage quoteId="q1" />);
    await screen.findByText("Minden mentve");
    expect(screen.queryByRole("button", { name: "Kiküldés" })).toBeNull();
    first.unmount();

    api.detail.mockResolvedValue(editing());
    auth.permissions = ["quotes.view", "quotes.manage"] as Permission[];
    try {
      const second = render(<QuoteEditorPage quoteId="q1" />);
      await screen.findByText("Minden mentve");
      expect(screen.queryByRole("button", { name: "Kiküldés" })).toBeNull();
      second.unmount();
    } finally {
      auth.permissions = undefined;
    }

    api.detail.mockResolvedValue(editing({ status: "REJECTED" }));
    render(<QuoteEditorPage quoteId="q1" />);
    await screen.findByText("Minden mentve");
    expect(screen.queryByRole("button", { name: "Kiküldés" })).toBeNull();
  });

  it("piszkozat nélkül (csak publikált verzió) a megjegyzés nem emlegeti a szerkesztett piszkozatot", async () => {
    api.detail.mockResolvedValue(
      quote([publishedV1()], { status: "ACCEPTED" }),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    expect(await screen.findByText("A publikált v1 megy ki.")).toBeTruthy();
    expect(screen.queryByText(/nem a szerkesztett piszkozat/)).toBeNull();
    expect(screen.getByRole("button", { name: "Kiküldés" })).toBeTruthy();
  });

  it("a már kiment publikált verziónál a fejlécben is Újraküldés áll", async () => {
    api.detail.mockResolvedValue(
      editing({
        deliveries: [
          {
            id: "d1",
            versionId: "v1",
            versionNumber: 1,
            to: ["info@blue.test"],
            cc: [],
            bcc: [],
            subject: MAIL.subject,
            outcome: "SENT",
            error: null,
            isResend: false,
            redirectedTo: null,
            initiatedByName: "Balázs",
            createdAt: "2026-10-08T07:12:00Z",
          },
        ],
      }),
    );
    render(<QuoteEditorPage quoteId="q1" />);
    expect(
      await screen.findByRole("button", { name: "Újraküldés" }),
    ).toBeTruthy();
  });
});

/**
 * A MORZSA AZ ÉRTÉKESÍTÉS ALATT (picasso R8, acrobot 61804): a menü az Árajánlatokat az Értékesítés alá költöztette (Balázs 2026-10-26),
 * a lapok morzsája még "Pénzügy / Árajánlatok" volt. MI PIROSÍT: ha az ajánlat-lapok bármelyike a régi morzsát írja.
 */
describe("Az Árajánlatok lapok morzsája (R8)", () => {
  it("a lista, az adatlap és a szerkesztő is az Értékesítés alá teszi magát", async () => {
    api.list.mockResolvedValue(LIST);
    const list = render(<QuoteListPage />);
    expect(await screen.findByText("Értékesítés / Árajánlatok")).toBeTruthy();
    list.unmount();
    api.detail.mockResolvedValue(quote([version()], { status: "DRAFT" }));
    const detail = render(<QuoteDetailPage quoteId="q1" />);
    expect(await screen.findByText("Értékesítés / Árajánlatok")).toBeTruthy();
    detail.unmount();
    render(<QuoteEditorPage quoteId="q1" />);
    expect(await screen.findByText("Értékesítés / Árajánlatok")).toBeTruthy();
    expect(screen.queryByText(/Pénzügy \/ Árajánlatok/)).toBeNull();
  });
});
