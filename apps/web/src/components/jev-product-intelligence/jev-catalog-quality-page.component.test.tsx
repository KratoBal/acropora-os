import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JevCatalogQualityPage } from "./jev-catalog-quality-page";
import { catalogQueueState } from "./jev-catalog-quality";

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function session(
  role: Session["user"]["role"],
  navigation?: Session["navigation"],
): Session {
  return {
    id: "s",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "teszt@example.invalid",
      displayName: "Teszt Kolléga",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
    ...(navigation ? { navigation } : {}),
  };
}

/** The menu as a server with JEV_PRODUCT_ENRICHMENT on would serve it. */
const SWITCH_ON: Session["navigation"] = [
  { id: "products", surfaces: ["web", "mobile"] },
  { id: "product-data-quality", surfaces: ["web"] },
];

const FILTERS = [
  "Összes",
  "Kritikus",
  "Ütközés",
  "Hiányzó adat",
  "Javaslat",
  "Ellenőrzött",
];

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// MI PIROSÍT: ha a kikapcsolt kapcsolónál a sor nyugodt üres állapotot
// mondana ("nincs ellenőrizendő"); ha a két "nem elérhető" ok összemosódna;
// ha egy szűrő hiányozna; ha az indítás vagy az export engedélyezett lenne; ha
// a lap bármit lekérne; ha jog nélkül is megnyílna.
describe("JevCatalogQualityPage", () => {
  it("switch off: the six filters over an empty queue that says it is unavailable", () => {
    auth.session = session("OWNER");
    render(<JevCatalogQualityPage />);

    expect(
      screen.getByRole("heading", { name: "Katalógus adatminőség" }),
    ).toBeInTheDocument();
    const filters = within(screen.getByRole("group", { name: "Szűrés" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(filters).toEqual(FILTERS);
    expect(screen.getByRole("status")).toHaveTextContent(
      "A katalógus adatminőség-ellenőrzése jelenleg nem elérhető.",
    );
    expect(
      screen.queryByText("Nem találtunk ellenőrzést igénylő termékadatot."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("0 elem megjelenítve")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("switch on, as served: still no rows, and it says there is no stored run", () => {
    auth.session = session("VIEWER", SWITCH_ON);
    render(<JevCatalogQualityPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Az ellenőrzési sor még nem elérhető: nincs tárolt JEV ellenőrzés.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a filter can be chosen, and the empty state does not change its meaning", () => {
    auth.session = session("OWNER", SWITCH_ON);
    render(<JevCatalogQualityPage />);

    const conflict = screen.getByRole("button", { name: "Ütközés" });
    expect(conflict).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(conflict);
    expect(conflict).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Összes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "nincs tárolt JEV ellenőrzés",
    );
  });

  it("starting a check and the export are disabled, with the reason in words", () => {
    auth.session = session("OWNER", SWITCH_ON);
    render(<JevCatalogQualityPage />);

    expect(
      screen.getByRole("button", { name: "Új ellenőrzés indítása" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Ellenőrzés indítása még nincs engedélyezve."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(
      screen.getByText("Az export még nincs engedélyezve."),
    ).toBeInTheDocument();
    // no KPI cards and no catalogue-wide total until designed and backed
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ellenőrzendő rekord/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Összes megtekintése" }),
    ).not.toBeInTheDocument();
  });

  it("without products.view it does not open, even with the switch on", () => {
    auth.session = session("SERVICE", SWITCH_ON);
    render(<JevCatalogQualityPage />);

    expect(
      screen.getByText("Nincs hozzáférésed a termékekhez"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Szűrés" }),
    ).not.toBeInTheDocument();
  });

  it("the state follows only the served switch", () => {
    expect(catalogQueueState(new Set())).toBe("unavailable");
    expect(catalogQueueState(new Set(["jev-product-enrichment"]))).toBe(
      "no-stored-run",
    );
  });
});
