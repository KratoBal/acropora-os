import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { BillingDocumentDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingDocumentEditor } from "./billing-document-editor";

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
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

const customers = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
vi.mock("@/lib/api/products", () => ({
  productApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));

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
  navigation.replace.mockReset();
  api.create
    .mockReset()
    .mockImplementation(async (_token, body) => detailFrom(body, body.id));
  api.update
    .mockReset()
    .mockImplementation(async (_token, id, body) => detailFrom(body, id));
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

  it("the e-mail drawer: variables go into the letter, the preview fills what is known, the send button waits", async () => {
    render(<BillingDocumentEditor />);
    await pickPartner();
    fireEvent.click(
      screen.getByRole("button", { name: "E-mail szerkesztése" }),
    );
    const drawer = await screen.findByRole("dialog");
    expect(
      within(drawer).getByRole("heading", { name: "E-számla kiküldése" }),
    ).toBeInTheDocument();
    expect(
      (within(drawer).getByLabelText("Címzett") as HTMLInputElement).value,
    ).toBe("szamlazas@partner.hu");

    fireEvent.change(within(drawer).getByLabelText("Levél tartalma"), {
      target: { value: "Szia " },
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "{customer_name} beszúrása" }),
    );
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Levél előnézete" }),
    );
    await act(async () => {});
    // A VÁLTOZÓ A LEVÉLBE KERÜL, nem a helyére: a korábbi szöveg előtte marad.
    expect(within(drawer).getByLabelText("Levél előnézete").textContent).toBe(
      "Szia Fővárosi Állat- és Növénykert",
    );
    expect(
      within(drawer).getByRole("button", {
        name: "E-számla kiállítása és elküldése",
      }),
    ).toBeDisabled();
  });
});
