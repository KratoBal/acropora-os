import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  BillingExternalDocumentDetail,
  Session,
  UserRole,
} from "@acropora/types";
import { describe, expect, it, vi } from "vitest";

import { BillingExternalDocumentPage } from "./billing-external-document-page";

/**
 * A SZÁMLÁZZ.HU-BÓL KAPOTT KÜLSŐ BIZONYLAT ADATLAPJA (acrobot 25812): ugyanaz a
 * kinézet, csak olvasásra; a PDF akkor nyitható, ha a letöltés eltárolta.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/penzugy/szamlazas/kulso/ext-1",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  externalDetail: vi.fn(),
  externalPdf: vi.fn(),
  setExternalPaperOriginal: vi.fn(),
  recordOutgoingPayment: vi.fn(),
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

const detail = (
  overrides: Partial<BillingExternalDocumentDetail> = {},
): BillingExternalDocumentDetail => ({
  id: "ext-1",
  source: "SZAMLAZZ",
  pdfAvailable: false,
  pdfMissingReason: null,
  paperOriginal: false,
  kindCode: "SZ",
  kindLabel: "Számla",
  documentNumber: "ACRW-2026/00508",
  invoiceFormat: "ELECTRONIC",
  issueDate: "2026-09-30",
  fulfillmentDate: "2026-09-29",
  dueDate: "2026-10-08",
  paymentMethod: "Átutalás",
  currency: "HUF",
  customer: {
    name: "Teszt Akvárium Bt.",
    taxNumber: "12345678-2-41",
    address: "1031 Budapest Minta utca 1.",
  },
  lines: [
    {
      name: "Akvárium szerviz",
      quantity: "2.0",
      unit: "óra",
      unitNet: "10000.0",
      vatRate: "27",
      netAmount: "20000",
      vatAmount: "5400",
      grossAmount: "25400",
    },
  ],
  totals: { netAmount: "20000", vatAmount: "5400", grossAmount: "25400" },
  cancelled: false,
  paymentState: "UNKNOWN",
  paidAmount: "0",
  lastPaymentDate: null,
  paymentSource: null,
  paymentsKnown: false,
  payments: [],
  ownPaymentMarks: [],
  orderNumber: "47679-665706",
  paymentMethodUnified: "átutalás",
  versionCount: 2,
  receivedAt: "2026-10-01T15:00:00.000Z",
  ...overrides,
});

describe("BillingExternalDocumentPage", () => {
  /**
   * MI PIROSÍT: ha egy mező (szám, vevő, tétel, végösszeg) nem a válaszból
   * jönne; ha bármilyen művelet (szerkesztés, sztornó, újraküldés, PDF)
   * megjelenne egy csak olvasható bizonylaton.
   */
  it("shows the invoice read-only: its fields, its lines and totals, and no action at all", async () => {
    api.externalDetail.mockResolvedValue(detail());
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByRole("heading", { name: "ACRW-2026/00508" }),
    ).toBeInTheDocument();
    expect(api.externalDetail).toHaveBeenCalledWith(
      "token-1",
      "ext-1",
      expect.anything(),
    );
    expect(screen.getAllByText("Teszt Akvárium Bt.").length).toBeGreaterThan(0);
    expect(screen.getByText("Akvárium szerviz")).toBeInTheDocument();
    expect(screen.getByText("Külső")).toBeInTheDocument();
    expect(
      screen.getByText("Külső bizonylat, csak olvasásra"),
    ).toBeInTheDocument();
    expect(screen.getByText("a legutóbbi a 2 közül")).toBeInTheDocument();
    // a webshop rendelésszáma (`alap.rendelesszam`, acrobot 25964)
    expect(screen.getByText("47679-665706")).toBeInTheDocument();
    // a PDF a #1658 óta letölthető: a lap nem mondja, hogy „a Számlázz.hu nem adja”, hanem hogy ezen a
    // soron még nem futott a letöltés (ugyanaz a szöveg, mint a listán; Balázs, 2026-10-21)
    expect(
      screen.getByText(
        "Még nincs letöltve: a Számlázz.hu-s letöltés ezen a soron még nem futott.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nem adja/)).toBeNull();
    // a KONTROLL a gombokra: a „Vissza a listához” link mellett egyetlen gomb, a „Papíron megvan”
    // (Balázs, 2026-11-03); szerkesztés, sztornó, újraküldés nincs
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Papíron megvan"]);
    expect(
      screen.queryByText(/Szerkesztés|Sztornó|Újraküldés|Nyomtatás|Letöltés/),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /Vissza a listához/ }),
    ).toHaveAttribute("href", "/penzugy/szamlazas");
  });

  it("shows the payments Számlázz.hu recorded, its own bank pairing too", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        paymentState: "PAID",
        paidAmount: "25400",
        lastPaymentDate: "2026-09-28",
        paymentSource: "SZAMLAZZ",
        paymentsKnown: true,
        payments: [
          {
            date: "2026-09-28",
            title: "átutalás",
            amount: "25400",
            note: "Automatikus banki tranzakció párosítás",
          },
        ],
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(await screen.findByText("Fizetve")).toBeInTheDocument();
    expect(
      screen.getByText("Automatikus banki tranzakció párosítás"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2026\. 09\. 28\. · átutalás/)).toBeInTheDocument();
  });

  /*
    A SAJÁT, BEÍRT JELÖLÉS (acrobot 26027). MI PIROSÍT: ha a jelölésből számolt
    „Fizetve” nem mondaná a forrását; ha a jelölés sora nem látszana az adatlapon.
  */
  it("shows our own written mark: the source on the state, and the mark's line", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        paymentState: "PAID",
        paidAmount: "29210",
        lastPaymentDate: "2026-09-17",
        paymentSource: "MARK_GLS_COD",
        paymentsKnown: false,
        ownPaymentMarks: [
          { source: "GLS_COD", date: "2026-09-17", amount: "29210" },
        ],
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText("Fizetve (GLS utánvét)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Általunk beírva a Számlázz.hu-ba"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2026\. 09\. 17\. · GLS utánvét/),
    ).toBeInTheDocument();
  });

  // MI PIROSÍT: ha a rendelésből jött név nem lenne megjelölve (acrobot 26096)
  it("says when the buyer's name came from the webshop order", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        customer: {
          name: "Kiss Anna",
          taxNumber: null,
          address: null,
          nameFromOrder: true,
        },
      }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText(
        "A név a webshop-rendelésből; a számlán a NAV elrejti.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * MI PIROSÍT: ha a tájékoztató sáv a tárolt PDF-től függetlenül azt írná, hogy
   * „PDF sincs hozzá” (ACRW-2026/00547: a havi kimenő csomagban benne volt), vagy
   * ha a PDF-es soron nem lehetne megnyitni a fájlt.
   */
  it("does not deny a stored PDF, and opens it", async () => {
    api.externalDetail.mockResolvedValue(detail({ pdfAvailable: true }));
    api.externalPdf.mockResolvedValue(new Blob(["%PDF-"]));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText(
        "Ez a számla egy másik számlázóban készült, a Számlázz.hu továbbította. Itt nem szerkeszthető, nem sztornózható és nem küldhető újra.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PDF sincs/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "PDF megnyitása" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("blob:pdf", "_blank"),
    );
    expect(api.externalPdf).toHaveBeenCalledWith("token-1", "ext-1");
    open.mockRestore();
  });

  it("keeps saying there is no PDF when none is stored", async () => {
    api.externalDetail.mockResolvedValue(detail({ pdfAvailable: false }));
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(
      await screen.findByText(
        "Ez a számla egy másik számlázóban készült, a Számlázz.hu továbbította. Itt nem szerkeszthető, nem sztornózható és nem küldhető újra, és PDF sincs hozzá.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PDF megnyitása" })).toBeNull();
  });

  /**
   * „PAPÍRON MEGVAN” (Balázs, 2026-11-03). MI PIROSÍT: a gomb nem a külső számla végpontját hívja; a
   * válasz után a lap nem mutatja a jelölést; a visszavonás nem hamisat küld; a `finance.manage` nélküli
   * szerep is lát gombot; a jelölt számlán a pirula csak a gombbal együtt látszik.
   */
  it("marks it as kept on paper, and takes the mark back", async () => {
    api.externalDetail.mockResolvedValue(detail());
    api.setExternalPaperOriginal.mockResolvedValueOnce(
      detail({ paperOriginal: true }),
    );
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Papíron megvan" }),
    );
    expect(await screen.findByTestId("paper-original-pill")).toHaveTextContent(
      "Papíron megvan",
    );
    expect(api.setExternalPaperOriginal).toHaveBeenCalledWith(
      "token-1",
      "ext-1",
      true,
    );
    api.setExternalPaperOriginal.mockResolvedValueOnce(detail());
    fireEvent.click(screen.getByRole("button", { name: "Mégsem papíron" }));
    await waitFor(() =>
      expect(screen.queryByTestId("paper-original-pill")).toBeNull(),
    );
    expect(api.setExternalPaperOriginal).toHaveBeenLastCalledWith(
      "token-1",
      "ext-1",
      false,
    );
  });

  it("without finance.manage: no button, but a marked invoice still says so", async () => {
    auth.role = "VIEWER";
    try {
      api.externalDetail.mockResolvedValue(detail({ paperOriginal: true }));
      render(<BillingExternalDocumentPage documentId="ext-1" />);
      expect(
        await screen.findByTestId("paper-original-pill"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /papíron/i })).toBeNull();
    } finally {
      auth.role = "OWNER";
    }
  });

  /*
    KÉZI KIFIZETÉS (kártya 2026/00083-86; Balázs, 2026-11-04 16:40 UTC). MI PIROSÍT: ha a
    gomb nem jelenik meg egy nyitott számlán; ha nem a nyitott összeget kínálja; ha a kérés
    nem a számla számát és egy kérés-azonosítót viszi; ha a visszavonás korlátja nem áll a
    gomb mellett; ha kifizetett számlán vagy a kiállítás joga nélkül is megjelenik.
  */
  it("an open invoice takes a manual payment, up to its open amount, with the undo limit beside it", async () => {
    api.externalDetail.mockReset().mockResolvedValue(
      detail({
        paymentState: "PARTIAL",
        paidAmount: "10000",
        paymentsKnown: true,
      }),
    );
    api.recordOutgoingPayment.mockResolvedValue({
      state: "WRITTEN",
      outstanding: 0,
      message: "A kifizetés a Számlázz.hu-ban rögzítve.",
    });
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Kifizetés rögzítése" }),
    );
    expect(screen.getByLabelText("Összeg")).toHaveValue("15400");
    expect(
      screen.getByText(/a Számlázz.hu felületén lehet törölni, innen nem/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Rögzítés a Számlázz.hu-ban" }),
    );
    await waitFor(() => expect(api.recordOutgoingPayment).toHaveBeenCalled());
    const [token, body] = api.recordOutgoingPayment.mock.calls[0]!;
    expect(token).toBe("token-1");
    expect(body).toMatchObject({
      invoiceNumber: "ACRW-2026/00508",
      amount: "15400",
    });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByText("A kifizetés a Számlázz.hu-ban rögzítve."),
    ).toBeInTheDocument();
    // the page reloads, so the new state shows
    await waitFor(() => expect(api.externalDetail).toHaveBeenCalledTimes(2));
  });

  it("no manual payment on a paid invoice, or without the issuing permission", async () => {
    api.externalDetail.mockResolvedValue(
      detail({
        paymentState: "PAID",
        paidAmount: "25400",
        paymentsKnown: true,
      }),
    );
    const { unmount } = render(
      <BillingExternalDocumentPage documentId="ext-1" />,
    );
    expect(
      await screen.findByRole("heading", { name: "ACRW-2026/00508" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Kifizetés rögzítése" }),
    ).toBeNull();
    unmount();
    auth.role = "VIEWER";
    try {
      api.externalDetail.mockResolvedValue(
        detail({ paymentState: "UNPAID", paymentsKnown: true }),
      );
      render(<BillingExternalDocumentPage documentId="ext-1" />);
      expect(
        await screen.findByRole("heading", { name: "ACRW-2026/00508" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Kifizetés rögzítése" }),
      ).toBeNull();
    } finally {
      auth.role = "OWNER";
    }
  });

  it("says when Számlázz.hu marks it cancelled", async () => {
    api.externalDetail.mockResolvedValue(detail({ cancelled: true }));
    render(<BillingExternalDocumentPage documentId="ext-1" />);
    expect(await screen.findByText("Sztornózott")).toBeInTheDocument();
  });
});
