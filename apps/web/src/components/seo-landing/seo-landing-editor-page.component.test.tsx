import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SeoLandingPage, Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeoLandingEditorPage } from "./seo-landing-editor-page";

/*
  THE LANDING PAGE EDITOR (SEO P1-14, part D). What turns these red: an empty
  filter sent to the server; an inactive category or a brand the shop hides
  chosen without a warning; the saved body not what the server expects; a slug
  change without saying the old address redirects; a viewer able to edit.
*/
const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/admin/valogatasok/new",
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({
  options: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/api/seo-landing-pages", () => ({ seoLandingPagesApi: api }));
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

const options = {
  categories: [
    { id: "cat-led", path: "Világítás > LED", isActive: true },
    { id: "cat-old", path: "Világítás > Régi", isActive: false },
  ],
  brands: [
    { id: "brand-kessil", name: "Kessil", shown: true },
    { id: "brand-gone", name: "Megszűnt", shown: false },
  ],
};
const page = (over: Partial<SeoLandingPage> = {}): SeoLandingPage => ({
  id: "lp-1",
  slug: "led-vilagitas",
  title: "LED világítás",
  seoTitle: null,
  metaDescription: null,
  intro: null,
  filter: { storeCategoryIds: ["cat-led"], brandIds: [], attributeFilters: [] },
  isPublished: false,
  createdAt: "2026-10-12T20:00:00.000Z",
  updatedAt: "2026-10-12T20:00:00.000Z",
  ...over,
});

beforeEach(() => {
  auth.role = "OWNER";
  navigation.replace.mockReset();
  api.options.mockReset().mockResolvedValue(options);
  api.detail.mockReset().mockResolvedValue(page());
  api.create.mockReset().mockResolvedValue(page({ id: "lp-new" }));
  api.update
    .mockReset()
    .mockImplementation(async (_t, _id, input) => page(input));
});

describe("SeoLandingEditorPage", () => {
  it("LP-ED-EMPTY: no category and no brand is refused before the server", async () => {
    render(<SeoLandingEditorPage />);
    fireEvent.change(await screen.findByLabelText("Cím"), {
      target: { value: "Válogatás" },
    });
    fireEvent.change(screen.getByLabelText("Webshop-cím"), {
      target: { value: "valogatas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Létrehozás" }));
    expect(
      await screen.findByText("filter: at least one category or brand"),
    ).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("LP-ED-CREATE: the chosen category goes in the body, then the page opens", async () => {
    render(<SeoLandingEditorPage />);
    fireEvent.change(await screen.findByLabelText("Cím"), {
      target: { value: "LED világítás" },
    });
    fireEvent.change(screen.getByLabelText("Webshop-cím"), {
      target: { value: "led-vilagitas" },
    });
    fireEvent.click(screen.getByLabelText("Világítás > LED"));
    fireEvent.click(screen.getByRole("button", { name: "Létrehozás" }));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/admin/valogatasok/lp-new",
      ),
    );
    expect(api.create).toHaveBeenCalledWith("token-1", {
      slug: "led-vilagitas",
      title: "LED világítás",
      seoTitle: null,
      metaDescription: null,
      intro: null,
      filter: {
        storeCategoryIds: ["cat-led"],
        brandIds: [],
        attributeFilters: [],
      },
      isPublished: false,
    });
  });

  it("LP-ED-WARN: an inactive category and a hidden brand are named", async () => {
    render(<SeoLandingEditorPage landingId="lp-1" />);
    fireEvent.click(await screen.findByLabelText(/Világítás > Régi/));
    fireEvent.click(screen.getByLabelText(/Megszűnt/));
    expect(
      await screen.findByText(/„Világítás > Régi” kategória nem aktív/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/„Megszűnt” márka nem látszik a webshopban/),
    ).toBeInTheDocument();
  });

  it("LP-ED-RENAME: a slug change says the old address redirects", async () => {
    render(<SeoLandingEditorPage landingId="lp-1" />);
    fireEvent.change(await screen.findByLabelText("Webshop-cím"), {
      target: { value: "led-lampak" },
    });
    expect(
      screen.getByText(/a régi cím átirányít: \/hu\/valogatas\/led-vilagitas/),
    ).toBeInTheDocument();
  });

  it("LP-ED-VIEWER: without products.manage there is no form", async () => {
    auth.role = "VIEWER" as UserRole;
    render(<SeoLandingEditorPage landingId="lp-1" />);
    expect(screen.getByText("Nincs hozzáférésed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });
});
