import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomerSummary, Permission, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteNewPage } from "./quote-new-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/ajanlatok/uj",
  useSearchParams: () => new URLSearchParams(),
}));

// per-user permissions (undefined: the role's own set, ADMIN has it all)
const auth = vi.hoisted(() => ({
  permissions: undefined as Permission[] | undefined,
}));
const api = vi.hoisted(() => ({
  customersList: vi.fn(),
  customersCreate: vi.fn(),
  templates: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/api/customers", () => ({
  customersApi: { list: api.customersList, create: api.customersCreate },
}));
vi.mock("@/lib/api/quotes", () => ({
  quotesApi: { templates: api.templates, create: api.create },
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
        displayName: "Luca",
        role: "ADMIN",
        customerId: null,
        supplierId: null,
        ...(auth.permissions ? { permissions: auth.permissions } : {}),
      },
    } satisfies Session,
  }),
}));

const ZOO = {
  id: "c-zoo",
  displayName: "Fővárosi Állat- és Növénykert",
  partnerMirror: true,
} as unknown as CustomerSummary;
const BUYER = {
  id: "c-buyer",
  displayName: "Fővárosi Víz Kft.",
  partnerMirror: false,
} as unknown as CustomerSummary;

const list = (items: CustomerSummary[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  pagination: {
    page: 1,
    pageSize: 10,
    totalItems: items.length,
    totalPages: 1,
  },
});

const createButton = () =>
  screen.getByRole("button", { name: "Ajánlat létrehozása" });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  auth.permissions = undefined;
  api.templates.mockResolvedValue([]);
  api.customersList.mockResolvedValue(list([ZOO, BUYER]));
});

/*
  AZ UJ ARAJANLAT PARTNER-VALASZTOJA (Luca, 2026-11-05, elo OS). MI PIROSIT: ha a kereses nem kéri a partner-
  tukroket (az egyesites utan a megmarado sor a partner-torzs kotesét viseli, és a kereso soha nem ajanlja fel);
  ha a partner-sor nincs megjelolve; ha a szurke gomb mellett nem all, MIERT szurke; ha egy üres találat
  ugyanugy nez ki, mint egy meg nem erkezett valasz; ha a hibas kereses "nincs ilyen partner"-t mond.
*/
describe("a partner-választó az új árajánlatnál", () => {
  it("asks for the partners' customer rows too, marks a partner, and lets the chosen one create the quote", async () => {
    api.create.mockResolvedValue({ id: "q-new" });
    render(<QuoteNewPage />);
    type("Partner keresése", "Fővárosi Állat");
    const zoo = await screen.findByRole("button", {
      name: /Fővárosi Állat- és Növénykert/,
    });
    const query = api.customersList.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("includePartnerMirrors")).toBe("true");
    expect(query.get("search")).toBe("Fővárosi Állat");
    expect(zoo.textContent).toContain("partner");
    expect(
      screen.getByRole("button", { name: /Fővárosi Víz Kft\./ }).textContent,
    ).not.toContain("partner");

    fireEvent.click(zoo);
    type("Ajánlat címe", "Cápasuli lámpák beszerzése");
    expect(createButton()).toBeEnabled();
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({ customerId: "c-zoo" }),
      ),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/ajanlatok/q-new/szerkesztes",
      ),
    );
  });

  it("says why the create button is grey, and drops the sentence when everything is there", async () => {
    render(<QuoteNewPage />);
    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(
        /még hiányzik: a partner \(válaszd ki a találatok közül\) és az ajánlat címe\./,
      ),
    ).toBeInTheDocument();
    type("Ajánlat címe", "Cápasuli lámpák beszerzése");
    expect(
      screen.getByText(
        /még hiányzik: a partner \(válaszd ki a találatok közül\)\./,
      ),
    ).toBeInTheDocument();
    type("Partner keresése", "Fővárosi");
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Fővárosi Állat- és Növénykert/,
      }),
    );
    expect(screen.queryByText(/még hiányzik/)).not.toBeInTheDocument();
  });

  it("says there is no such partner only after a search has answered empty", async () => {
    api.customersList.mockResolvedValue(list([]));
    render(<QuoteNewPage />);
    type("Partner keresése", "Nincsilyen");
    expect(
      await screen.findByText(/Nincs ilyen partner\./),
    ).toBeInTheDocument();
    // a new text: the old answer says nothing about it until the new one comes
    api.customersList.mockReturnValue(new Promise(() => {}));
    type("Partner keresése", "Nincsilyen2");
    expect(screen.queryByText(/Nincs ilyen partner\./)).not.toBeInTheDocument();
  });

  it("a failed search says so, and never says there is no such partner", async () => {
    api.customersList.mockRejectedValue(new Error("A kérés nem sikerült."));
    render(<QuoteNewPage />);
    type("Partner keresése", "Fővárosi");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A kérés nem sikerült.",
    );
    expect(screen.queryByText(/Nincs ilyen partner\./)).not.toBeInTheDocument();
  });
});

/*
  AZ UJ MAGANSZEMELY GOMB (Luca, 2026-11-12, kartya 7dd76d60). MI PIROSIT: ha nem a meglevo vevo-vegpontot hivja PERSON
  tipussal; ha az e-mail kotelezove valik; ha egy meglevo e-mail mellett masodik vevot hoz letre; ha a duplikatum-
  ellenorzes hibaja engedi a letrehozast; ha a gomb a jog nelkulinek is megjelenik.
*/
describe("az új magánszemély az új árajánlatnál", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: "Új magánszemély" }));
  const submitPerson = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Magánszemély felvétele" }),
    );
  const PERSON = {
    id: "c-new",
    displayName: "Kiss Anna",
    type: "PERSON",
  } as unknown as CustomerSummary;

  it("creates a PERSON customer from the name alone and makes it the quote's customer", async () => {
    api.customersCreate.mockResolvedValue(PERSON);
    render(<QuoteNewPage />);
    open();
    expect(
      screen.getByRole("button", { name: "Magánszemély felvétele" }),
    ).toBeDisabled();
    type("Név", "Kiss Anna");
    submitPerson();
    await waitFor(() =>
      expect(api.customersCreate).toHaveBeenCalledWith("token-1", {
        type: "PERSON",
        displayName: "Kiss Anna",
        addresses: [],
      }),
    );
    // no e-mail, so nothing to look up
    expect(api.customersList).not.toHaveBeenCalled();
    // the chosen customer shows in the Partner field and in the summary
    expect((await screen.findAllByText("Kiss Anna")).length).toBe(2);
    expect(screen.queryByLabelText("Partner keresése")).not.toBeInTheDocument();
  });

  it("looks the e-mail up first and offers the existing customer instead of creating a second", async () => {
    api.customersList.mockResolvedValue(
      list([
        {
          id: "c-old",
          displayName: "Kiss Anna",
          email: "Anna@Example.hu",
        } as unknown as CustomerSummary,
      ]),
    );
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "anna@example.hu");
    submitPerson();
    expect(
      await screen.findByText(/Már van ilyen e-mail című vevő:/),
    ).toBeInTheDocument();
    const query = api.customersList.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("status")).toBe("ALL");
    expect(query.get("search")).toBe("anna@example.hu");
    expect(api.customersCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ezt választom" }));
    expect(screen.queryByLabelText("Partner keresése")).not.toBeInTheDocument();
    expect(screen.getAllByText("Kiss Anna").length).toBeGreaterThan(0);
    expect(api.customersCreate).not.toHaveBeenCalled();
  });

  it("matches the billing e-mail too, and creates when the e-mail is new", async () => {
    api.customersList.mockResolvedValueOnce(
      list([
        {
          id: "c-bill",
          displayName: "Számlázós Bt.",
          email: "x@example.hu",
          billingEmail: "anna@example.hu",
        } as unknown as CustomerSummary,
      ]),
    );
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "anna@example.hu");
    submitPerson();
    expect(await screen.findByText("Számlázós Bt.")).toBeInTheDocument();

    // a different e-mail: the list answers with someone else's row, so it is a new person
    api.customersCreate.mockResolvedValue(PERSON);
    type("E-mail cím", "masik@example.hu");
    submitPerson();
    await waitFor(() =>
      expect(api.customersCreate).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({ email: "masik@example.hu" }),
      ),
    );
  });

  it("asks for the widest page, and creates nothing when the page is truncated without the exact match", async () => {
    api.customersList.mockResolvedValue({
      ...list([
        {
          id: "c-joanna",
          displayName: "Joanna",
          email: "joanna@example.hu",
        } as unknown as CustomerSummary,
      ]),
      pagination: { page: 1, pageSize: 100, totalItems: 11, totalPages: 1 },
    });
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "anna@example.hu");
    submitPerson();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Túl sok hasonló e-mail című vevő van",
    );
    const query = api.customersList.mock.calls.at(-1)![1] as URLSearchParams;
    expect(query.get("pageSize")).toBe("100");
    expect(api.customersCreate).not.toHaveBeenCalled();
  });

  it("an exact match on a truncated page is still offered, with the inactive state said", async () => {
    api.customersList.mockResolvedValue({
      ...list([
        {
          id: "c-old",
          displayName: "Kiss Anna",
          email: "anna@example.hu",
          isActive: false,
        } as unknown as CustomerSummary,
      ]),
      pagination: { page: 1, pageSize: 100, totalItems: 11, totalPages: 1 },
    });
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "anna@example.hu");
    submitPerson();
    expect(await screen.findByText(/\(inaktív\)/)).toBeInTheDocument();
    expect(api.customersCreate).not.toHaveBeenCalled();
  });

  it("creates nothing when the duplicate check fails, and says so", async () => {
    api.customersList.mockRejectedValue(new Error("A kérés nem sikerült."));
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "anna@example.hu");
    submitPerson();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A kérés nem sikerült.",
    );
    expect(api.customersCreate).not.toHaveBeenCalled();
  });

  it("offers the button only to someone who may manage customers", () => {
    auth.permissions = ["quotes.manage"];
    render(<QuoteNewPage />);
    expect(screen.getByLabelText("Partner keresése")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Új magánszemély" }),
    ).not.toBeInTheDocument();
  });

  it("refuses a malformed e-mail before any call", () => {
    render(<QuoteNewPage />);
    open();
    type("Név", "Kiss Anna");
    type("E-mail cím", "nem-email");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Az e-mail cím formátuma nem megfelelő.",
    );
    expect(
      screen.getByRole("button", { name: "Magánszemély felvétele" }),
    ).toBeDisabled();
    expect(api.customersList).not.toHaveBeenCalled();
  });
});
