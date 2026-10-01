import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  BillingDocumentListItem,
  BillingDocumentListResponse,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { BillingDocumentListPage } from "./billing-document-list-page";

/**
 * A SZÁMLÁZÁS LISTÁJA (Balázs briefje, 2026-09-30, 2-8., 24-25. és 31. pont).
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({ list: vi.fn() }));
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

function item(
  overrides: Partial<BillingDocumentListItem>,
): BillingDocumentListItem {
  return {
    id: "doc-1",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    documentNumber: "AC-2026-001248",
    customerName: "Fővárosi Állat- és Növénykert",
    issueDate: "2026-09-30",
    dueDate: "2026-10-08",
    grossAmount: "485140",
    currency: "HUF",
    status: "ISSUED",
    emailStatus: "SENT",
    opens: "DETAIL",
    origin: "OWN",
    externalKindLabel: null,
    paymentState: null,
    paidAmount: null,
    lastPaymentDate: null,
    paymentSource: null,
    ...overrides,
  };
}

function response(
  items: BillingDocumentListItem[],
  pagination: Partial<BillingDocumentListResponse["pagination"]> = {},
): BillingDocumentListResponse {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
      ...pagination,
    },
  };
}

const lastQuery = () =>
  Object.fromEntries(api.list.mock.calls.at(-1)![1] as URLSearchParams);

beforeEach(() => {
  auth.role = "OWNER";
  urlNavigation.reset("/penzugy/szamlazas");
  api.list.mockReset().mockResolvedValue(
    response(
      [
        item({}),
        item({
          id: "doc-2",
          documentType: "PROFORMA",
          invoiceFormat: null,
          documentNumber: "D-2026-00431",
          customerName: "Budapesti Állatkert Alapítvány",
          emailStatus: "FAILED",
        }),
        item({
          id: "draft-1",
          documentNumber: null,
          issueDate: null,
          status: "DRAFT",
          emailStatus: "PENDING",
          opens: "EDITOR",
          customerName: "Coral Lab Kft.",
        }),
      ],
      { totalItems: 86, totalPages: 4 },
    ),
  );
});

describe("BillingDocumentListPage", () => {
  it("shows the four types on one list: type, format, number, status and the e-mail status apart", async () => {
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(rows).toHaveLength(3);
    const [invoice, proforma, draft] = rows.map((row) => within(row));
    expect(invoice!.getByText("Számla")).toBeInTheDocument();
    expect(invoice!.getByText("E-számla")).toBeInTheDocument();
    expect(invoice!.getByText("Kiállítva")).toBeInTheDocument();
    expect(invoice!.getByText("Elküldve")).toBeInTheDocument();
    // a díjbekérőnek nincs formátuma, és a kiküldés hibája NEM a bizonylat állapota
    // két üres cella: a formátum és a kifizetés (a saját bizonylatnál nincs forrása)
    expect(proforma!.getAllByText("—")).toHaveLength(2);
    expect(proforma!.getByText("Kiállítva")).toBeInTheDocument();
    expect(proforma!.getByText("Sikertelen kiküldés")).toBeInTheDocument();
    // a vázlatnak nincs száma és kiállítási napja
    expect(draft!.getAllByText("Piszkozat")).toHaveLength(2);
    expect(screen.getByText("86 bizonylat")).toBeInTheDocument();
  });

  /*
    A SOR CÉLJA (brief 7. és 24. pont). MI PIROSÍT: ha a vázlat a részletekre
    nyílna, vagy ha csak a nyíl lenne kattintható, a sor nem.
  */
  it("a whole row opens: a draft into the editor, everything else into the details, by keyboard too", async () => {
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    fireEvent.click(
      within(rows[0]!).getByText("Fővárosi Állat- és Növénykert"),
    );
    expect(urlNavigation.push).toHaveBeenLastCalledWith(
      "/penzugy/szamlazas/doc-1",
    );
    fireEvent.keyDown(rows[2]!, { key: "Enter" });
    expect(urlNavigation.push).toHaveBeenLastCalledWith(
      "/penzugy/szamlazas/draft-1/szerkesztes",
    );
  });

  /**
   * A KÜLSŐ BIZONYLAT A LISTÁN (acrobot 25812): a mieink mellett, „Külső”
   * jelöléssel és a Számlázz.hu típus-feliratával, és a csak olvasható
   * adatlapjára nyílik. MI PIROSÍT: ha a jelölés hiányozna, vagy a sor a mieink
   * adatlapjára nyílna (ott 404 lenne); a KONTROLL: a saját sor nem jelölt.
   */
  it("an external row is marked, labelled with its Számlázz.hu kind, and opens its read-only page", async () => {
    api.list.mockResolvedValue(
      response([
        item({}),
        item({
          id: "ext-1",
          documentNumber: "ACRW-2026/00508",
          customerName: "Teszt Akvárium Bt.",
          emailStatus: null,
          opens: "EXTERNAL_DETAIL",
          origin: "EXTERNAL",
          externalKindLabel: "Sztornó számla",
        }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(within(rows[1]!).getByText("Külső")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Sztornó számla")).toBeInTheDocument();
    expect(within(rows[0]!).queryByText("Külső")).toBeNull();
    fireEvent.click(within(rows[1]!).getByText("Teszt Akvárium Bt."));
    expect(urlNavigation.push).toHaveBeenLastCalledWith(
      "/penzugy/szamlazas/kulso/ext-1",
    );
  });

  // MI PIROSÍT: ha a kifizetettség nem a válaszból jönne, vagy a három állapot
  // összemosódna; ha a saját bizonylat kitalált állapotot mutatna.
  it("shows whether an external invoice is paid, with the incoming list's labels (Balázs, GLS)", async () => {
    const ext = (
      id: string,
      paymentState: BillingDocumentListItem["paymentState"],
      paidAmount: string,
      lastPaymentDate: string | null,
    ) =>
      item({
        id,
        documentNumber: id,
        emailStatus: null,
        opens: "EXTERNAL_DETAIL",
        origin: "EXTERNAL",
        externalKindLabel: "Számla",
        paymentState,
        paidAmount,
        lastPaymentDate,
      });
    api.list.mockResolvedValue(
      response([
        ext("ACRW-2026/00479", "PAID", "27450", "2026-09-17"),
        ext("ACRW-2026/00481", "PARTIAL", "50000", "2026-09-17"),
        ext("ACRW-2026/00485", "UNPAID", "0", null),
        ext("ACRW-2026/00486", "UNKNOWN", "0", null),
        // kártyával fizetve a rendeléskor, a Számlázz.hu-ban nincs rögzítve (acrobot 25938)
        {
          ...ext("ACRW-2026/00490", "PAID", "15450", "2026-09-14"),
          paymentSource: "CARD_AT_ORDER",
        },
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(rows[0]).toHaveTextContent("Fizetve2026. 09. 17.");
    expect(rows[1]).toHaveTextContent(/Részben fizetve50\s000\sFt/);
    expect(within(rows[2]!).getByText("Nincs fizetve")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Nincs adat")).toBeInTheDocument();
    // a forrás látszik: a Számlázz.hu rögzítette, vagy a rendeléskor kártyával
    expect(within(rows[0]!).getByText("Fizetve")).toBeInTheDocument();
    expect(
      within(rows[4]!).getByText("Fizetve (kártya, a rendeléskor)"),
    ).toBeInTheDocument();
  });

  it("the source filter goes to the request, and back from the URL", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "origin=EXTERNAL");
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toEqual({
      page: "1",
      pageSize: "25",
      origin: "EXTERNAL",
    });
    fireEvent.change(screen.getByLabelText("Forrás"), {
      target: { value: "OWN" },
    });
    await waitFor(() =>
      expect(new URLSearchParams(urlNavigation.search).get("origin")).toBe(
        "OWN",
      ),
    );
  });

  it("asks with the URL's filters and page, and a filter change goes to the URL and back to page one", async () => {
    urlNavigation.reset(
      "/penzugy/szamlazas",
      "documentType=PROFORMA&status=ISSUED&invoiceFormat=PAPER&q=allat&page=3",
    );
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toEqual({
      page: "3",
      pageSize: "25",
      q: "allat",
      documentType: "PROFORMA",
      status: "ISSUED",
      invoiceFormat: "PAPER",
    });

    fireEvent.change(screen.getByLabelText("Dokumentumtípus"), {
      target: { value: "DELIVERY_NOTE" },
    });
    await waitFor(() =>
      expect(
        new URLSearchParams(urlNavigation.search).get("documentType"),
      ).toBe("DELIVERY_NOTE"),
    );
    expect(new URLSearchParams(urlNavigation.search).get("page")).toBeNull();
  });

  it("clears every filter at once", async () => {
    urlNavigation.reset(
      "/penzugy/szamlazas",
      "documentType=PROFORMA&status=ISSUED&q=allat",
    );
    render(<BillingDocumentListPage />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Szűrők törlése" }))[0]!,
    );
    await waitFor(() => expect(urlNavigation.search).toBe(""));
  });

  it("pages through the common pagination", async () => {
    render(<BillingDocumentListPage />);
    await screen.findAllByRole("row", { name: /megnyitása$/ });
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: /Következő/ }),
    );
    await waitFor(() => expect(urlNavigation.search).toBe("page=2"));
  });

  it("empty: says there is nothing yet, or nothing for these filters", async () => {
    api.list.mockResolvedValue(response([]));
    const { unmount } = render(<BillingDocumentListPage />);
    expect(await screen.findByText("Még nincs bizonylat")).toBeInTheDocument();
    unmount();

    urlNavigation.reset("/penzugy/szamlazas", "q=nincsilyen");
    render(<BillingDocumentListPage />);
    expect(await screen.findByText("Nincs találat")).toBeInTheDocument();
  });

  it("an error is shown with a retry, not as an empty list", async () => {
    api.list.mockRejectedValueOnce(new Error("Hálózati hiba"));
    render(<BillingDocumentListPage />);
    expect(await screen.findByText("Hálózati hiba")).toBeInTheDocument();
    expect(screen.queryByText("Még nincs bizonylat")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    await screen.findAllByRole("row", { name: /megnyitása$/ });
  });

  it("Új számla opens the editor, and only for who may create", async () => {
    render(<BillingDocumentListPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Új számla" }));
    expect(urlNavigation.push).toHaveBeenLastCalledWith(
      "/penzugy/szamlazas/uj",
    );
  });

  it("a viewer sees the list without the Új számla button", async () => {
    auth.role = "VIEWER";
    render(<BillingDocumentListPage />);
    await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(screen.queryByRole("button", { name: "Új számla" })).toBeNull();
  });
});
