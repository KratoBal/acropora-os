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
    netAmount: "382000",
    vatAmount: "103140",
    paymentMethod: "Átutalás",
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
    pdf: { available: true, missingReason: null },
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
    facets: { paymentMethods: ["Átutalás", "Bankkártya", "Készpénz"] },
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
    // a díjbekérőnek nincs formátuma (nincs "E-számla" és nincs üres jel helyette), és a kiküldés hibája NEM a bizonylat állapota
    // egy üres cella marad: a kifizetés (a saját bizonylatnál nincs forrása)
    expect(proforma!.getAllByText("—")).toHaveLength(1);
    expect(proforma!.getByText("Kiállítva")).toBeInTheDocument();
    expect(proforma!.getByText("Sikertelen kiküldés")).toBeInTheDocument();
    // a vázlatnak nincs száma: a szám helyén halvány "nincs még szám" áll, az állapotot az Állapot oszlop mondja ki (egyszer)
    expect(draft!.getByText("nincs még szám")).toBeInTheDocument();
    expect(draft!.getAllByText("Piszkozat")).toHaveLength(1);
    expect(invoice!.queryByText("nincs még szám")).toBeNull();
    expect(screen.getByText("86 bizonylat")).toBeInTheDocument();
  });

  /*
    A SOR CÉLJA (brief 7. és 24. pont). MI PIROSÍT: ha a vázlat a részletekre
    nyílna, vagy ha csak a nyíl lenne kattintható, a sor nem.
  */
  /* A kimenő lista rendezése (Balázs kérése, kártya 2f6369a4): a két forrás közös, számszerű oszlopai, az URL-ben, szerveroldalon. */
  it("a rendezés az URL-ből a kérésbe megy, és a Kiállítás fejlécre kattintva asc, desc, alap körbe jár, oldalnullázással", async () => {
    urlNavigation.reset(
      "/penzugy/szamlazas",
      "oldal=3&sort=grossAmount&direction=desc",
    );
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({
      sort: "grossAmount",
      direction: "desc",
    });
    expect(
      await screen.findByRole("columnheader", { name: /Összeg/ }),
    ).toHaveAttribute("aria-sort", "descending");

    // egy másik oszlop (Kiállítás) növekvőben indul, és az oldal az elsőre áll
    fireEvent.click(
      within(
        await screen.findByRole("columnheader", { name: /Kiállítás/ }),
      ).getByRole("button"),
    );
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        sort: "issueDate",
        direction: "asc",
      }),
    );
    expect(lastQuery().page).toBe("1");

    // a Kiállítás második kattintása csökkenő, a harmadik az alap (a kulcsok törlődnek)
    fireEvent.click(
      within(
        await screen.findByRole("columnheader", { name: /Kiállítás/ }),
      ).getByRole("button"),
    );
    await waitFor(() => expect(lastQuery().direction).toBe("desc"));
    fireEvent.click(
      within(
        await screen.findByRole("columnheader", { name: /Kiállítás/ }),
      ).getByRole("button"),
    );
    await waitFor(() => expect(lastQuery()).not.toHaveProperty("sort"));
    expect(lastQuery()).not.toHaveProperty("direction");
  });

  it("csak a három közös, szám- vagy nap-értékű oszlop rendezhető: a vevő, a bizonylatszám és a fizetés nem", async () => {
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    for (const name of [/Kiállítás/, /Határidő/, /Összeg/])
      expect(
        within(await screen.findByRole("columnheader", { name })).getAllByRole(
          "button",
        ),
      ).toHaveLength(1);
    for (const name of [/Bizonylat/, /Vevő/, /Fizetés/])
      expect(
        within(await screen.findByRole("columnheader", { name })).queryByRole(
          "button",
        ),
      ).toBeNull();
    // a Dokumentum és a Deviza oszlop megszűnt (Picasso 3.12): a típus a szám alatt áll, a pénznem az összeg mellett
    expect(
      screen.queryByRole("columnheader", { name: /Dokumentum/ }),
    ).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Deviza/ })).toBeNull();
  });

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

  // A SZTORNÓZOTT SAJÁT SZÁMLA (számlázási brief, 1. pont). MI PIROSÍT: ha a
  // `cancelled` sor nincs jelölve, vagy a jel a nem sztornózott sorra is kerül.
  it("a stornoed own invoice is marked on the list, the others are not", async () => {
    api.list.mockResolvedValue(
      response([
        item({}),
        item({
          id: "doc-2",
          documentNumber: "AC-2026-001249",
          cancelled: true,
        }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(within(rows[1]!).getByText("Sztornózott")).toBeInTheDocument();
    expect(rows[1]).toHaveAccessibleName(
      expect.stringContaining("AC-2026-001249 (sztornózott)"),
    );
    expect(within(rows[0]!).queryByText("Sztornózott")).toBeNull();
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

  // MI PIROSÍT: ha a PDF-állapot nem a válaszból jönne; ha a hiányzó PDF oka elveszne vagy a
  // Számlázz.hu-s soron automatikus letöltést ígérne (az kézzel indul); ha egy vázlat PDF-et várna.
  it("shows whether the PDF is there, and why not when it is missing (Balázs, 2026-10-21)", async () => {
    const ext = (
      id: string,
      pdf: BillingDocumentListItem["pdf"],
      externalSource: "SZAMLAZZ" | "EBIZ" = "SZAMLAZZ",
    ) =>
      item({
        id,
        documentNumber: id,
        opens: "EXTERNAL_DETAIL",
        origin: "EXTERNAL",
        externalKindLabel: "Számla",
        externalSource,
        pdf,
      });
    api.list.mockResolvedValue(
      response([
        item({}),
        item({
          id: "own-2",
          documentNumber: "AC-2026-001250",
          pdf: { available: false, missingReason: "OWN_PDF_NOT_STORED" },
        }),
        item({
          id: "draft",
          documentNumber: null,
          status: "DRAFT",
          opens: "EDITOR",
          pdf: null,
        }),
        ext("ACRW-2026/00601", { available: false, missingReason: null }),
        ext("ACRW-2026/00602", {
          available: false,
          missingReason: "SZAMLAZZ_PDF_REJECTED_7",
        }),
        ext("E-77", { available: false, missingReason: null }, "EBIZ"),
        ext("ACRW-2026/00603", {
          available: false,
          missingReason: "SZAMLAZZ_PDF_HTTP_503",
        }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(within(rows[0]!).getByText("Megvan")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(
      "NincsA kiállításkor nem tárolódott PDF.",
    );
    expect(within(rows[2]!).queryByText("Megvan")).toBeNull();
    expect(within(rows[2]!).queryByText("Nincs")).toBeNull();
    expect(rows[3]).toHaveTextContent(
      "Még nincs letöltve: a Számlázz.hu-s letöltés ezen a soron még nem futott.",
    );
    expect(rows[4]).toHaveTextContent(
      "A Számlázz.hu ezt a számlaszámot nem ismeri.",
    );
    expect(rows[5]).toHaveTextContent(
      "Még nincs letöltve; a következő eBIZ-szinkron megpróbálja.",
    );
    expect(rows[6]).toHaveTextContent("A Számlázz.hu nem adta ki (HTTP 503).");
  });

  // „Papíron megvan” (Balázs, 2026-11-03). MI PIROSÍT: a jelölt sor a PDF állapotát mutatja (a csomag a
  // jelölést nézi, nem a fájlt); a jelölés a fájl nélküli soron elveszik; a jelöletlen sor jelölést mutat.
  it("a row kept on paper says so in the PDF column, with or without a stored file", async () => {
    api.list.mockResolvedValue(
      response([
        item({
          id: "p1",
          documentNumber: "AC-2026-001251",
          paperOriginal: true,
        }),
        item({
          id: "p2",
          documentNumber: "ACRW-2026/00604",
          opens: "EXTERNAL_DETAIL",
          origin: "EXTERNAL",
          externalKindLabel: "Számla",
          externalSource: "SZAMLAZZ",
          pdf: { available: false, missingReason: null },
          paperOriginal: true,
        }),
        item({ id: "p3", documentNumber: "AC-2026-001252" }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(
      within(rows[0]!).getByTestId("paper-original-badge"),
    ).toHaveTextContent("Papíron megvan");
    expect(within(rows[0]!).queryByText("Megvan")).toBeNull();
    expect(
      within(rows[1]!).getByTestId("paper-original-badge"),
    ).toBeInTheDocument();
    expect(within(rows[1]!).queryByText("Nincs")).toBeNull();
    expect(within(rows[2]!).queryByTestId("paper-original-badge")).toBeNull();
    expect(within(rows[2]!).getByText("Megvan")).toBeInTheDocument();
  });

  /*
    A NETTÓ, AZ ÁFA ÉS A BRUTTÓ EGYÜTT, A BEJÖVŐ LISTA FORMÁJÁBAN (Luca, 2026-11-04; kártya 6110d89b). MI PIROSÍT: ha a
    három összeg nem a bejövő lista sorrendjében és formázásával áll; ha egy nem számolható (vázlat) összeg 0-nak
    látszik a „—” helyett; ha a fizetési mód nem a kifizetés jelzése fölött áll.
  */
  it("shows the gross in one line with the currency, the net and the VAT in the tooltip, and the payment method above the payment mark", async () => {
    api.list.mockResolvedValue(
      response([
        item({ paymentMethod: "Bankkártya" }),
        item({
          id: "draft-2",
          documentNumber: null,
          issueDate: null,
          status: "DRAFT",
          opens: "EDITOR",
          netAmount: null,
          vatAmount: null,
          paymentMethod: null,
          grossAmount: "0",
        }),
        item({
          id: "eur-1",
          currency: "EUR",
          netAmount: "100",
          vatAmount: "0",
          grossAmount: "100",
        }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    // az összeg EGY sor: a bruttó a pénznem-jellel; a nettó és az ÁFA a megjegyzésben (title) és a felolvasónak áll
    const shown = (row: HTMLElement, title: RegExp) => {
      const cell = within(row).getByTitle(title);
      return Array.from(cell.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .replace(/\s/g, " ");
    };
    expect(
      shown(rows[0]!, /Nettó 382 000, ÁFA 103 140, bruttó 485 140 Ft/),
    ).toBe("485 140 Ft");
    expect(within(rows[0]!).getByText("Bankkártya")).toBeInTheDocument();
    // a nem számolható nettó és ÁFA „—”, nem 0; a bruttó marad
    expect(shown(rows[1]!, /Nettó —, ÁFA —, bruttó 0 Ft/)).toBe("0 Ft");
    // a nem forint két tizedessel, a pénznem neve az összeg mellett
    expect(shown(rows[2]!, /Nettó 100,00, ÁFA 0,00, bruttó 100,00 EUR/)).toBe(
      "100,00 EUR",
    );
  });

  it("sends the period (the month's first and last day) and the payment method, with the choices from the answer", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const [year, index] = month.split("-").map(Number) as [number, number];
    const last = String(new Date(Date.UTC(year, index, 0)).getUTCDate());
    urlNavigation.reset(
      "/penzugy/szamlazas",
      `idoszak=${month}&fizmod=${encodeURIComponent("Bankkártya")}`,
    );
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toEqual({
      page: "1",
      pageSize: "25",
      from: `${month}-01`,
      to: `${month}-${last}`,
      paymentMethod: "Bankkártya",
    });
    const select = (await screen.findByLabelText(
      "Fizetési mód",
    )) as HTMLSelectElement;
    // the choices come with the list's answer, after the field
    await waitFor(() =>
      expect([...select.options].map((option) => option.value)).toEqual([
        "",
        "Átutalás",
        "Bankkártya",
        "Készpénz",
      ]),
    );
    fireEvent.change(select, { target: { value: "Készpénz" } });
    await waitFor(() =>
      expect(new URLSearchParams(urlNavigation.search).get("fizmod")).toBe(
        "Készpénz",
      ),
    );
    expect(new URLSearchParams(urlNavigation.search).get("page")).toBeNull();
  });

  it("a filter change on the period or the payment method goes back to page one, and 'Szűrők törlése' clears both", async () => {
    urlNavigation.reset(
      "/penzugy/szamlazas",
      "fizmod=K%C3%A9szp%C3%A9nz&page=3",
    );
    render(<BillingDocumentListPage />);
    fireEvent.change(await screen.findByLabelText("Időszak"), {
      target: { value: new Date().toISOString().slice(0, 7) },
    });
    await waitFor(() =>
      expect(
        new URLSearchParams(urlNavigation.search).get("idoszak"),
      ).not.toBeNull(),
    );
    expect(new URLSearchParams(urlNavigation.search).get("page")).toBeNull();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Szűrők törlése" }))[0]!,
    );
    await waitFor(() => expect(urlNavigation.search).toBe(""));
  });

  /*
    FIZETVE / NINCS FIZETVE (Balázs, 2026-11-04). MI PIROSÍT: ha a három állás nem a kérésbe és az URL-be megy; ha a
    szűrő nem nullázza a lapot; ha a „Szűrők törlése” nem viszi vissza.
  */
  it("the payment filter goes to the request and the URL, resets the page, and the clear button takes it away", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "fizetes=UNPAID&page=3");
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toEqual({
      page: "3",
      pageSize: "25",
      paymentState: "UNPAID",
    });
    const select = (await screen.findByLabelText(
      "Fizetés",
    )) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Fizetés: mind",
      "Fizetve",
      "Nincs fizetve",
    ]);
    fireEvent.change(select, { target: { value: "PAID" } });
    await waitFor(() =>
      expect(new URLSearchParams(urlNavigation.search).get("fizetes")).toBe(
        "PAID",
      ),
    );
    expect(new URLSearchParams(urlNavigation.search).get("page")).toBeNull();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Szűrők törlése" }))[0]!,
    );
    await waitFor(() => expect(urlNavigation.search).toBe(""));
  });

  it("ignores a payment value it does not know", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "fizetes=PARTIAL");
    render(<BillingDocumentListPage />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(lastQuery()).toEqual({ page: "1", pageSize: "25" });
  });

  /*
    A SZŰRŐSOR RÁCSA (Balázs, 2026-11-04, széles monitor: a hetedik szűrő egyedül maradt a második sorban, és az egész
    szélességre nyúlt). MI PIROSÍT: ha a szűrősor ismét nyújtó (flex-grow) alakú; ha egy szűrő saját nyújtó méretet kap;
    ha a rács nem kitöltő oszlopokból áll (az `auto-fit` az üres sávokat összeomlasztja, és a magában maradt elem kitölti a
    sort); ha nincs alap sávja telefonon. A böngészőben látott szélességeket a stage-képek mutatják.
  */
  it("the filter bar: the search and three frequent filters in one row, the rare ones behind További szűrők, no stretching", async () => {
    render(<BillingDocumentListPage />);
    const search = await screen.findByLabelText("Bizonylat keresése");
    const bar = search.closest("section[aria-label='Szűrők']") as HTMLElement;
    expect(bar).not.toBeNull();
    // a gyakori szűrők a sorban: típus, állapot, fizetés
    for (const name of ["Dokumentumtípus", "Állapot", "Fizetés"])
      expect(within(bar).getByRole("combobox", { name })).toBeInTheDocument();
    // the first option must fit the 180 px select (the stage image cut "Minden dokumentumtípus" to "Minden dokumentur")
    const typeSelect = within(bar).getByRole("combobox", {
      name: "Dokumentumtípus",
    }) as HTMLSelectElement;
    expect(typeSelect.options[0]!.textContent).toBe("Minden típus");
    // a ritkák a gomb mögött: zárt panelnél nincsenek a DOM-ban
    for (const name of ["Időszak", "Formátum", "Forrás", "Fizetési mód"])
      expect(within(bar).queryByRole("combobox", { name })).toBeNull();
    const more = within(bar).getByRole("button", { name: /További szűrők/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Időszak", "Formátum", "Forrás", "Fizetési mód"])
      expect(within(bar).getByRole("combobox", { name })).toBeInTheDocument();
    // a választók fix szélességűek és nem nyúlnak (Balázs, 2026-11-04: egy magára maradt szűrő ne töltse ki a sort)
    for (const select of bar.querySelectorAll("select")) {
      const cls = (select.parentElement as HTMLElement).className;
      expect(cls).toContain("sm:w-[180px]");
      expect(cls).toContain("shrink-0");
      expect(cls).not.toMatch(/flex-\[|flex-grow|\bgrow\b|flex-1/);
    }
    expect(search.closest("div[class*='sm:max-w']")).not.toBeNull();
    // nyolc vezérlő van összesen: négy ritka és három gyakori szűrő, a kereső
    expect(bar.querySelectorAll("select")).toHaveLength(7);
  });

  it("an active rare filter is counted on the button and opens the panel from the start (the filtered list must not look unfiltered)", async () => {
    urlNavigation.reset("/penzugy/szamlazas", "formatum=x&origin=EXTERNAL");
    render(<BillingDocumentListPage />);
    const more = await screen.findByRole("button", {
      name: /További szűrők · 1/,
    });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("combobox", { name: "Forrás" }),
    ).toBeInTheDocument();
  });

  it("on a phone only the search and the button stay in the row: the frequent filters move into the panel and count on the button", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      urlNavigation.reset("/penzugy/szamlazas", "status=DRAFT");
      render(<BillingDocumentListPage />);
      const more = await screen.findByRole("button", {
        name: /További szűrők · 1/,
      });
      // an active frequent filter opens the panel from the start on a phone, and the filter sits INSIDE it
      expect(more.getAttribute("aria-expanded")).toBe("true");
      const panel = document.getElementById(
        more.getAttribute("aria-controls") ?? "",
      )!;
      expect(
        within(panel).getByRole("combobox", { name: "Állapot" }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole("combobox", { name: "Dokumentumtípus" }),
      ).toBeInTheDocument();
      // ... and ONLY there: the row itself holds nothing but the search and the button
      expect(screen.getAllByRole("combobox", { name: "Állapot" })).toHaveLength(
        1,
      );
      expect(screen.getAllByRole("combobox")).toHaveLength(
        panel.querySelectorAll("select").length,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the three views are tabs, not big cards: one line each, the page text names the view", async () => {
    render(<BillingDocumentListPage />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Kimenő számlák",
      "Bejövő számlák",
      "Nyugták",
    ]);
    expect(screen.queryByText(/Saját és külső rendszerben/)).toBeNull();
    for (const tab of tabs) expect(tab.className).toContain("border-b-2");
  });

  it("one pager, at the bottom: the top only carries the count", async () => {
    api.list.mockResolvedValue(
      response([item({})], { totalPages: 3, totalItems: 60 }),
    );
    render(<BillingDocumentListPage />);
    await screen.findByText("60 bizonylat");
    expect(
      screen.queryByRole("navigation", { name: "Lapozás, felül" }),
    ).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Lapozás, alul" }),
    ).toBeInTheDocument();
  });

  it("each row says where it leads: Szerkesztő for a draft, Adatlap for the rest", async () => {
    api.list.mockResolvedValue(
      response([
        item({ id: "a" }),
        item({
          id: "b",
          status: "DRAFT",
          documentNumber: null,
          opens: "EDITOR",
        }),
      ]),
    );
    render(<BillingDocumentListPage />);
    const rows = await screen.findAllByRole("row", { name: /megnyitása$/ });
    expect(within(rows[0]!).getByText("Adatlap")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Szerkesztő")).toBeInTheDocument();
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
