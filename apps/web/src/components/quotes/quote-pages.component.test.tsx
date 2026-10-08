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
import { CUSTOMER_LIST_PAGE_SIZE } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(navigation.push).toHaveBeenCalledWith("/ajanlatok/q1/szerkesztes");
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
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
    expect(screen.getByText(/v1 · 2026\.10\.08\. · Telefonon/)).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Elutasítás" }));
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
    expect(screen.queryByRole("button", { name: "Elutasítás" })).toBeNull();
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
    expect(navigation.push).toHaveBeenCalledWith(
      "/beallitasok/ajanlat-sablonok/t2",
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
      { target: { value: "45" } },
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
    expect(navigation.replace).toHaveBeenCalledWith(
      "/beallitasok/ajanlat-sablonok/t9",
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
    expect(screen.getByText(/1 mentetlen rész/)).toBeTruthy();
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
    expect(screen.getByText(/1 mentetlen rész/)).toBeTruthy();
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
    expect(screen.queryByText(/mentetlen rész/)).toBeNull();
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
    expect(screen.getByText(/1 mentetlen rész/)).toBeTruthy();
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
    expect(
      screen.queryByRole("button", { name: "Verzió publikálása" }),
    ).toBeNull();
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
