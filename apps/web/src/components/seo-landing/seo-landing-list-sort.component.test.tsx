import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SeoLandingPage, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import {
  SEO_LANDING_SORT_COLUMNS,
  SeoLandingListPage,
} from "./seo-landing-list-page";

/*
  A VÁLOGATÁS-LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). A lista minden válogatást betölt, ezért a böngészőben
  rendez. MI PIROSÍT: ha a cím nem a magyar ábécé szerint rendezne (az "Álfa" a "Béta" elé kerül, az ékezetes betű a sima mellett);
  ha a frissítés nap szerint (idő, nem szöveg) rendezne rosszul; ha az állapot nem a közzétett jelző szerint (a vázlat előbb) rendezne;
  ha a ciklus (növekvő, csökkenő, alap) elakad; ha az alap sorrend nem az, ahogy a szerver adta; ha egy ismeretlen rendezés (régi
  vagy kézzel írt link) a listát elrontaná.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/seo-landing-pages", () => ({ seoLandingPagesApi: api }));

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

const page = (
  id: string,
  title: string,
  slug: string,
  isPublished: boolean,
  updatedAt: string,
): SeoLandingPage => ({
  id,
  slug,
  title,
  seoTitle: null,
  metaDescription: null,
  intro: null,
  filter: { categoryIds: [], brandIds: [] } as never,
  isPublished,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

// a szerver sorrendje: Béta, Gamma, Álfa
const PAGES = [
  page("p-beta", "Béta", "beta", true, "2026-11-10T10:00:00.000Z"),
  page("p-gamma", "Gamma", "gamma", false, "2026-11-20T10:00:00.000Z"),
  page("p-alfa", "Álfa", "alfa", false, "2026-10-05T10:00:00.000Z"),
];

const titles = () =>
  screen.getAllByTestId("seo-landing-row").map((row) => {
    const link = within(row).getAllByRole("link")[0]!;
    return link.textContent;
  });
const header = async (name: string) =>
  within(await screen.findByRole("table")).getByRole("button", { name });

beforeEach(() => {
  urlNavigation.reset("/admin/valogatasok");
  api.list.mockReset().mockResolvedValue(PAGES);
});

describe("SeoLandingListPage sorting", () => {
  it("the default order is the server's", async () => {
    render(<SeoLandingListPage />);
    await screen.findAllByTestId("seo-landing-row");
    expect(titles()).toEqual(["Béta", "Gamma", "Álfa"]);
  });

  it("the title sorts by the Hungarian alphabet, ascending then descending then back to the default", async () => {
    render(<SeoLandingListPage />);
    await screen.findAllByTestId("seo-landing-row");
    fireEvent.click(await header("Válogatás"));
    await waitFor(() => expect(titles()).toEqual(["Álfa", "Béta", "Gamma"]));
    fireEvent.click(await header("Válogatás"));
    await waitFor(() => expect(titles()).toEqual(["Gamma", "Béta", "Álfa"]));
    fireEvent.click(await header("Válogatás"));
    await waitFor(() => expect(titles()).toEqual(["Béta", "Gamma", "Álfa"]));
  });

  it("the update day sorts as a time, and the state puts the drafts before the published ones", async () => {
    render(<SeoLandingListPage />);
    await screen.findAllByTestId("seo-landing-row");
    fireEvent.click(await header("Frissítve"));
    await waitFor(() => expect(titles()).toEqual(["Álfa", "Béta", "Gamma"]));
    fireEvent.click(await header("Állapot"));
    // vázlat (Gamma, Álfa) előbb, a közzétett (Béta) utána; az egyenlők a szerver sorrendjében
    await waitFor(() => expect(titles()).toEqual(["Gamma", "Álfa", "Béta"]));
  });

  it("an unknown sort in the address leaves the server's order", async () => {
    urlNavigation.reset("/admin/valogatasok", "sort=nincs&direction=asc");
    render(<SeoLandingListPage />);
    await screen.findAllByTestId("seo-landing-row");
    expect(titles()).toEqual(["Béta", "Gamma", "Álfa"]);
  });

  it("every column has a sort button and the map covers exactly them", async () => {
    render(<SeoLandingListPage />);
    const table = await screen.findByRole("table");
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((cell) => within(cell).queryByRole("button"))
      .map((cell) => cell.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual([
      "Válogatás",
      "Cím a webshopban",
      "Állapot",
      "Frissítve",
    ]);
    expect(Object.keys(SEO_LANDING_SORT_COLUMNS).sort()).toEqual([
      "slug",
      "status",
      "title",
      "updated",
    ]);
  });
});
