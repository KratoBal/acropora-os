import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  CUSTOMER_LIST_PAGE_SIZE,
  type BillingDocumentDetail,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingDocumentEditor } from "./billing-document-editor";
import {
  readPosInvoiceHandoff,
  writePosInvoiceHandoff,
} from "./pos-invoice-handoff";
import {
  readContractInvoiceHandoff,
  writeContractInvoiceHandoff,
} from "./contract-invoice-handoff";

/**
 * A SZÁMLÁZÁSI SZERKESZTŐ (Számlázás v0.1, brief 35. pont UI QA): a típus
 * szerint változó cím, összesítő, gomb és mezők; a típusváltás nem töröl; a
 * tételmegjegyzés megmarad; a mentés a szerver szerződését küldi; a
 * véglegesítő gombok tiltottak, amíg a kiállítás nincs bekötve.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/penzugy/szamlazas/uj",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  detail: vi.fn(),
  issue: vi.fn(),
  email: vi.fn(),
  pdf: vi.fn(),
  emailDraft: vi.fn(),
  templateDraft: vi.fn(),
  storno: vi.fn(),
  stornoPdf: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));
/* a drawer nyitásakor a képtár töltődik; itt üres, hálózat nélkül */
vi.mock("@/lib/api/mail-images", () => ({
  mailImagesApi: {
    list: vi.fn().mockResolvedValue([]),
    upload: vi.fn(),
    content: vi.fn(),
  },
}));

const customers = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
const products = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/api/products", () => ({ productApi: products }));

const session: Session = {
  id: "s",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u",
    email: "u@acropora.local",
    displayName: "U",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

function detailFrom(body: Record<string, unknown>, id: string) {
  return {
    id,
    status: "DRAFT",
    emailStatus: "PENDING",
    documentNumber: null,
    documentType: body.documentType,
    invoiceFormat: body.invoiceFormat,
    customer: {
      id: "cust-1",
      name: "Fővárosi Állat- és Növénykert",
      address: "1146 Budapest, Állatkerti krt. 6-12.",
      taxNumber: "12345678-2-42",
      euTaxNumber: null,
      contactName: null,
      email: "szamlazas@partner.hu",
      internalCode: "V-1",
    },
    fulfillmentDate: body.fulfillmentDate,
    dueDate: body.dueDate,
    paymentMethod: body.paymentMethod,
    currency: body.currency,
    language: body.language,
    reference: body.reference,
    note: body.note,
    sourceType: "MANUAL",
    sourceId: null,
    // A szerver a beküldött sorokat adja vissza, saját azonosítóval.
    lines: (body.lines as Record<string, unknown>[]).map((line, index) => ({
      ...line,
      id: `line-${index + 1}`,
      kind: "ITEM",
      parentLineId: null,
      netAmount: "0.0000",
      vatAmount: "0.0000",
      grossAmount: "0.0000",
    })),
    totals: {
      netAmount: "0.0000",
      vatAmount: "0.0000",
      grossAmount: "0.0000",
      byVatRate: [],
    },
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:05:00.000Z",
  } as unknown as BillingDocumentDetail;
}

beforeEach(() => {
  products.list.mockReset().mockResolvedValue({ items: [] });
  products.detail.mockReset();
  navigation.replace.mockReset();
  api.create
    .mockReset()
    .mockImplementation(async (_token, body) => detailFrom(body, body.id));
  api.update
    .mockReset()
    .mockImplementation(async (_token, id, body) => detailFrom(body, id));
  api.issue.mockReset();
  api.email.mockReset();
  api.pdf.mockReset();
  api.storno.mockReset();
  api.stornoPdf.mockReset();
  // A LEVELEZÉS OLDAL SABLONJA (nautilus #1293): ez megy ki, amíg a levélhez
  // senki nem nyúlt.
  api.emailDraft.mockReset();
  api.templateDraft.mockReset().mockResolvedValue({
    source: "stored",
    subject: "Sablon – {{document_number}}",
    body: "Kedves {{customer_name}}! A(z) {{document_number}} számla csatolva.",
    variables: [],
  });
  customers.list.mockReset().mockResolvedValue({
    items: [
      {
        id: "cust-1",
        customerNumber: "V-1",
        displayName: "Állatkert",
        companyName: "Fővárosi Állat- és Növénykert",
        address: "1146 Budapest, Állatkerti krt. 6-12.",
      },
    ],
  });
  customers.detail.mockReset().mockResolvedValue({
    id: "cust-1",
    customerNumber: "V-1",
    displayName: "Állatkert",
    companyName: "Fővárosi Állat- és Növénykert",
    email: "szamlazas@partner.hu",
    taxNumber: "12345678-2-42",
    address: "1146 Budapest, Állatkerti krt. 6-12.",
  });
});

const radio = (name: string) => screen.getByRole("radio", { name });
const summary = () =>
  screen.getByRole("heading", { name: /összesen$/ }).closest("section")!;

async function pickPartner() {
  fireEvent.change(screen.getByLabelText("Partner keresése"), {
    target: { value: "Állat" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: /Fővárosi Állat/ }),
  );
  await screen.findByText(/Adószám: 12345678-2-42/);
}

function addLine(description: string, quantity: string, unitNet: string) {
  fireEvent.click(screen.getByRole("button", { name: "Egyedi tétel" }));
  const index = screen.getAllByLabelText(/tétel megnevezése$/).length;
  fireEvent.change(screen.getByLabelText(`${index}. tétel megnevezése`), {
    target: { value: description },
  });
  fireEvent.change(screen.getByLabelText(`${description} mennyisége`), {
    target: { value: quantity },
  });
  fireEvent.change(screen.getByLabelText(`${description} nettó egységára`), {
    target: { value: unitNet },
  });
}

describe("BillingDocumentEditor", () => {
  it("defaults: Számla, E-számla, the invoice title, summary and disabled issue button", () => {
    render(<BillingDocumentEditor />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Új számla" }),
    ).toBeInTheDocument();
    expect(radio("Számla")).toBeChecked();
    expect(radio("E-számla")).toBeChecked();
    expect(within(summary()).getByText("Számla összesen")).toBeInTheDocument();
    const issue = screen.getByRole("button", { name: "Kiállítás és kiküldés" });
    expect(issue).toBeDisabled();
  });

  /*
    A TÍPUS VÁLTÁSA (brief 23-26., 35. pont). MI PIROSÍT: ha a cím, az
    összesítő vagy a gomb nem követi a típust; ha a szállítólevélen maradna
    formátum- vagy fizetési mező; ha a visszaváltás elvesztené a kitöltött
    értéket vagy a tételmegjegyzést.
  */
  it("a delivery note: its own title, summary and button, no format or payment fields, nothing lost on the way back", () => {
    render(<BillingDocumentEditor />);
    addLine("Munkadíj", "1", "280000");
    fireEvent.change(screen.getByLabelText("Munkadíj megjegyzése"), {
      target: { value: "Szeptember havi átalány" },
    });
    fireEvent.change(screen.getByLabelText("Fizetési mód"), {
      target: { value: "Készpénz" },
    });

    fireEvent.click(radio("Szállítólevél"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Új szállítólevél" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "E-számla" })).toBeNull();
    // A csoport maga sem áll ott üresen: helyette a magyarázó mondat.
    expect(screen.queryByRole("group", { name: /Formátum/ })).toBeNull();
    expect(
      screen.getByText("A szállítólevél formátuma nem választható."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Fizetési mód")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "fizetési határidő, fizetési mód",
    );
    expect(
      within(summary()).getByText("Szállítólevél összesen"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Szállítólevél kiállítása" }),
    ).toBeDisabled();
    expect(screen.queryByText("Kiküldési e-mail")).toBeNull();

    fireEvent.click(radio("Számla"));
    expect(
      (screen.getByLabelText("Fizetési mód") as HTMLSelectElement).value,
    ).toBe("Készpénz");
    expect(
      (screen.getByLabelText("Munkadíj megjegyzése") as HTMLInputElement).value,
    ).toBe("Szeptember havi átalány");
  });

  /*
    AZ UTÁNVÉT (Luca kérése, 2026-10-14). MI PIROSÍT: ha a választóban nincs
    „Utánvét”, vagy a vázlat nem ezzel a szöveggel megy a szerverre (a
    Számlázz.hu ezt írja ki, és a kifizetettség ebből tudja, hogy a pénz később jön).
  */
  it("WEB-INVOICE-COD: cash on delivery can be chosen and is saved as Utánvét", async () => {
    render(<BillingDocumentEditor />);
    addLine("Munkadíj", "1", "280000");
    await pickPartner();
    const method = screen.getByLabelText("Fizetési mód") as HTMLSelectElement;
    expect(Array.from(method.options).map((option) => option.value)).toContain(
      "Utánvét",
    );
    fireEvent.change(method, { target: { value: "Utánvét" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Vázlat mentése|Mentés…/ }),
    );
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, created] = api.create.mock.calls[0]!;
    expect(created.paymentMethod, "WEB-INVOICE-COD").toBe("Utánvét");
  });

  it("paper: the plain issue button, and the e-mail is optional", () => {
    render(<BillingDocumentEditor />);
    fireEvent.click(radio("Papír alapú"));
    expect(
      screen.getByRole("button", { name: "Számla kiállítása" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Nem kötelező; kiállítás után is elküldhető."),
    ).toBeInTheDocument();
  });

  it("counts the lines live, with the discount as its own negative line", () => {
    render(<BillingDocumentEditor />);
    addLine("Munkadíj", "2", "30000");
    fireEvent.change(screen.getByLabelText("Munkadíj kedvezménye (%)"), {
      target: { value: "10" },
    });
    expect(
      screen.getByText(/Kedvezmény \(10%\), külön negatív sorként/),
    ).toBeInTheDocument();
    const totals = within(summary());
    // 60 000 - 6 000 = 54 000 nettó, 27% ÁFA = 14 580, bruttó 68 580
    expect(totals.getByText("Bruttó").nextSibling).toHaveTextContent(
      /68\s580\sFt/,
    );
  });

  /*
    A PÉNZTÁR KOSARA (kártya cdc2771b): az Új számla a kosár tételsoraival
    nyílik, a vevő üres marad (azt a kezelő választja). MI PIROSÍT: ha a sorok
    nem töltődnek be, ha a termék, a változat, a kulcs vagy a bruttó elveszne,
    vagy ha a vevő magától kitöltődne.
  */
  it("prefills the lines from the POS cart, leaving the customer to pick", async () => {
    window.sessionStorage.clear();
    products.detail.mockResolvedValue({
      variants: [
        { id: "variant-1", sku: "RS-RM500", name: null, isActive: true },
      ],
    });
    const key = writePosInvoiceHandoff(window.sessionStorage, [
      {
        productId: "product-1",
        variantId: "variant-1",
        sku: "RS-RM500",
        productName: "Red Sea ReefMat 500",
        unit: "db",
        quantity: 2,
        vatRatePercent: "27",
        lineGross: 35856,
      },
    ]);
    render(<BillingDocumentEditor posHandoffKey={key} />);

    expect(
      await screen.findByDisplayValue("Red Sea ReefMat 500"),
    ).toBeInTheDocument();
    expect(screen.getByText(/RS-RM500 · termék/)).toBeInTheDocument();
    expect(within(summary()).getByText("Bruttó").nextSibling).toHaveTextContent(
      /35\s856\sFt/,
    );
    const save = () =>
      screen.getByRole("button", { name: /Vázlat mentése|Mentés…/ });
    expect(save()).toBeDisabled();

    await pickPartner();
    fireEvent.click(save());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, created] = api.create.mock.calls[0]!;
    expect(created.customerId).toBe("cust-1");
    expect(created.lines).toEqual([
      expect.objectContaining({
        productId: "product-1",
        variantId: "variant-1",
        description: "Red Sea ReefMat 500",
        quantity: "2",
        unit: "db",
        vatRatePercent: "27",
        discountPercent: null,
      }),
    ]);
    // az első mentés után a kosár nem nyílik újra (barracuda, #1642)
    expect(readPosInvoiceHandoff(window.sessionStorage, key)).toBeNull();
  });

  /*
    A BESZERZÉSI SZERZŐDÉS SZÁMLÁJA (hétfői lista M4). MI PIROSÍT: ha a vevő
    nem töltődik be magától; ha a szerződés száma nem lesz hivatkozás; ha a
    tétel nem nettóval, a szerződés egységével nyílik; ha a csomag az első
    mentés után újra megnyílna.
  */
  it("WEB-INVOICE-FROM-CONTRACT: the purchase contract fills the customer, the reference and the lines", async () => {
    window.sessionStorage.clear();
    const key = writeContractInvoiceHandoff(window.sessionStorage, {
      contractId: "contract-2",
      customerId: "cust-1",
      contractNumber: "SZ2026/0000020",
      lines: [
        {
          description: "Tengeri só, 25 kg",
          quantity: "4.000000",
          unit: "zsák",
          unitNet: "18000.0000",
          vatRatePercent: "27.00",
        },
      ],
    });
    render(<BillingDocumentEditor contractHandoffKey={key} />);
    await screen.findByText(/Adószám: 12345678-2-42/);
    expect(screen.getByDisplayValue("SZ2026/0000020")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Vázlat mentése|Mentés…/ }),
    );
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, created] = api.create.mock.calls[0]!;
    expect(
      [
        customers.detail.mock.calls[0]?.[1],
        created.customerId,
        created.reference,
        [created.sourceType, created.sourceId],
        created.lines,
        readContractInvoiceHandoff(window.sessionStorage, key),
      ],
      "WEB-INVOICE-FROM-CONTRACT",
    ).toEqual([
      "cust-1",
      "cust-1",
      "SZ2026/0000020",
      ["CONTRACT", "contract-2"],
      [
        expect.objectContaining({
          productId: null,
          description: "Tengeri só, 25 kg",
          quantity: "4",
          unit: "zsák",
          unitNet: "18000",
          vatRatePercent: "27",
        }),
      ],
      null,
    ]);
  });

  /*
    KEREKÍTÉS (barracuda, #1642): a pénztár a forintra kerekített sorokat adja
    át (5127 és 738, gombja 5 865 Ft-ot írt). A szerkesztő bruttó végösszege
    ugyanez, és egyik sor sem jelez eltérést a beírt bruttótól.
  */
  it("the POS total and the invoice total agree, with no line flagged", async () => {
    window.sessionStorage.clear();
    products.detail.mockResolvedValue({ variants: [] });
    const line = {
      unit: "db",
      vatRatePercent: "27",
    };
    const key = writePosInvoiceHandoff(window.sessionStorage, [
      {
        ...line,
        productId: "product-a",
        variantId: "variant-a",
        sku: "AF-1",
        productName: "Aqua Forest Pro",
        quantity: 3,
        lineGross: 5127,
      },
      {
        ...line,
        productId: "product-b",
        variantId: "variant-b",
        sku: "CM-1",
        productName: "Coral Mix",
        quantity: 1,
        lineGross: 738,
      },
    ]);
    render(<BillingDocumentEditor posHandoffKey={key} />);

    expect(await screen.findByDisplayValue("Coral Mix")).toBeInTheDocument();
    expect(within(summary()).getByText("Bruttó").nextSibling).toHaveTextContent(
      /^5\s?865\sFt$/,
    );
    expect(screen.queryByText(/A beírt bruttó/)).not.toBeInTheDocument();
  });

  it("ignores an unknown POS key and opens empty", () => {
    window.sessionStorage.clear();
    render(<BillingDocumentEditor posHandoffKey="missing" />);
    expect(screen.queryAllByLabelText(/tétel megnevezése$/)).toHaveLength(0);
  });

  /*
    A MENTÉS A SZERZŐDÉST KÜLDI. MI PIROSÍT: ha a létrehozás nem a kliens
    azonosítójával menne, ha összeg kerülne a törzsbe, ha a második mentés
    megint létrehozna, vagy az ütközés-őr nélkül menne.
  */
  it("saves: create with the client id and no amounts, then update with the timestamp", async () => {
    render(<BillingDocumentEditor />);
    const save = () =>
      screen.getByRole("button", { name: /Vázlat mentése|Mentés…/ });
    expect(save()).toBeDisabled();

    await pickPartner();
    addLine("Munkadíj", "1", "280000");
    fireEvent.click(save());
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const [, created] = api.create.mock.calls[0]!;
    expect(created).toMatchObject({
      documentType: "INVOICE",
      invoiceFormat: "ELECTRONIC",
      customerId: "cust-1",
    });
    expect(typeof created.id).toBe("string");
    expect(JSON.stringify(created)).not.toMatch(/Amount|total/i);
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        `/penzugy/szamlazas/${created.id}/szerkesztes`,
      ),
    );

    fireEvent.click(save());
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [, id, updated] = api.update.mock.calls[0]!;
    expect(id).toBe(created.id);
    expect(updated.expectedUpdatedAt).toBe("2026-09-30T10:05:00.000Z");
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("the e-mail drawer: variables go into the letter, the preview fills what is known, 'Kész' keeps the letter", async () => {
    render(<BillingDocumentEditor />);
    await pickPartner();
    fireEvent.click(
      screen.getByRole("button", { name: "E-mail szerkesztése" }),
    );
    const drawer = await screen.findByRole("dialog");
    expect(
      within(drawer).getByRole("heading", { name: "E-számla kiküldése" }),
    ).toBeInTheDocument();
    // SZÉLESEBB ÉS BELSŐ MARGÓVAL (Balázs a stage-en, 2026-09-30): a törzs a
    // fejléc px-6-ját kapja, a szöveg nem ér a panel széléhez.
    expect(drawer.className).toMatch(/max-w-\[640px\]/);
    expect(
      within(drawer).getByLabelText("Címzett").closest(".px-6"),
    ).not.toBeNull();
    expect(
      (within(drawer).getByLabelText("Címzett") as HTMLInputElement).value,
    ).toBe("szamlazas@partner.hu");

    // A TÖRZS FORMÁZOTT SZERKESZTŐ (nautilus #1301): a TipTap példányt a
    // saját parancsával állítjuk, ugyanúgy, mint a Levelezés oldal tesztjei.
    const editor = (
      within(drawer).getByLabelText("Levél tartalma") as HTMLElement & {
        editor: {
          getHTML(): string;
          commands: {
            setContent(html: string, o?: { emitUpdate?: boolean }): boolean;
            focus(position: "end"): boolean;
          };
        };
      }
    ).editor;
    await act(async () => {
      editor.commands.setContent("<p>Szia,</p>", { emitUpdate: true });
      editor.commands.focus("end");
    });
    fireEvent.click(
      within(drawer).getByRole("button", {
        name: "{{customer_name}} beszúrása",
      }),
    );
    // A VÁLTOZÓ ATOMKÉNT A LEVÉLBE KERÜL, a korábbi szöveg előtte marad.
    await waitFor(() =>
      expect(editor.getHTML()).toContain(
        'Szia,<span data-variable="customer_name">{{customer_name}}</span>',
      ),
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Levél előnézete" }),
    );
    const frame = within(drawer).getByTitle("Levél előnézete");
    expect(frame.getAttribute("sandbox")).toBe("");
    // az érték az atom helyére kerül, a korábbi szöveg előtte
    expect(frame.getAttribute("srcdoc")).toMatch(
      /<p>Szia,<span[^>]*>Fővárosi Állat- és Növénykert<\/span><\/p>/,
    );
    // A FIÓK CSAK A LEVELET ÁLLÍTJA BE (Balázs, 2026-10-06): „Kész” bezárja,
    // és a levél megmarad, amikor újra megnyitják
    expect(
      within(drawer).getByText(
        "A levelet a „Kiállítás és kiküldés” gomb küldi el.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Kész" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "E-mail szerkesztése" }),
    );
    const reopened = await screen.findByRole("dialog");
    // a fiók az előnézetnél nyílik újra: a megőrzött levél ott látszik
    expect(
      within(reopened).getByTitle("Levél előnézete").getAttribute("srcdoc"),
    ).toMatch(/<p>Szia,<span[^>]*>Fővárosi Állat- és Növénykert<\/span><\/p>/);
  });

  /*
    A KIÁLLÍTÁS (#1279). MI PIROSÍT: ha a gomb megerősítés nélkül állítana ki,
    ha a kiállítás a mentés nélkül (a régi időbélyeggel) menne, ha az e-számla
    a kiküldés nélkül kiállíthatóvá válna, vagy ha egy elutasítás után a vázlat
    csak olvashatóvá válna.
  */
  describe("issuing", () => {
    async function readyPaperInvoice() {
      render(<BillingDocumentEditor />);
      fireEvent.click(radio("Papír alapú"));
      await pickPartner();
      addLine("Munkadíj", "1", "280000");
    }

    it("a paper invoice: confirm, then save and issue with the fresh timestamp, then read-only with the number", async () => {
      api.issue.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        documentNumber: "AC-2026-000001",
      }));
      await readyPaperInvoice();
      const button = screen.getByRole("button", { name: "Számla kiállítása" });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(api.issue).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("dialog");
      // Balázs kérdése, betű szerint (hétfői lista M1)
      expect(dialog).toHaveTextContent("Biztos, hogy kiállítod a számlát?");
      expect(dialog).toHaveTextContent("valódi számla készül a Számlázz.hu-n");
      expect(
        within(dialog).getByRole("button", { name: "Mégsem" }),
      ).toBeEnabled();

      fireEvent.click(
        within(dialog).getByRole("button", { name: "Kiállítom" }),
      );
      await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(1));
      const [, created] = api.create.mock.calls[0]!;
      expect(api.issue).toHaveBeenCalledWith(
        "token-1",
        created.id,
        "2026-09-30T10:05:00.000Z",
      );
      expect(
        await screen.findByText("Kiállítva: AC-2026-000001"),
      ).toBeInTheDocument();
      expect(screen.getByText("Csak olvasható")).toBeInTheDocument();
      // A PAPÍR SZÁMLA LEVELE NEM KÖTELEZŐ: a kiállítás nem küld magától.
      expect(api.email).not.toHaveBeenCalled();
    });

    /*
      AZ E-SZÁMLA: KIÁLLÍTÁS ÉS KIKÜLDÉS EGY LÉPÉSBEN (acrobot 25291). MI
      PIROSÍT: ha a kiküldés a kiállítás előtt menne, vagy nem a szerkesztett
      levéllel; ha a küldés hibája a kiállítást is hibának mutatná (az már
      megtörtént, és nem vonható vissza); ha címzett nélkül is indítható lenne.
    */
    async function readyEInvoice() {
      api.issue.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "PENDING",
        documentNumber: "AC-2026-000002",
      }));
      render(<BillingDocumentEditor />);
      await pickPartner();
      addLine("Munkadíj", "1", "280000");
    }
    const confirmIssueAndSend = async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Kiállítás és kiküldés" }),
      );
      const dialog = await screen.findByRole("dialog");
      // a címzett a kérdésben áll: aki megerősít, látja, hová megy a számla
      expect(dialog).toHaveTextContent(
        "Biztos, hogy kiállítod és kiküldöd a számlát a(z) szamlazas@partner.hu címre?",
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Elküldöm" }));
    };

    it("an e-invoice: issued first, then the edited letter goes out", async () => {
      api.email.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "SENT",
        documentNumber: "AC-2026-000002",
      }));
      await readyEInvoice();
      await confirmIssueAndSend();
      await waitFor(() => expect(api.email).toHaveBeenCalledTimes(1));
      expect(api.issue.mock.invocationCallOrder[0]!).toBeLessThan(
        api.email.mock.invocationCallOrder[0]!,
      );
      const [, id, input] = api.email.mock.calls[0]!;
      expect(id).toBe(api.create.mock.calls[0]![1].id);
      expect(input).toMatchObject({
        mode: "SEND",
        to: ["szamlazas@partner.hu"],
        cc: [],
        bcc: [],
      });
      expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
      // AZ ÉRINTETLEN LEVÉL A LEVELEZÉS OLDAL SABLONJA, nem a fiók helyi
      // alapszövege (nautilus #1293)
      expect(api.templateDraft).toHaveBeenCalledWith("token-1");
      expect(input.subject).toBe("Sablon – {{document_number}}");
      expect(input.body).toBe(
        "Kedves {{customer_name}}! A(z) {{document_number}} számla csatolva.",
      );
      expect(
        await screen.findByText(
          "Az értesítő levél elment: szamlazas@partner.hu.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Kiállítva: AC-2026-000002")).toBeInTheDocument();
    });

    /*
      BALÁZS A STAGE-EN (acrobot 25337): a Levelezés oldalon átírt sablon az
      ÚJ, még nem mentett számla fiókjában nem jelent meg. MI PIROSÍT: ha a
      fiók mentés nélkül nem kérné le a sablont, vagy a beégetett alapszöveget
      mutatná helyette.
    */
    it("a new, unsaved invoice opens its letter from the Levelezés template", async () => {
      render(<BillingDocumentEditor />);
      await pickPartner();
      fireEvent.click(
        screen.getByRole("button", { name: "E-mail szerkesztése" }),
      );
      const drawer = await screen.findByRole("dialog");
      await waitFor(() =>
        expect(
          within(drawer).getByLabelText("Levél tartalma").textContent,
        ).toContain("A(z) {{document_number}} számla csatolva."),
      );
      expect(
        (within(drawer).getByLabelText("Tárgy") as HTMLInputElement).value,
      ).toBe("Sablon – {{document_number}}");
      expect(api.create).not.toHaveBeenCalled();
    });

    it("a letter edited in the drawer goes out as edited, not the template", async () => {
      api.email.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "SENT",
        documentNumber: "AC-2026-000002",
      }));
      await readyEInvoice();
      fireEvent.click(
        screen.getByRole("button", { name: "E-mail szerkesztése" }),
      );
      const drawer = await screen.findByRole("dialog");
      fireEvent.change(within(drawer).getByLabelText("Tárgy"), {
        target: { value: "Saját tárgy" },
      });
      fireEvent.click(within(drawer).getByRole("button", { name: "Mégse" }));
      await confirmIssueAndSend();
      await waitFor(() => expect(api.email).toHaveBeenCalledTimes(1));
      expect(api.email.mock.calls[0]![2].subject).toBe("Saját tárgy");
      // a sablont a fiók megnyitása kérte le egyszer; a kiállítás nem kéri
      // újra, és nem írja felül a kézzel szerkesztett levelet
      expect(api.templateDraft).toHaveBeenCalledTimes(1);
    });

    it("if the template cannot be loaded, no letter goes out, and it says so", async () => {
      api.templateDraft.mockRejectedValue(new Error("A sablon nem érhető el."));
      await readyEInvoice();
      await confirmIssueAndSend();
      const warning = await screen.findByText(
        "A bizonylat kiállítva, de a levél nem ment ki",
      );
      expect(warning.closest("[role=alert]")).toHaveTextContent(
        "A sablon nem érhető el.",
      );
      expect(api.email).not.toHaveBeenCalled();
    });

    it("issued but the letter failed: says both, and points to the details for the retry", async () => {
      api.email.mockRejectedValue(new Error("A levélküldés ki van kapcsolva."));
      await readyEInvoice();
      await confirmIssueAndSend();
      const warning = await screen.findByText(
        "A bizonylat kiállítva, de a levél nem ment ki",
      );
      const box = warning.closest("[role=alert]")!;
      expect(box).toHaveTextContent("A levélküldés ki van kapcsolva.");
      expect(box).toHaveTextContent("A kiállítás ettől érvényes");
      expect(
        within(box as HTMLElement).getByRole("link", {
          name: "Részletek és újrapróbálás",
        }),
      ).toHaveAttribute(
        "href",
        `/penzugy/szamlazas/${api.create.mock.calls[0]![1].id}`,
      );
      expect(screen.getByText("Kiállítva: AC-2026-000002")).toBeInTheDocument();
      expect(screen.getByText("Csak olvasható")).toBeInTheDocument();
    });

    /*
      A KÁRTYA 7976970f (barracuda #1659): az új számla kiállítása az `/uj`
      útról a `/{id}/szerkesztes` útra vált, és a szerkesztő ott újra
      felépül. A `navigation.replace` itt alapból üres, ezért az újraépülést
      ez a segéd játssza le. MI PIROSÍT: ha a kiküldés eredménye a régi
      példányban marad, az új példány nem mutat sem "Kiküldve", sem "nem ment
      ki" sávot.
    */
    const remountOnReplace = () => {
      let view: ReturnType<typeof render> | undefined;
      navigation.replace.mockImplementation((path: string) => {
        const id = path.split("/")[3]!;
        api.detail.mockResolvedValue({
          ...detailFrom(api.create.mock.calls[0]![1], id),
          status: "ISSUED",
          emailStatus: "SENT",
          documentNumber: "AC-2026-000002",
        });
        view?.unmount();
        view = render(<BillingDocumentEditor documentId={id} />);
      });
      return (first: ReturnType<typeof render>) => {
        view = first;
      };
    };

    it("a new invoice navigates after issuing: the new editor still shows that the letter went out", async () => {
      window.sessionStorage.clear();
      api.email.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "SENT",
        documentNumber: "AC-2026-000002",
      }));
      const adopt = remountOnReplace();
      api.issue.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "PENDING",
        documentNumber: "AC-2026-000002",
      }));
      adopt(render(<BillingDocumentEditor />));
      await pickPartner();
      addLine("Munkadíj", "1", "280000");
      await confirmIssueAndSend();
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
      // az útváltás a küldés UTÁN jön, különben az eredmény a régi példányban ragad
      expect(api.email.mock.invocationCallOrder[0]!).toBeLessThan(
        navigation.replace.mock.invocationCallOrder[0]!,
      );
      expect(
        await screen.findByText(
          "Az értesítő levél elment: szamlazas@partner.hu.",
        ),
      ).toBeInTheDocument();
      // egyszer olvasható: egy későbbi megnyitás nem mutatja újra
      expect(
        window.sessionStorage.getItem(
          `billing-send-result.${api.create.mock.calls[0]![1].id}`,
        ),
      ).toBeNull();
    });

    it("a new invoice navigates after issuing: the new editor still shows that the letter failed", async () => {
      window.sessionStorage.clear();
      api.email.mockRejectedValue(new Error("A levélküldés ki van kapcsolva."));
      const adopt = remountOnReplace();
      api.issue.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        emailStatus: "PENDING",
        documentNumber: "AC-2026-000002",
      }));
      adopt(render(<BillingDocumentEditor />));
      await pickPartner();
      addLine("Munkadíj", "1", "280000");
      await confirmIssueAndSend();
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
      const warning = await screen.findByText(
        "A bizonylat kiállítva, de a levél nem ment ki",
      );
      expect(warning.closest("[role=alert]")).toHaveTextContent(
        "A levélküldés ki van kapcsolva.",
      );
    });

    /*
      BARRACUDA, #1729: ahol a böngésző a webhely-adatot tiltja, maga a
      `window.sessionStorage` olvasása dob. MI PIROSÍT: ha a tár elérése a
      `try` előtt (argumentumként) történik, (a) minden meglévő bizonylat
      szerkesztője betöltési hibára fut, (b) a kiállított új számla
      "A kiállítás nem sikerült" üzenetet kap, és nem vált útra.
    */
    const blockSiteData = () =>
      vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      });

    it("with site data blocked, an existing document still loads", async () => {
      const blocked = blockSiteData();
      try {
        api.detail.mockReset().mockResolvedValue(
          detailFrom(
            {
              documentType: "INVOICE",
              invoiceFormat: "PAPER",
              currency: "HUF",
              language: "hu",
              lines: [],
            },
            "draft-blocked",
          ),
        );
        render(<BillingDocumentEditor documentId="draft-blocked" />);
        await waitFor(() =>
          expect(api.detail).toHaveBeenCalledWith(
            "token-1",
            "draft-blocked",
            expect.anything(),
          ),
        );
        // a betöltés nem esik hibára (a hiba-sáv szövege a betöltési hiba)
        await waitFor(() =>
          expect(screen.queryByText(/nem tölthető be/)).toBeNull(),
        );
        // a név több helyen áll az oldalon: elég, hogy a betöltött adat megjelent
        expect(
          (await screen.findAllByText("Fővárosi Állat- és Növénykert")).length,
        ).toBeGreaterThan(0);
      } finally {
        blocked.mockRestore();
      }
    });

    it("with site data blocked, a new invoice is still issued and navigates without an issue error", async () => {
      const blocked = blockSiteData();
      try {
        api.email.mockImplementation(async (_token, id) => ({
          ...detailFrom(api.create.mock.calls[0]![1], id),
          status: "ISSUED",
          emailStatus: "SENT",
          documentNumber: "AC-2026-000002",
        }));
        api.issue.mockImplementation(async (_token, id) => ({
          ...detailFrom(api.create.mock.calls[0]![1], id),
          status: "ISSUED",
          emailStatus: "PENDING",
          documentNumber: "AC-2026-000002",
        }));
        render(<BillingDocumentEditor />);
        await pickPartner();
        addLine("Munkadíj", "1", "280000");
        await confirmIssueAndSend();
        await waitFor(() =>
          expect(navigation.replace).toHaveBeenCalledTimes(1),
        );
        expect(screen.queryByText(/A kiállítás nem sikerült/)).toBeNull();
      } finally {
        blocked.mockRestore();
      }
    });

    it("an e-invoice without a recipient cannot be issued, and says why", async () => {
      customers.detail.mockResolvedValue({
        id: "cust-1",
        customerNumber: "V-1",
        displayName: "Állatkert",
        companyName: "Fővárosi Állat- és Növénykert",
        email: null,
        taxNumber: "12345678-2-42",
        address: "1146 Budapest, Állatkerti krt. 6-12.",
      });
      render(<BillingDocumentEditor />);
      await pickPartner();
      addLine("Munkadíj", "1", "280000");
      expect(
        screen.getByRole("button", { name: "Kiállítás és kiküldés" }),
      ).toBeDisabled();
      expect(
        screen.getByText(/Add meg a kiküldési e-mail címzettjét/),
      ).toBeInTheDocument();
    });

    it("a refused issue (the switch is off) shows the reason and the draft stays editable", async () => {
      api.issue.mockRejectedValue(
        new Error("A valódi kiállítás ki van kapcsolva."),
      );
      await readyPaperInvoice();
      fireEvent.click(
        screen.getByRole("button", { name: "Számla kiállítása" }),
      );
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Kiállítom",
        }),
      );
      expect(
        await screen.findByText("A valódi kiállítás ki van kapcsolva."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Csak olvasható")).toBeNull();
    });

    /*
      A SZÁMLAKÉP ÉS A PDF A „KIÁLLÍTVA” SÁVBAN (hétfői lista M2, Luca kérése).
      MI PIROSÍT: ha a sávban nincs a két gomb; ha nem a hivatalos PDF-et kérik
      le (a kiállított bizonylat azonosítójával); ha a még meg nem lévő PDF-re
      kattintható; ha egy újratöltött kiállított bizonylatnál a sáv eltűnik.
    */
    const issuedPaper = (pdfAvailable: boolean) =>
      api.issue.mockImplementation(async (_token, id) => ({
        ...detailFrom(api.create.mock.calls[0]![1], id),
        status: "ISSUED",
        documentNumber: "AC-2026-000003",
        pdf: { available: pdfAvailable },
      }));
    const issuePaper = async () => {
      await readyPaperInvoice();
      fireEvent.click(
        screen.getByRole("button", { name: "Számla kiállítása" }),
      );
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Kiállítom",
        }),
      );
      return within(
        await screen.findByRole("group", {
          name: "A kiállított bizonylat PDF-je",
        }),
      );
    };

    it("the issued bar opens the invoice image and downloads the official PDF", async () => {
      issuedPaper(true);
      api.pdf.mockResolvedValue(
        new Blob(["%PDF"], { type: "application/pdf" }),
      );
      URL.createObjectURL = vi.fn(() => "blob:szamla");
      URL.revokeObjectURL = vi.fn();
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const bar = await issuePaper();
      const id = api.create.mock.calls[0]![1].id;

      fireEvent.click(
        bar.getByRole("button", { name: "Számlakép megtekintése" }),
      );
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith("blob:szamla", "_blank"),
      );
      fireEvent.click(bar.getByRole("button", { name: "PDF letöltése" }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(
        [
          api.pdf.mock.calls,
          (click.mock.contexts[0] as HTMLAnchorElement).download,
        ],
        "WEB-ISSUED-PDF",
      ).toEqual([
        [
          ["token-1", id],
          ["token-1", id],
        ],
        "AC-2026-000003.pdf",
      ]);
      open.mockRestore();
      click.mockRestore();
    });

    it("an issued invoice whose PDF is not stored yet: both buttons off, with the reason", async () => {
      issuedPaper(false);
      const bar = await issuePaper();
      const buttons = ["Számlakép megtekintése", "PDF letöltése"].map((name) =>
        bar.getByRole("button", { name }),
      );
      expect(
        buttons.map((button) => [
          (button as HTMLButtonElement).disabled,
          button.getAttribute("title"),
        ]),
        "WEB-ISSUED-PDF-MISSING",
      ).toEqual([
        [true, expect.stringMatching(/még nem érhető el/)],
        [true, expect.stringMatching(/még nem érhető el/)],
      ]);
      expect(api.pdf).not.toHaveBeenCalled();
    });

    it("an issued invoice opened in the editor (after the route switch) keeps the bar", async () => {
      api.detail.mockReset().mockResolvedValue({
        ...detailFrom(
          {
            documentType: "INVOICE",
            invoiceFormat: "PAPER",
            currency: "HUF",
            language: "hu",
            lines: [],
          },
          "doc-issued",
        ),
        status: "ISSUED",
        documentNumber: "AC-2026-000004",
        pdf: { available: true },
      });
      render(<BillingDocumentEditor documentId="doc-issued" />);
      expect(
        await screen.findByText("Kiállítva: AC-2026-000004"),
        "WEB-ISSUED-RELOAD",
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "PDF letöltése" }),
      ).toBeEnabled();
    });

    /*
      A SZTORNÓ A „KIÁLLÍTVA” SÁVBAN (számlázási brief, 1. pont). MI PIROSÍT:
      ha a gomb hiányzik a kiállított számla sávjából; ha a megerősítés nem a
      brief szövege; ha a kérés nem erre a bizonylatra megy; ha a sztornó után
      a gomb megmarad, vagy egy már sztornózott számlán felkínálja.
    */
    const issuedInvoice = (over: Partial<BillingDocumentDetail> = {}) => ({
      ...detailFrom(
        {
          documentType: "INVOICE",
          invoiceFormat: "PAPER",
          currency: "HUF",
          language: "hu",
          lines: [],
        },
        "doc-issued",
      ),
      status: "ISSUED" as const,
      documentNumber: "AC-2026-000004",
      pdf: { available: true },
      ...over,
    });
    const stornoDone = {
      source: "OS" as const,
      state: "ISSUED" as const,
      stornoNumber: "AC-2026-000005",
      issueDate: "2026-10-12",
      error: null,
      pdfAvailable: true,
    };

    it("the issued bar offers the storno, and after it says so", async () => {
      api.detail.mockReset().mockResolvedValue(issuedInvoice());
      api.storno.mockResolvedValue(issuedInvoice({ cancellation: stornoDone }));
      render(<BillingDocumentEditor documentId="doc-issued" />);
      fireEvent.click(await screen.findByRole("button", { name: "Sztornó" }));
      const dialog = screen.getByRole("dialog", {
        name: "Biztos, hogy sztornózod a(z) AC-2026-000004 számlát?",
      });
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Sztornózom" }),
      );
      expect(
        await screen.findByText("Sztornózva: AC-2026-000005"),
      ).toBeInTheDocument();
      expect(api.storno).toHaveBeenCalledWith("token-1", "doc-issued");
      expect(screen.queryByRole("button", { name: "Sztornó" })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("an already stornoed invoice shows it, and offers no second storno", async () => {
      api.detail
        .mockReset()
        .mockResolvedValue(issuedInvoice({ cancellation: stornoDone }));
      render(<BillingDocumentEditor documentId="doc-issued" />);
      expect(
        await screen.findByText("Sztornózva: AC-2026-000005"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sztornó" })).toBeNull();
    });
  });

  /*
    BRUTTÓ IS BEÍRHATÓ (Balázs a stage-en, 2026-09-30 17:04 UTC). MI PIROSÍT:
    ha a nettó egységár nem a Számlázz.hu szabályával számolódik vissza; ha a
    mentés a bruttót küldené a nettó helyett; ha egy pontosan ki nem jövő
    bruttó csendben másra változna; ha a mennyiség szerkesztése után a régi
    beírt bruttó ragadna a mezőben.
  */
  describe("gross input", () => {
    const grossOf = (description: string) =>
      screen.getByLabelText(`${description} bruttó összege`);
    const netOf = (description: string) =>
      screen.getByLabelText(
        `${description} nettó egységára`,
      ) as HTMLInputElement;

    it("the net unit price comes back from the gross, and the draft saves the net", async () => {
      render(<BillingDocumentEditor />);
      await pickPartner();
      addLine("Munkadíj", "1", "");
      fireEvent.change(grossOf("Munkadíj"), { target: { value: "12700" } });
      expect(netOf("Munkadíj").value).toBe("10000");
      expect(screen.queryByText(/pontosan nem jön ki/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Vázlat mentése" }));
      await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
      const [, created] = api.create.mock.calls[0]!;
      expect(created.lines[0]).toMatchObject({ unitNet: "10000" });
      expect(JSON.stringify(created)).not.toMatch(/gross/i);
    });

    it("a gross the rule cannot reach exactly says what the invoice will show", () => {
      render(<BillingDocumentEditor />);
      addLine("Munkadíj", "1", "");
      fireEvent.change(grossOf("Munkadíj"), { target: { value: "10000" } });
      expect(netOf("Munkadíj").value).toBe("7874.02");
      expect(
        screen.getByText(/pontosan nem jön ki/).closest("[role=status]"),
      ).toHaveTextContent(
        /A beírt bruttó \(10\s000,00\sFt\).*a tétel bruttója 10\s000,01\sFt lesz\./,
      );
    });

    it("editing the quantity lets go of the typed gross", () => {
      render(<BillingDocumentEditor />);
      addLine("Munkadíj", "1", "");
      fireEvent.change(grossOf("Munkadíj"), { target: { value: "12700" } });
      fireEvent.change(screen.getByLabelText("Munkadíj mennyisége"), {
        target: { value: "2" },
      });
      expect(netOf("Munkadíj").value).toBe("10000");
      expect((grossOf("Munkadíj") as HTMLInputElement).value).toBe("25400");
    });
  });

  /*
    A TERMÉK ÁRA A TÉTELBE (Balázs a stage-en, 2026-09-30; a szabály acrobot
    25248-ban). MI PIROSÍT: ha a választás után az egységár üres maradna ott,
    ahol a terméknek van ára; ha egy ACROPORA-gazdájú termék a befagyott tükör
    árát kapná; ha ár nélkül nulla kerülne a mezőbe, vagy nem derülne ki, miért
    üres; ha a késve érkező ár felülírná, amit közben kézzel beírtak.
  */
  describe("a picked product's price", () => {
    const listed = {
      id: "prod-1",
      name: "Tengeri só",
      primarySku: "SALT-1",
    };
    const detailOf = (overrides: Record<string, unknown>) => ({
      ...listed,
      catalogAuthority: "UNAS",
      variants: [
        {
          sku: "SALT-1",
          isActive: true,
          vatRate: "18.00",
          sellingGrossPrice: null,
          sellingPriceCurrency: null,
        },
      ],
      unasMirror: {
        currency: "HUF",
        netPrice: "1000.0000",
        grossPrice: "1180.0000",
        vatRate: "18.00",
        saleNetPrice: "800.0000",
      },
      ...overrides,
    });
    async function pickProduct() {
      products.list.mockResolvedValue({ items: [listed] });
      fireEvent.click(
        screen.getByRole("button", { name: "Termék hozzáadása" }),
      );
      fireEvent.change(screen.getByLabelText("Termék keresése"), {
        target: { value: "Tengeri" },
      });
      fireEvent.click(
        await screen.findByRole("button", { name: /Tengeri só/ }),
      );
    }
    const net = () =>
      screen.getByLabelText("Tengeri só nettó egységára") as HTMLInputElement;
    const rate = () =>
      screen.getByLabelText("Tengeri só ÁFA-kulcsa") as HTMLInputElement;

    it("a UNAS product brings the mirror's net list price and its VAT rate, and stays editable", async () => {
      products.detail.mockResolvedValue(detailOf({}));
      render(<BillingDocumentEditor />);
      await pickProduct();
      await waitFor(() => expect(net().value).toBe("1000"));
      expect(rate().value).toBe("18");
      expect(products.detail).toHaveBeenCalledWith("token-1", "prod-1");
      fireEvent.change(net(), { target: { value: "950" } });
      expect(net().value).toBe("950");
    });

    it("a product we own brings our gross price, back-calculated to the net", async () => {
      products.detail.mockResolvedValue(
        detailOf({
          catalogAuthority: "ACROPORA",
          variants: [
            {
              sku: "SALT-1",
              isActive: true,
              vatRate: "27.00",
              sellingGrossPrice: "1524.0000",
              sellingPriceCurrency: "HUF",
            },
          ],
        }),
      );
      render(<BillingDocumentEditor />);
      await pickProduct();
      await waitFor(() => expect(net().value).toBe("1200"));
      expect(rate().value).toBe("27");
    });

    it("no price: the unit price stays empty, not zero, and the line says why", async () => {
      products.detail.mockResolvedValue(
        detailOf({ unasMirror: { currency: "HUF", netPrice: null } }),
      );
      render(<BillingDocumentEditor />);
      await pickProduct();
      expect(
        await screen.findByText(
          /Az egységár nem töltődött ki: A terméknek nincs nettó ára/,
        ),
      ).toBeInTheDocument();
      expect(net().value).toBe("");
      fireEvent.change(net(), { target: { value: "500" } });
      expect(screen.queryByText(/Az egységár nem töltődött ki/)).toBeNull();
    });

    /*
      A VÁLTOZAT (kártya 705768fc). MI PIROSÍT: ha a több változatú termék
      sora nem kérdezné meg, melyik változat; ha az inaktív is választható
      lenne; ha a választás nem menne el a mentéssel; ha az egyváltozatú
      termék is választót kapna.
    */
    it("several active variants: the line asks which one, and the draft carries it", async () => {
      const variant = (
        id: string,
        sku: string,
        name: string | null,
        isActive = true,
      ) => ({
        id,
        sku,
        name,
        isActive,
        vatRate: "18.00",
        sellingGrossPrice: null,
        sellingPriceCurrency: null,
      });
      products.detail.mockResolvedValue(
        detailOf({
          variants: [
            variant("v-a", "SALT-1", "1 kg"),
            variant("v-b", "SALT-5", "5 kg"),
            variant("v-c", "SALT-OLD", null, false),
          ],
        }),
      );
      render(<BillingDocumentEditor />);
      await pickPartner();
      await pickProduct();
      const select = (await screen.findByLabelText(
        "Tengeri só változata",
      )) as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toEqual([
        "Válassz változatot",
        "SALT-1 · 1 kg",
        "SALT-5 · 5 kg",
      ]);
      expect(
        screen.getByText("Változat nélkül a készlet nem csökken."),
      ).toBeInTheDocument();
      fireEvent.change(select, { target: { value: "v-b" } });
      expect(
        screen.queryByText("Változat nélkül a készlet nem csökken."),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: /Vázlat mentése|Mentés…/ }),
      );
      await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
      const [, created] = api.create.mock.calls[0]!;
      expect(created.lines[0]).toMatchObject({
        productId: "prod-1",
        variantId: "v-b",
      });
    });

    it("a reopened draft loads its product line's variants and shows the saved choice", async () => {
      products.detail.mockResolvedValue(
        detailOf({
          variants: [
            { id: "v-a", sku: "SALT-1", name: "1 kg", isActive: true },
            { id: "v-b", sku: "SALT-5", name: "5 kg", isActive: true },
          ],
        }),
      );
      api.detail.mockReset().mockResolvedValue(
        detailFrom(
          {
            documentType: "INVOICE",
            invoiceFormat: "PAPER",
            currency: "HUF",
            language: "hu",
            lines: [
              {
                productId: "prod-1",
                variantId: "v-b",
                description: "Tengeri só",
                quantity: "1.000000",
                unit: "db",
                unitNet: "1000.0000",
                vatRatePercent: "18.00",
                discountPercent: null,
                comment: null,
              },
            ],
          },
          "draft-9",
        ),
      );
      render(<BillingDocumentEditor documentId="draft-9" />);
      const select = (await screen.findByLabelText(
        "Tengeri só változata",
      )) as HTMLSelectElement;
      expect(select.value).toBe("v-b");
      expect(products.detail).toHaveBeenCalledWith("token-1", "prod-1");
    });

    it("one active variant: nothing to choose", async () => {
      products.detail.mockResolvedValue(detailOf({}));
      render(<BillingDocumentEditor />);
      await pickProduct();
      await waitFor(() => expect(net().value).toBe("1000"));
      expect(screen.queryByLabelText("Tengeri só változata")).toBeNull();
    });

    it("a price that arrives after a hand-typed one does not overwrite it", async () => {
      let resolve!: (value: unknown) => void;
      products.detail.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      render(<BillingDocumentEditor />);
      await pickProduct();
      fireEvent.change(net(), { target: { value: "777" } });
      await act(async () => {
        resolve(detailOf({}));
      });
      expect(net().value).toBe("777");
    });
  });

  /*
    A STAGE-VISSZAJELZÉS (Balázs, 2026-09-30 17:04 UTC): "a partnerekbol nem
    talal senkit". A választó 8 sort kért, a szerver 10 alatt 400-zal utasít
    el, és a választó ezt "Nincs találat."-nak mutatta. MI PIROSÍT: ha a kérés
    a szerver alsó határa alatti lapméretet kér; ha egy elutasított keresés
    megint üres listának látszik.
  */
  /*
    A VEVŐ FIZETÉSI NAPJAI (Balázs, 2026-10-06 08:27 UTC). MI PIROSÍT: a
    30 napos vevő választása után a határidő a nyolc napos alapértéken marad;
    egy kézzel átírt határidőt egy későbbi vevőválasztás felülír.
  */
  describe("the customer's payment days", () => {
    const plusDays = (day: string, days: number) => {
      const date = new Date(`${day}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const value = (label: string) =>
      (screen.getByLabelText(label) as HTMLInputElement).value;

    it("picking a 30-day customer moves the due date to 30 days after fulfillment", async () => {
      customers.detail.mockResolvedValue({
        id: "cust-1",
        customerNumber: "V-1",
        displayName: "Állatkert",
        companyName: "Fővárosi Állat- és Növénykert",
        email: "szamlazas@partner.hu",
        taxNumber: "12345678-2-42",
        address: "1146 Budapest, Állatkerti krt. 6-12.",
        paymentDueDays: 30,
      });
      render(<BillingDocumentEditor />);
      await pickPartner();
      expect(value("Fizetési határidő")).toBe(
        plusDays(value("Teljesítés dátuma"), 30),
      );
    });

    /*
      KÁRTYA 7be4a85b, mérve 2026-10-06 élesen: az Állatkert két vevő-soron
      áll, a választott sor napjai üresek, a Partnerek oldalon 30 nap áll.
      MI PIROSÍT: ha a szerkesztő ilyenkor a 8 napos alapértéket adja, vagy
      nem mondja ki, honnan jött a 30 nap.
    */
    it("a customer row without days takes the matching partner's days, and says so", async () => {
      customers.detail.mockResolvedValue({
        id: "cust-2",
        customerNumber: "VEVO-1",
        displayName: "Fővárosi Állat- és Növénykert",
        companyName: "Fővárosi Állat- és Növénykert",
        email: "szamlazas@partner.hu",
        taxNumber: "12345678-2-42",
        address: "1146 Budapest, Állatkerti krt. 6-12.",
        paymentDueDays: null,
        partnerTerms: {
          paymentDueDays: 30,
          partnerName: "Fővárosi Állat- és Növénykert",
        },
      });
      render(<BillingDocumentEditor />);
      await pickPartner();
      expect(value("Fizetési határidő")).toBe(
        plusDays(value("Teljesítés dátuma"), 30),
      );
      expect(
        screen.getByText(
          /30 nap, a\(z\) Fővárosi Állat- és Növénykert partner beállításából/,
        ),
      ).toBeTruthy();
    });

    it("a due date typed by hand stays when the customer is picked", async () => {
      customers.detail.mockResolvedValue({
        id: "cust-1",
        customerNumber: "V-1",
        displayName: "Állatkert",
        companyName: "Fővárosi Állat- és Növénykert",
        email: "szamlazas@partner.hu",
        taxNumber: "12345678-2-42",
        address: "1146 Budapest, Állatkerti krt. 6-12.",
        paymentDueDays: 30,
      });
      render(<BillingDocumentEditor />);
      fireEvent.change(screen.getByLabelText("Fizetési határidő"), {
        target: { value: "2030-01-15" },
      });
      await pickPartner();
      expect(value("Fizetési határidő")).toBe("2030-01-15");
    });
  });

  describe("the partner picker", () => {
    it("asks for a page size the server accepts", async () => {
      render(<BillingDocumentEditor />);
      await pickPartner();
      const [, query] = customers.list.mock.calls[0]!;
      expect((query as URLSearchParams).get("pageSize")).toBe(
        String(CUSTOMER_LIST_PAGE_SIZE.min),
      );
    });

    it("a refused search says so, not 'Nincs találat'", async () => {
      customers.list.mockRejectedValue(
        new Error("pageSize must not be less than 10"),
      );
      render(<BillingDocumentEditor />);
      fireEvent.change(screen.getByLabelText("Partner keresése"), {
        target: { value: "Főv" },
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "A partnerek keresése nem sikerült: pageSize must not be less than 10",
      );
      expect(screen.queryByText("Nincs találat.")).toBeNull();
    });
  });

  /*
    A VÉGSZÁMLA-VÁZLAT (számlázási brief, 3. pont, #1672). MI PIROSÍT: a
    kezelő nem látja, hogy a tételek a teljes ellenérték, és melyik előleget
    vonja le a Számlázz.hu; vagy egy rendes számlán is ezt látja.
  */
  it("a final invoice's draft says the items are the full price, and which advance Számlázz.hu deducts", async () => {
    api.detail.mockReset().mockResolvedValue({
      ...detailFrom(
        {
          documentType: "FINAL_INVOICE",
          invoiceFormat: "ELECTRONIC",
          currency: "HUF",
          language: "hu",
          lines: [],
        },
        "fin-1",
      ),
      deductedAdvance: {
        id: "adv-1",
        number: "E-ELO-1",
        grossAmount: "38100.0000",
      },
    });
    render(<BillingDocumentEditor documentId="fin-1" />);
    expect(
      await screen.findByText(
        /A tételek a TELJES ellenérték.*E-ELO-1 előleget \(bruttó 38\s100.*\) a Számlázz\.hu vonja le/,
      ),
    ).toBeInTheDocument();
  });

  it("an invoice's draft carries no final-invoice note", async () => {
    api.detail.mockReset().mockResolvedValue(
      detailFrom(
        {
          documentType: "INVOICE",
          invoiceFormat: "PAPER",
          currency: "HUF",
          language: "hu",
          lines: [],
        },
        "inv-1",
      ),
    );
    render(<BillingDocumentEditor documentId="inv-1" />);
    await screen.findByRole("heading", { level: 1, name: "Új számla" });
    expect(screen.queryByText(/A tételek a TELJES ellenérték/)).toBeNull();
  });

  /*
    AZ AUTOKASSZA AZ ELŐLEG-VÁZLATON (számlázási brief, 2. pont). MI PIROSÍT:
    egy kifizetett díjbekérőből készült előlegnél nincs figyelmeztetés; egy
    nem kifizetettnél (vagy ismeretlennél) mégis van.
  */
  it("an advance from a paid proforma warns before the issue; an unpaid or unknown one does not", async () => {
    const advanceDraft = (paid: boolean | null) => ({
      ...detailFrom(
        {
          documentType: "ADVANCE_INVOICE",
          invoiceFormat: "ELECTRONIC",
          currency: "HUF",
          language: "hu",
          lines: [],
        },
        "adv-1",
      ),
      proforma: { id: "pro-1", number: "D-2026-7", paid },
    });
    api.detail.mockReset().mockResolvedValue(advanceDraft(true));
    const { unmount } = render(<BillingDocumentEditor documentId="adv-1" />);
    expect(
      await screen.findByText(/D-2026-7 kifizetett.*Autokasszája/),
    ).toBeInTheDocument();
    unmount();
    for (const paid of [false, null]) {
      api.detail.mockReset().mockResolvedValue(advanceDraft(paid));
      const view = render(<BillingDocumentEditor documentId="adv-1" />);
      await screen.findByRole("heading", { level: 1, name: "Új előlegszámla" });
      expect(screen.queryByText(/Autokasszája/)).toBeNull();
      view.unmount();
    }
  });
});
