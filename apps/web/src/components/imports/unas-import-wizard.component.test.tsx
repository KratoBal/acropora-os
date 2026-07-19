import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session, UnasImportReport } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnasImportWizard } from "./unas-import-wizard";

const api = vi.hoisted(() => ({
  uploadDryRun: vi.fn(),
  report: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/lib/api/imports", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/imports")>();
  return { ...original, importApi: api };
});
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const ownerSession: Session = {
  id: "session-owner",
  token: "owner-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
  },
};

const report: UnasImportReport = {
  batchId: "batch-123",
  provider: "UNAS",
  sourceFileName: "catalog.xlsx",
  generatedAt: "2026-07-19T10:00:00.000Z",
  summary: {
    productsToCreate: 4,
    productsToUpdate: 2,
    productsUnchanged: 8,
    categoriesToCreate: 3,
    categoriesToUpdate: 1,
    validationErrors: 1,
    warnings: 1,
  },
  products: [
    {
      sourceRowNumber: 7,
      sku: "REEF-1",
      productName: "Reef Pump",
      action: "UPDATE",
      issues: [
        {
          severity: "ERROR",
          code: "INVALID_CATEGORY_REFERENCE",
          message: "Ismeretlen kategória.",
          sourceRowNumber: 7,
          entityType: "PRODUCT",
        },
        {
          severity: "WARNING",
          code: "UNEXPECTED_STATUS",
          message: "Nem várt UNAS státusz: 9.",
          sourceRowNumber: 7,
          entityType: "PRODUCT",
        },
      ],
      changes: [
        { field: "title", before: "Old Pump", after: "Reef Pump" },
        { field: "category", before: ["old"], after: ["new"] },
        { field: "brand", before: "Old", after: "New" },
        { field: "images", before: ["old.jpg"], after: ["new.jpg"] },
        { field: "activeState", before: false, after: true },
        { field: "channelListing", before: "1", after: "9" },
      ],
    },
  ],
  issues: [
    {
      severity: "ERROR",
      code: "INVALID_CATEGORY_REFERENCE",
      message: "Ismeretlen kategória.",
      sourceRowNumber: 7,
      entityType: "PRODUCT",
    },
    {
      severity: "WARNING",
      code: "UNEXPECTED_STATUS",
      message: "Nem várt UNAS státusz: 9.",
      sourceRowNumber: 7,
      entityType: "PRODUCT",
    },
  ],
};

const xlsx = () =>
  new File(["xlsx"], "catalog.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

async function upload() {
  fireEvent.change(screen.getByLabelText("Fájl kiválasztása"), {
    target: { files: [xlsx()] },
  });
  await screen.findByText("Létrehozandó termékek");
}

beforeEach(() => {
  auth.session = ownerSession;
  api.uploadDryRun
    .mockReset()
    .mockImplementation(
      async (
        _token: string,
        _file: File,
        progress: (value: number) => void,
      ) => {
        progress(45);
        progress(100);
        return report;
      },
    );
  api.report.mockReset().mockResolvedValue(report);
});

describe("UnasImportWizard", () => {
  it("feltöltés közben progress és skeleton állapotot mutat", async () => {
    let resolveUpload!: (value: UnasImportReport) => void;
    api.uploadDryRun.mockImplementation(
      (_token: string, _file: File, progress: (value: number) => void) => {
        progress(45);
        return new Promise<UnasImportReport>((resolve) => {
          resolveUpload = resolve;
        });
      },
    );
    render(createElement(UnasImportWizard));
    fireEvent.change(screen.getByLabelText("Fájl kiválasztása"), {
      target: { files: [xlsx()] },
    });

    expect(await screen.findByText("45%")).toBeInTheDocument();
    expect(screen.getByLabelText("Import feldolgozása")).toBeInTheDocument();
    await act(async () => resolveUpload(report));
  });

  it("XLSX feltöltést indít és megjeleníti a dry-run összegzést", async () => {
    render(createElement(UnasImportWizard));
    await upload();

    expect(api.uploadDryRun).toHaveBeenCalledWith(
      "owner-token",
      expect.objectContaining({ name: "catalog.xlsx" }),
      expect.any(Function),
    );
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("kliensoldalon elutasítja a nem XLSX fájlt", () => {
    render(createElement(UnasImportWizard));
    fireEvent.change(screen.getByLabelText("Fájl kiválasztása"), {
      target: { files: [new File(["csv"], "catalog.csv")] },
    });

    expect(
      screen.getByText("Csak XLSX fájl tölthető fel."),
    ).toBeInTheDocument();
    expect(api.uploadDryRun).not.toHaveBeenCalled();
  });

  it("külön hibák és figyelmeztetések tabot jelenít meg", async () => {
    render(createElement(UnasImportWizard));
    await upload();
    fireEvent.click(screen.getByRole("button", { name: /Validáció/ }));

    expect(screen.getByText("INVALID_CATEGORY_REFERENCE")).toBeInTheDocument();
    expect(screen.getByText("REEF-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Figyelmeztetések/ }));
    expect(screen.getByText("UNEXPECTED_STATUS")).toBeInTheDocument();
  });

  it("termékenként megjeleníti mind a hat diff típust nyers státusszal", async () => {
    render(createElement(UnasImportWizard));
    await upload();
    fireEvent.click(screen.getByRole("button", { name: /Változások/ }));

    for (const label of [
      "Terméknév",
      "Kategóriák",
      "Brand",
      "Képek",
      "Aktív állapot",
      "UNAS listing",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("API-hibát és retry műveletet jelenít meg", async () => {
    api.uploadDryRun.mockRejectedValueOnce(
      new Error("A backend elutasította az XLSX-et."),
    );
    render(createElement(UnasImportWizard));
    fireEvent.change(screen.getByLabelText("Fájl kiválasztása"), {
      target: { files: [xlsx()] },
    });

    expect(
      await screen.findByText("A backend elutasította az XLSX-et."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Újrapróbálás" }),
    ).toBeInTheDocument();
  });

  it("products.manage nélkül megtagadja a hozzáférést", () => {
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "WAREHOUSE" },
    };
    render(createElement(UnasImportWizard));

    expect(
      screen.getByText("Nincs hozzáférésed az UNAS importhoz"),
    ).toBeInTheDocument();
    expect(api.uploadDryRun).not.toHaveBeenCalled();
  });

  it("batch ID alapján újranyit egy korábbi riportot", async () => {
    render(createElement(UnasImportWizard));
    fireEvent.change(screen.getByRole("textbox", { name: "Batch ID" }), {
      target: { value: "batch-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Riport betöltése" }));

    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith("owner-token", "batch-123"),
    );
    expect(
      await screen.findByText("Létrehozandó termékek"),
    ).toBeInTheDocument();
  });

  it("a riport lépésben megjeleníti a batch ID-t és az export műveleteket", async () => {
    render(createElement(UnasImportWizard));
    await upload();
    fireEvent.click(screen.getByRole("button", { name: /Riport/ }));

    expect(screen.getByText("batch-123")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Összegzés másolása" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "JSON letöltése" }),
    ).toBeInTheDocument();
  });
});
