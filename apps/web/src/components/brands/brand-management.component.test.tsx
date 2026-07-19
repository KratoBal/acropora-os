import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandDetail, BrandListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandEditorPage } from "./brand-editor-page";
import { BrandListPage } from "./brand-list-page";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  session: null as Session | null,
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/brands",
  useSearchParams: () => state.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: state.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/brands", () => ({ brandsApi: api }));

const owner: Session = {
  id: "s",
  token: "token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
  },
};
const brand: BrandDetail = {
  id: "b1",
  name: "OASE",
  normalizedName: "oase",
  slug: "oase",
  isActive: true,
  aliases: [
    {
      id: "a1",
      alias: "Oase GmbH",
      normalizedAlias: "oase gmbh",
      source: "UNAS",
      isPreferred: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  externalMappings: [{ id: "e1", system: "UNAS", externalId: "42" }],
  usage: { productCount: 3, reviewReferenceCount: 4 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const list: BrandListResponse = {
  items: [brand],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

describe("Brand management UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session = owner;
    state.params = new URLSearchParams();
    api.list.mockResolvedValue(list);
    api.detail.mockResolvedValue(brand);
    api.create.mockResolvedValue(brand);
    api.update.mockResolvedValue(brand);
    api.archive.mockResolvedValue({ ...brand, isActive: false });
    api.restore.mockResolvedValue(brand);
    api.addAlias.mockResolvedValue(brand);
    api.removeAlias.mockResolvedValue({ ...brand, aliases: [] });
  });
  it("shows list loading then populated rows", async () => {
    let resolve!: (value: BrandListResponse) => void;
    api.list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<BrandListPage />);
    expect(screen.getByLabelText("Márkák betöltése")).toBeInTheDocument();
    resolve(list);
    expect(await screen.findByText("OASE")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("shows the empty state", async () => {
    api.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
    render(<BrandListPage />);
    expect(await screen.findByText("Nincsenek márkák")).toBeInTheDocument();
  });
  it("serializes filters and pagination", async () => {
    render(<BrandListPage />);
    await screen.findByText("OASE");
    fireEvent.change(screen.getByLabelText("Státusz"), {
      target: { value: "ARCHIVED" },
    });
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining("status=ARCHIVED"),
    );
  });
  it("hides create actions for read-only users", async () => {
    state.session = { ...owner, user: { ...owner.user, role: "WAREHOUSE" } };
    render(<BrandListPage />);
    await screen.findByText("OASE");
    expect(screen.queryByText("Új márka")).not.toBeInTheDocument();
  });
  it("denies access without products.view", () => {
    state.session = null;
    render(<BrandListPage />);
    expect(
      screen.getByText("Nincs hozzáférésed a márkákhoz"),
    ).toBeInTheDocument();
  });
  it("validates the create form", () => {
    render(<BrandEditorPage />);
    fireEvent.click(screen.getByText("Változások mentése"));
    expect(screen.getByText("A kanonikus név kötelező.")).toBeInTheDocument();
  });
  it("creates a prefilled Brand and returns without accepting review", async () => {
    state.params = new URLSearchParams(
      "name=Nyos&sourceName=NYOS&source=UNAS&returnTo=%2Fadmin%2Fimports%2Funas%2Fbatch%2Freview",
    );
    render(<BrandEditorPage />);
    expect(screen.getByLabelText("Kanonikus név")).toHaveValue("Nyos");
    fireEvent.click(screen.getByText("Változások mentése"));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          name: "Nyos",
          aliases: [{ alias: "NYOS", source: "UNAS" }],
        }),
      ),
    );
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining("brandCreated=b1"),
    );
  });
  it("loads and saves an edit with concurrency token", async () => {
    render(<BrandEditorPage brandId="b1" />);
    await screen.findByText("Használat és források");
    fireEvent.change(screen.getByLabelText("Kanonikus név"), {
      target: { value: "Oase GmbH" },
    });
    fireEvent.click(screen.getByText("Változások mentése"));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        "token",
        "b1",
        expect.objectContaining({ expectedUpdatedAt: brand.updatedAt }),
      ),
    );
  });
  it("adds and removes aliases", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    render(<BrandEditorPage brandId="b1" />);
    await screen.findByText("Oase GmbH");
    fireEvent.change(screen.getByLabelText("Új alias"), {
      target: { value: "Oase Europe" },
    });
    fireEvent.click(screen.getByText("Alias hozzáadása"));
    await waitFor(() => expect(api.addAlias).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Eltávolítás"));
    await waitFor(() =>
      expect(api.removeAlias).toHaveBeenCalledWith("token", "b1", "a1"),
    );
  });
  it("warns about product usage before archive", async () => {
    render(<BrandEditorPage brandId="b1" />);
    await screen.findByText("Archiválás");
    fireEvent.click(screen.getByText("Archiválás"));
    expect(screen.getByRole("dialog")).toHaveTextContent("3 termék");
    fireEvent.click(screen.getByText("Archiválás megerősítése"));
    await waitFor(() =>
      expect(api.archive).toHaveBeenCalledWith("token", "b1"),
    );
  });
});
