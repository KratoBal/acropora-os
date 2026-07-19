import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandImportAssistantResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandImportAssistantPage } from "./brand-import-assistant-page";

const state = vi.hoisted(() => ({
  params: new URLSearchParams({ batchId: "batch-1" }),
  session: null as Session | null,
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const api = vi.hoisted(() => ({
  importBatches: vi.fn(),
  importRows: vi.fn(),
  list: vi.fn(),
  createFromImport: vi.fn(),
  mapImportAlias: vi.fn(),
  bulkCreateFromImport: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/brands/import-assistant",
  useSearchParams: () => state.params,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: state.session }),
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
const response: BrandImportAssistantResponse = {
  items: [
    {
      id: "row-1",
      sourceValue: "OASE",
      normalizedSourceValue: "oase",
      occurrenceCount: 3,
      examples: [{ sku: "SKU-1", productName: "Pump", sourceRowNumber: 2 }],
      remainingExampleCount: 2,
      classification: "MISSING_BRAND",
      proposedCanonicalName: "OASE",
      candidates: [],
      reasoning: ["Nem található biztonságos egyezés."],
      resolverVersion: "v2",
      configVersion: "v2",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  summary: {
    total: 1,
    classifications: {
      EXACT_CANONICAL_MATCH: 0,
      ALIAS_MATCH: 0,
      EXTERNAL_MAPPING_MATCH: 0,
      MISSING_BRAND: 1,
      AMBIGUOUS: 0,
      ARCHIVED_MATCH: 0,
      CONFLICT: 0,
    },
    completed: 0,
    unresolved: 1,
    completionPercent: 0,
    batch: {
      id: "batch-1",
      sourceFileName: "catalog.xlsx",
      status: "VALIDATED",
      analysisVersion: "v2",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

describe("Brand import assistant UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session = owner;
    state.params = new URLSearchParams({ batchId: "batch-1" });
    api.importBatches.mockResolvedValue([
      {
        id: "batch-1",
        sourceFileName: "catalog.xlsx",
        status: "VALIDATED",
        analysisVersion: "v2",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    api.importRows.mockResolvedValue(response);
    api.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    });
    api.createFromImport.mockResolvedValue({ row: response.items[0] });
    api.mapImportAlias.mockResolvedValue({ row: response.items[0] });
    api.bulkCreateFromImport.mockResolvedValue({ createdBrands: [] });
  });
  it("shows loading", () => {
    api.importBatches.mockReturnValue(new Promise(() => undefined));
    render(<BrandImportAssistantPage />);
    expect(screen.getByLabelText("Asszisztens betöltése")).toBeInTheDocument();
  });
  it("renders populated summary and row", async () => {
    render(<BrandImportAssistantPage />);
    expect((await screen.findAllByText("OASE")).length).toBeGreaterThan(0);
    expect(screen.getByText("0/1")).toBeInTheDocument();
    expect(screen.getByText("SKU-1 +2")).toBeInTheDocument();
  });
  it("renders empty batch state", async () => {
    api.importRows.mockResolvedValue({
      ...response,
      items: [],
      summary: { ...response.summary, total: 0 },
      pagination: { ...response.pagination, totalItems: 0 },
    });
    render(<BrandImportAssistantPage />);
    expect(
      await screen.findByText("Nincs egyeztetendő forrásmárka"),
    ).toBeInTheDocument();
  });
  it("updates URL for a classification filter", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.change(await screen.findByLabelText("Besorolás"), {
      target: { value: "MISSING_BRAND" },
    });
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining("classification=MISSING_BRAND"),
    );
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining("page=1"),
    );
  });
  it("debounces search and resets page", async () => {
    vi.useFakeTimers();
    render(<BrandImportAssistantPage />);
    fireEvent.change(screen.getByLabelText("Forrásmárka keresése"), {
      target: { value: "oase" },
    });
    await vi.advanceTimersByTimeAsync(351);
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining("search=oase"),
    );
    vi.useRealTimers();
  });
  it("opens row details with reasoning", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.click(await screen.findByText("Részletek"));
    expect(
      screen.getByRole("dialog", { name: "Forrásmárka részletei" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nem található biztonságos egyezés."),
    ).toBeInTheDocument();
  });
  it("prefills create dialog", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.click(await screen.findByText("Létrehozás"));
    expect(screen.getByLabelText("Kanonikus márkanév")).toHaveValue("OASE");
  });
  it("submits one Brand without invented external ID", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.click(await screen.findByText("Létrehozás"));
    fireEvent.click(screen.getByText("Megerősítés"));
    await waitFor(() =>
      expect(api.createFromImport).toHaveBeenCalledWith(
        "token",
        "batch-1",
        "row-1",
        expect.objectContaining({ createExternalMapping: false }),
      ),
    );
  });
  it("selects only explicit rows and requires typed bulk confirmation", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.click(await screen.findByLabelText("OASE kijelölése"));
    fireEvent.click(screen.getByText("Kijelölt 1 létrehozása"));
    expect(screen.getByText("Megerősítés")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Bulk megerősítés"), {
      target: { value: "CREATE 1 BRANDS" },
    });
    expect(screen.getByText("Megerősítés")).toBeEnabled();
  });
  it("submits an atomic bulk request", async () => {
    render(<BrandImportAssistantPage />);
    fireEvent.click(await screen.findByLabelText("OASE kijelölése"));
    fireEvent.click(screen.getByText("Kijelölt 1 létrehozása"));
    fireEvent.change(screen.getByLabelText("Bulk megerősítés"), {
      target: { value: "CREATE 1 BRANDS" },
    });
    fireEvent.click(screen.getByText("Megerősítés"));
    await waitFor(() =>
      expect(api.bulkCreateFromImport).toHaveBeenCalledWith(
        "token",
        "batch-1",
        expect.objectContaining({ rowIds: ["row-1"] }),
      ),
    );
  });
  it("renders read-only users without mutation actions", async () => {
    state.session = { ...owner, user: { ...owner.user, role: "VIEWER" } };
    render(<BrandImportAssistantPage />);
    await screen.findAllByText("OASE");
    expect(screen.queryByText("Létrehozás")).not.toBeInTheDocument();
  });
  it("denies unauthenticated access", () => {
    state.session = null;
    render(<BrandImportAssistantPage />);
    expect(screen.getByText("Nincs hozzáférésed")).toBeInTheDocument();
  });
});
