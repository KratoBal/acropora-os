import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Session,
  SupplierPriceListSummary,
  SupplierPriceListUploadResult,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoverageCell, PriceListsPage, todayText } from "./price-lists-page";

/**
 * BESZÁLLÍTÓI ÁRLISTÁK (task beszallitoi-arlistak): a feltöltő oldal. A
 * formátumot a feltöltő választja; a törlés kétlépéses; olvasó joggal nincs
 * űrlap és nincs törlés.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/beszerzes/arlistak",
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api/price-lists", () => ({ priceListsApi: api }));
const suppliersApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi }));

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

const summary = (
  overrides: Partial<SupplierPriceListSummary> = {},
): SupplierPriceListSummary => ({
  id: "list-1",
  supplierId: "sup-1",
  supplierName: "De Jong Marinelife",
  format: "DEJONG_STOCKLIST",
  listDate: "2026-10-12",
  currency: "EUR",
  fileName: "dejong-week41.csv",
  rowCount: 7075,
  rejectedRowCount: 0,
  createdAt: "2026-10-23T10:00:00.000Z",
  coverage: {
    rows: 7075,
    matched: {
      ean: { auto: 3900, approved: 12 },
      supplierCode: { auto: 200, approved: 0 },
      name: { auto: 0, approved: 8 },
    },
    rejected: 5,
    unmatchedWithBarcode: 1100,
    unmatchedWithoutBarcode: 1850,
    unmatchedBarcodeKnownToUs: 0,
  },
  ...overrides,
});

const uploaded = (
  overrides: Partial<SupplierPriceListUploadResult> = {},
): SupplierPriceListUploadResult => ({
  listId: "list-2",
  supplierId: "sup-1",
  format: "HERTLEIN_ARTIKEL",
  listDate: "2026-10-23",
  currency: "EUR",
  fileName: "hertlein.csv",
  rowCount: 7264,
  rejectedRowCount: 2,
  skippedRows: 1,
  duplicateRows: 166,
  rejectedByReason: { BAD_PRICE: 1, NO_CODE: 1 },
  matching: {
    alreadyMatched: 10,
    autoByEan: 256,
    autoByCode: 3,
    conflicts: 4,
    previouslyRejected: 12,
    unmatched: 6991,
  },
  nameSuggestions: 481,
  ...overrides,
});

beforeEach(() => {
  auth.role = "OWNER";
  for (const fn of [...Object.values(api), ...Object.values(suppliersApi)])
    fn.mockReset();
  api.list.mockResolvedValue({
    items: [summary()],
    variants: { active: 1900, withoutBarcode: 1100 },
  });
  api.upload.mockResolvedValue(uploaded());
  api.remove.mockResolvedValue({ removedRows: 7075 });
  suppliersApi.list.mockResolvedValue({
    items: [
      { id: "sup-1", name: "De Jong Marinelife" },
      { id: "sup-2", name: "Hertlein" },
    ],
    pagination: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
});

const csv = () =>
  new File(["Code,Description,Price\n"], "hertlein.csv", { type: "text/csv" });

async function fillForm() {
  await screen.findByText("De Jong Marinelife", { selector: "span" });
  fireEvent.change(await screen.findByLabelText("Beszállító"), {
    target: { value: "sup-2" },
  });
  fireEvent.change(screen.getByLabelText("A fájl formátuma"), {
    target: { value: "HERTLEIN_ARTIKEL" },
  });
  fireEvent.change(screen.getByLabelText("A lista dátuma"), {
    target: { value: "2026-10-23" },
  });
  fireEvent.change(screen.getByLabelText("Fájl"), {
    target: { files: [csv()] },
  });
}

describe("PriceListsPage", () => {
  it("lists the uploaded lists with the format, the date and the rows", async () => {
    render(<PriceListsPage />);
    const row = (await screen.findByText("dejong-week41.csv")).closest("tr")!;
    expect(within(row).getByText("De Jong Marinelife")).toBeInTheDocument();
    expect(
      within(row).getByText("De Jong heti stocklist (CSV)"),
    ).toBeInTheDocument();
    expect(within(row).getByText("2026. 10. 12.")).toBeInTheDocument();
    expect(within(row).getByText("7075")).toBeInTheDocument();
  });

  it("keeps the upload button off until the supplier, the format, the date, the currency and the file are all set", async () => {
    render(<PriceListsPage />);
    const button = await screen.findByRole("button", { name: "Feltöltés" });
    expect(button).toBeDisabled();
    await fillForm();
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("A fájl formátuma"), {
      target: { value: "" },
    });
    expect(button).toBeDisabled();

    // and with everything set but the file
    fireEvent.change(screen.getByLabelText("A fájl formátuma"), {
      target: { value: "HERTLEIN_ARTIKEL" },
    });
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Fájl"), {
      target: { files: [] },
    });
    expect(button).toBeDisabled();
  });

  it("sends the CHOSEN format, supplier, date, currency and file, and shows what became of the rows", async () => {
    render(<PriceListsPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    const [token, input] = api.upload.mock.calls[0]!;
    expect(token).toBe("token-1");
    expect(input).toMatchObject({
      supplierId: "sup-2",
      format: "HERTLEIN_ARTIKEL",
      listDate: "2026-10-23",
      currency: "EUR",
    });
    expect((input as { file: File }).file.name).toBe("hertlein.csv");
    const summaryText = await screen.findByText(/7264 sor került be/);
    expect(summaryText).toHaveTextContent(
      "2 sor kimaradt (az ár nem olvasható: 1, nincs cikkszám: 1)",
    );
    expect(summaryText).toHaveTextContent(
      "166 azonos ismétlődő sor egyszer számít",
    );
    expect(summaryText).toHaveTextContent("256 új vonalkód szerint");
    expect(summaryText).toHaveTextContent("4 ütközés (ember dönt)");
    // a rejected match is counted on its own, not hidden among the unmatched
    expect(summaryText).toHaveTextContent(
      "12 korábban elutasított (nem javasoljuk újra)",
    );
    expect(summaryText).toHaveTextContent("6991 párosítatlan");
    expect(summaryText).toHaveTextContent(
      "481 sorhoz név alapú javaslat készült, jóváhagyásra vár",
    );
    // the list reloads after the upload
    await waitFor(() =>
      expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("shows the server's refusal and does not reload the list as if it had worked", async () => {
    api.upload.mockRejectedValueOnce(
      new Error("A fájl nem a választott formátumú."),
    );
    render(<PriceListsPage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Feltöltés" }));
    expect(
      await screen.findByText("A fájl nem a választott formátumú."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sor került be/)).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("deletes only after the shared dialog is confirmed, and says the matches stay", async () => {
    render(<PriceListsPage />);
    const row = (await screen.findByText("dejong-week41.csv")).closest("tr")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "dejong-week41.csv törlése" }),
    );
    expect(api.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Törlöd ezt az árlistát?",
    });
    expect(
      within(dialog).getByText(
        /dejong-week41\.csv.*A termékpárosítások megmaradnak/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Törlés" }));
    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith("token-1", "list-1"),
    );
  });

  it("lets the dialog be cancelled: nothing is deleted and the dialog closes", async () => {
    render(<PriceListsPage />);
    const row = (await screen.findByText("dejong-week41.csv")).closest("tr")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "dejong-week41.csv törlése" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Mégsem",
      }),
    );
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives a viewer the list without the upload form and without the delete button", async () => {
    auth.role = "VIEWER";
    render(<PriceListsPage />);
    expect(await screen.findByText("dejong-week41.csv")).toBeInTheDocument();
    expect(screen.queryByText("Árlista feltöltése")).toBeNull();
    expect(screen.queryByRole("button", { name: /törlése/ })).toBeNull();
    expect(suppliersApi.list).not.toHaveBeenCalled();
  });

  it("says so when nothing was uploaded yet", async () => {
    api.list.mockResolvedValue({
      items: [],
      variants: { active: 1900, withoutBarcode: 1100 },
    });
    render(<PriceListsPage />);
    expect(
      await screen.findByText("Még nincs feltöltött árlista"),
    ).toBeInTheDocument();
  });

  it("shows the load error", async () => {
    api.list.mockRejectedValueOnce(new Error("Nincs kapcsolat."));
    render(<PriceListsPage />);
    expect(await screen.findByText("Nincs kapcsolat.")).toBeInTheDocument();
  });

  it("takes today in Budapest: just after midnight there the UTC day is still yesterday", () => {
    // 2026-10-23 22:30 UTC is 2026-10-24 00:30 in Budapest (CEST)
    expect(todayText(new Date("2026-10-23T22:30:00.000Z"))).toBe("2026-10-24");
    // in winter time (CET) the shift is one hour
    expect(todayText(new Date("2026-12-10T23:30:00.000Z"))).toBe("2026-12-11");
    expect(todayText(new Date("2026-10-23T12:00:00.000Z"))).toBe("2026-10-23");
  });

  it("says so when the supplier list cannot be loaded, instead of an empty chooser nobody can explain", async () => {
    suppliersApi.list.mockRejectedValue(new Error("Nincs kapcsolat."));
    render(<PriceListsPage />);
    expect(
      await screen.findByText(
        "A beszállítók listája nem tölthető be: Nincs kapcsolat.",
      ),
    ).toBeInTheDocument();
  });

  it("says so when there are more suppliers than the chooser shows", async () => {
    suppliersApi.list.mockResolvedValue({
      items: [{ id: "sup-1", name: "De Jong Marinelife" }],
      pagination: { page: 1, pageSize: 100, totalItems: 140, totalPages: 2 },
    });
    render(<PriceListsPage />);
    expect(
      await screen.findByText(
        "A választóban csak az első 1 beszállító látszik (összesen 140).",
      ),
    ).toBeInTheDocument();
  });

  it("shows each list's pairing state: by method, rejected, and unmatched with and without a barcode", async () => {
    render(<PriceListsPage />);
    const cell = await screen.findByTestId("coverage");
    expect(cell).toHaveTextContent(
      "4120 párosítva (vonalkód 3912, cikkszám 200, név 8; ebből jóváhagyott 20)",
    );
    expect(cell).toHaveTextContent(
      "5 elutasítva · 2950 párosítatlan (1100 vonalkóddal, 1850 vonalkód nélkül)",
    );
    expect(cell).not.toHaveTextContent("Figyelem");
  });

  it("says how many of our active variants have no barcode, above the table", async () => {
    render(<PriceListsPage />);
    await screen.findByTestId("coverage");
    expect(
      screen.getByText(/ áll vonalkód nélkül \(1900 aktív változatból\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("1100")).toBeInTheDocument();
  });

  it("warns when an unmatched row's barcode is in our own table: the matcher should have caught it", () => {
    const base = summary().coverage;
    const { rerender } = render(<CoverageCell coverage={base} />);
    expect(screen.queryByText(/Figyelem/)).toBeNull();
    rerender(
      <CoverageCell coverage={{ ...base, unmatchedBarcodeKnownToUs: 7 }} />,
    );
    expect(
      screen.getByText(
        /7 vonalkódja szerepel a mi vonalkód-táblánkban, és mégsem párosodott/,
      ),
    ).toBeInTheDocument();
  });

  it("shows a list with no pairing at all without a method breakdown", () => {
    const empty = {
      ...summary().coverage,
      matched: {
        ean: { auto: 0, approved: 0 },
        supplierCode: { auto: 0, approved: 0 },
        name: { auto: 0, approved: 0 },
      },
    };
    render(<CoverageCell coverage={empty} />);
    expect(screen.getByTestId("coverage")).toHaveTextContent("0 párosítva");
    expect(screen.getByTestId("coverage")).not.toHaveTextContent("vonalkód 0");
  });
});
