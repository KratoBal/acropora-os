import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomerSummary, Session } from "@acropora/types";
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

const api = vi.hoisted(() => ({
  customersList: vi.fn(),
  templates: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/api/customers", () => ({
  customersApi: { list: api.customersList },
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
});

const createButton = () =>
  screen.getByRole("button", { name: "Ajánlat létrehozása" });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
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
