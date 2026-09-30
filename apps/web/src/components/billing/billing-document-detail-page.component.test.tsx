import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { BillingDocumentDetail, Session, UserRole } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingDocumentDetailPage } from "./billing-document-detail-page";

/**
 * EGY BIZONYLAT RÉSZLETEI (Balázs briefje, 2026-09-30, 9-21. és 31. pont).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/penzugy/szamlazas/doc-1",
  useSearchParams: () => new URLSearchParams(),
}));

// A részletek oldala CSAK ezt a hármat hívhatja: a kiállításhoz vagy a
// vázlat mentéséhez nincs tagja a duplának, tehát egy ilyen hívás itt dobna.
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  pdf: vi.fn(),
  email: vi.fn(),
  emailDraft: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
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

function detail(
  overrides: Partial<BillingDocumentDetail> = {},
): BillingDocumentDetail {
  return {
    id: "doc-1",
    status: "ISSUED",
    emailStatus: "SENT",
    documentNumber: "AC-2026-001248",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    customerSource: "ISSUED_SNAPSHOT",
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
    issueDate: "2026-09-30",
    fulfillmentDate: "2026-09-30",
    dueDate: "2026-10-08",
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    reference: "PROJ-0268",
    note: null,
    sourceType: "PROJECT",
    sourceId: "PROJ-0268",
    lines: [
      {
        id: "l1",
        kind: "ITEM",
        parentLineId: null,
        productId: null,
        description: "Karbantartási munkadíj",
        quantity: "1.000000",
        unit: "db",
        unitNet: "280000.0000",
        vatRatePercent: "27.00",
        discountPercent: null,
        netAmount: "280000.0000",
        vatAmount: "75600.0000",
        grossAmount: "355600.0000",
        comment: "Szeptember havi átalány",
      },
      {
        id: "l2",
        kind: "ITEM",
        parentLineId: null,
        productId: null,
        description: "Tropic Marin Pro-Reef 25 kg",
        quantity: "2.000000",
        unit: "db",
        unitNet: "30000.0000",
        vatRatePercent: "5.00",
        discountPercent: "10.00",
        netAmount: "60000.0000",
        vatAmount: "3000.0000",
        grossAmount: "63000.0000",
        comment: null,
      },
      {
        id: "l3",
        kind: "DISCOUNT",
        parentLineId: "l2",
        productId: null,
        description: "Kedvezmény (10%)",
        quantity: "1.000000",
        unit: null,
        unitNet: "-6000.0000",
        vatRatePercent: "5.00",
        discountPercent: "10.00",
        netAmount: "-6000.0000",
        vatAmount: "-300.0000",
        grossAmount: "-6300.0000",
        comment: null,
      },
    ],
    totals: {
      netAmount: "334000",
      vatAmount: "78300",
      grossAmount: "412300",
      byVatRate: [
        {
          vatRatePercent: "5.00",
          netAmount: "54000",
          vatAmount: "2700",
          grossAmount: "56700",
        },
        {
          vatRatePercent: "27.00",
          netAmount: "280000",
          vatAmount: "75600",
          grossAmount: "355600",
        },
      ],
    },
    szamlazz: {
      documentNumber: "AC-2026-001248",
      issueState: "ISSUED",
      externalId: "doc-1",
      issueAttemptCount: 1,
      lastError: null,
      documentUrl: null,
    },
    pdf: { available: true },
    delivery: {
      status: "SENT",
      lastAttempt: {
        recipients: { to: ["szamlazas@partner.hu"], cc: [], bcc: [] },
        outcome: "SENT",
        at: "2026-09-30T12:32:00.000Z",
        error: null,
      },
      canResend: true,
    },
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T12:32:00.000Z",
    ...overrides,
  } as BillingDocumentDetail;
}

const openSpy = vi.fn();
const printSpy = vi.fn();

beforeEach(() => {
  auth.role = "OWNER";
  navigation.push.mockReset();
  api.email.mockReset();
  api.emailDraft.mockReset().mockResolvedValue({
    source: "default",
    subject: "Acropora – {{document_number}}",
    body: "Kedves {{customer_name}}! {{document_number}}",
    variables: [],
  });
  api.detail.mockReset().mockResolvedValue(detail());
  api.pdf
    .mockReset()
    .mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  openSpy.mockReset().mockReturnValue({
    addEventListener: (_event: string, listener: () => void) => listener(),
    print: printSpy,
  });
  printSpy.mockReset();
  vi.stubGlobal("open", openSpy);
  URL.createObjectURL = vi.fn(() => "blob:pdf");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const actions = () =>
  screen.getByRole("group", { name: "Bizonylat műveletei" });

describe("BillingDocumentDetailPage", () => {
  it("the header: type and format, the number, customer and source, the two statuses apart", async () => {
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "AC-2026-001248" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Számla · E-számla")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fővárosi Állat- és Növénykert · Forrás: Projekt · PROJ-0268",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Kiállítva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Elküldve").length).toBeGreaterThan(0);
  });

  it("the customer card says it shows the snapshot from issuing", async () => {
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    expect(
      await screen.findByText(
        "A bizonylaton szereplő vevőadatok, a kiállítás pillanatában.",
      ),
    ).toBeInTheDocument();
  });

  /*
    A PILLANATKÉP HIÁNYA NEM LEHET CSENDES (brief 15. pont). MI PIROSÍT: ha
    egy kiállított bizonylatnál a partner mai adata úgy állna ott, mintha az
    lenne a számlán.
  */
  it("an issued document without a snapshot says the data is today's, not the invoice's", async () => {
    api.detail.mockResolvedValue(detail({ customerSource: undefined }));
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    expect(
      await screen.findByText(
        /a partner mai adatai látszanak, a bizonylaton más állhat/,
      ),
    ).toBeInTheDocument();
  });

  it("lines with their comments, the discount as its own line, totals with every VAT rate", async () => {
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    expect(
      await screen.findByText("Megjegyzés: Szeptember havi átalány"),
    ).toBeInTheDocument();
    expect(screen.getByText("Kedvezmény (10%)")).toBeInTheDocument();
    expect(screen.getByText("ÁFA (5%)")).toBeInTheDocument();
    expect(screen.getByText("ÁFA (27%)")).toBeInTheDocument();
    expect(screen.getByText("Bruttó").nextSibling).toHaveTextContent(
      /412\s300\sFt/,
    );
  });

  /*
    A NYOMTATÁS A HIVATALOS PDF (brief 12. pont). MI PIROSÍT: ha a lap DOM-ját
    nyomtatná (window.print), vagy a PDF nélkül nyitna ablakot.
  */
  it("print opens the stored official PDF, not the page", async () => {
    const pagePrint = vi.fn();
    vi.stubGlobal("print", pagePrint);
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    fireEvent.click(
      await within(
        await screen.findByRole("group", { name: "Bizonylat műveletei" }),
      ).findByRole("button", { name: "Nyomtatás" }),
    );
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    expect(api.pdf).toHaveBeenCalledWith("token-1", "doc-1");
    expect(openSpy).toHaveBeenCalledWith("blob:pdf", "_blank");
    expect(pagePrint).not.toHaveBeenCalled();
  });

  it("a draft: no official PDF, so print and download are disabled, and the editor is one click away", async () => {
    api.detail.mockResolvedValue(
      detail({
        status: "DRAFT",
        documentNumber: null,
        pdf: { available: false },
      }),
    );
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    await screen.findByRole("heading", { level: 1, name: "Piszkozat" });
    expect(
      within(actions()).getByRole("button", { name: "Nyomtatás" }),
    ).toBeDisabled();
    expect(
      within(actions()).getByRole("button", { name: "PDF letöltése" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Szerkesztés folytatása" }),
    );
    expect(navigation.push).toHaveBeenCalledWith(
      "/penzugy/szamlazas/doc-1/szerkesztes",
    );
  });

  it("an issued document whose PDF is missing keeps the two buttons disabled, and cannot be sent", async () => {
    const issued = detail();
    api.detail.mockResolvedValue(
      detail({
        pdf: { available: false },
        delivery: { ...issued.delivery!, canResend: false },
      }),
    );
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    await screen.findByRole("heading", { level: 1, name: "AC-2026-001248" });
    expect(
      within(actions()).getByRole("button", { name: "PDF letöltése" }),
    ).toBeDisabled();
    // A SZERVER MONDJA MEG, hogy küldhető-e (`delivery.canResend`): a gomb
    // ezt követi, és kimondja, mi hiányzik.
    const resend = within(actions()).getByRole("button", {
      name: "E-mail újraküldése",
    });
    expect(resend).toBeDisabled();
    expect(resend).toHaveAttribute(
      "title",
      "A kiküldéshez a hivatalos PDF kell, és az még nincs meg.",
    );
  });

  it("a delivery note has no e-mail: no resend button, no sending card", async () => {
    api.detail.mockResolvedValue(
      detail({ documentType: "DELIVERY_NOTE", invoiceFormat: null }),
    );
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    await screen.findByRole("heading", { level: 1 });
    expect(
      within(actions()).queryByRole("button", { name: /E-mail|Kiküldés/ }),
    ).toBeNull();
    expect(screen.queryByText("Kiküldés")).toBeNull();
  });

  /*
    AZ ÚJRAKÜLDÉS SOHA NEM ÁLLÍT KI (brief 14. pont), és egy dupla kattintás egy
    kézbesítés. MI PIROSÍT: ha a hiba utáni újrapróbálás új azonosítóval menne
    (a szerver kétszer küldene), vagy ha a mód nem a "hiba utáni" lenne.
  */
  it("a failed e-mail: the warning, a retry with the same request id, and only the e-mail endpoint", async () => {
    api.detail.mockResolvedValue(
      detail({
        emailStatus: "FAILED",
        delivery: {
          status: "FAILED",
          lastAttempt: {
            recipients: { to: ["szamlazas@partner.hu"], cc: [], bcc: [] },
            outcome: "FAILED",
            at: "2026-09-30T12:32:00.000Z",
            error: "A címzett postafiókja megtelt.",
          },
          canResend: true,
        },
      }),
    );
    api.email
      .mockRejectedValueOnce(new Error("Átmeneti hiba"))
      .mockResolvedValueOnce(detail());
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    expect(
      await screen.findByText("A címzett postafiókja megtelt."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A levél újraküldése nem állít ki új számlát."),
    ).toBeInTheDocument();

    fireEvent.click(
      within(actions()).getByRole("button", { name: "Kiküldés újrapróbálása" }),
    );
    const drawer = await screen.findByRole("dialog");
    const submit = within(drawer).getByRole("button", {
      name: "Kiküldés újrapróbálása",
    });
    fireEvent.click(submit);
    expect(
      await within(drawer).findByText("Átmeneti hiba"),
    ).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => expect(api.email).toHaveBeenCalledTimes(2));

    const [first, second] = api.email.mock.calls.map((call) => call[2]);
    expect(first.mode).toBe("RETRY");
    expect(first.to).toEqual(["szamlazas@partner.hu"]);
    expect(second.requestId).toBe(first.requestId);
    // A FIÓK A LEVELEZÉS OLDAL SABLONJÁVAL NYÍLT (nautilus #1293)
    expect(api.emailDraft).toHaveBeenCalledWith("token-1", "doc-1");
    expect(first.subject).toBe("Acropora – {{document_number}}");
    expect(first.body).toBe("Kedves {{customer_name}}! {{document_number}}");
    // SZÖVEGES SABLONBÓL IS FORMÁZOTT LEVÉL MEGY (nautilus #1301): a változók
    // atomként, a szöveg mellé a HTML
    expect(first.bodyHtml).toContain(
      '<span data-variable="document_number">{{document_number}}</span>',
    );

    // A SIKER UTÁNI KÖVETKEZŐ KÜLDÉS ÚJ KÉRÉS: új azonosító, különben a szerver
    // a régi kézbesítést adná vissza, és nem küldene.
    api.email.mockResolvedValueOnce(detail());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      within(actions()).getByRole("button", { name: "E-mail újraküldése" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "E-mail újraküldése",
      }),
    );
    await waitFor(() => expect(api.email).toHaveBeenCalledTimes(3));
    expect(api.email.mock.calls[2]![2].requestId).not.toBe(first.requestId);
  });

  /*
    A {document_link} A SZÁMLÁZZ.HU VEVŐI FIÓKJA (nautilus #1288): az előnézet a
    részletek `szamlazz.documentUrl`-jével tölti. MI PIROSÍT: ha a változó
    jelölve maradna, holott a cím megvan.
  */
  it("the preview fills {document_link} from the document's Számlázz.hu link", async () => {
    const issued = detail();
    api.detail.mockResolvedValue({
      ...issued,
      szamlazz: {
        ...issued.szamlazz!,
        documentUrl: "https://www.szamlazz.hu/szamla/?page=vevoifiok&id=abc",
      },
    });
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    fireEvent.click(
      within(
        await screen.findByRole("group", { name: "Bizonylat műveletei" }),
      ).getByRole("button", {
        name: "E-mail újraküldése",
      }),
    );
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(
      within(drawer).getByRole("button", {
        name: "{{document_link}} beszúrása",
      }),
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Levél előnézete" }),
    );
    const srcdoc =
      within(drawer).getByTitle("Levél előnézete").getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain(
      "https://www.szamlazz.hu/szamla/?page=vevoifiok&amp;id=abc",
    );
    // a teljes {{…}} jelölő helyettesül, nem csak a belseje
    expect(srcdoc).not.toMatch(/\{https:/);
  });

  it("a formatted Levelezés template goes out as that HTML", async () => {
    api.emailDraft.mockResolvedValue({
      source: "stored",
      subject: "Acropora – {{document_number}}",
      body: "Kedves {{customer_name}}! Formázott levél.",
      bodyHtml:
        '<p>Kedves <span data-variable="customer_name">{{customer_name}}</span>! <strong>Formázott</strong> levél.</p>',
      variables: [],
    });
    api.email.mockResolvedValue(detail());
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    fireEvent.click(
      within(
        await screen.findByRole("group", { name: "Bizonylat műveletei" }),
      ).getByRole("button", { name: "E-mail újraküldése" }),
    );
    const drawer = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        within(drawer).getByLabelText("Levél tartalma").innerHTML,
      ).toContain("<strong>Formázott</strong>"),
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: "E-mail újraküldése" }),
    );
    await waitFor(() => expect(api.email).toHaveBeenCalledTimes(1));
    const [, , input] = api.email.mock.calls[0]!;
    expect(input.bodyHtml).toContain("<strong>Formázott</strong>");
    expect(input.body).toContain("Formázott levél.");
    expect(input.body).not.toContain("<strong>");
  });

  it("resend is not offered to a role without billing.resend", async () => {
    auth.role = "VIEWER";
    render(<BillingDocumentDetailPage documentId="doc-1" />);
    await screen.findByRole("heading", { level: 1 });
    const resend = within(actions()).getByRole("button", {
      name: "E-mail újraküldése",
    });
    expect(resend).toBeDisabled();
    expect(resend).toHaveAttribute(
      "title",
      "Nincs jogosultságod e-mailt küldeni.",
    );
  });
});
