import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  OperationsReportResponse,
  Permission,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationsReportPage } from "./operations-report-page";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ HAVI KIMUTATÁSA (task os-uzemeltetesi-naplo, S4b). MI PIROSIT: ha a jog nélküli felhasználó látná; ha
 * helyszín nélkül is lekérdezne (a kérés hatókör nélkül 400); ha a partner váltása a régi helyszínt megtartaná (idegen partner
 * helyszínével kérdezne); ha az összesítő, a vízóra-különbség, a rendellenesség és a hibajegy, a kimaradt időszak nem látszana; ha
 * a PDF-letöltés nem a kiválasztott hónapra és helyszínre kérne; ha a hiba után nem lenne újrapróbálás.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/szerviz/uzemeltetesi-naplo",
}));

const query = vi.hoisted(() => ({
  params: new URLSearchParams(),
  update: vi.fn(),
}));
vi.mock("@/lib/navigation/use-url-query", () => ({
  useUrlQuery: () => ({ params: query.params, update: query.update }),
}));

const api = vi.hoisted(() => ({ report: vi.fn(), reportPdf: vi.fn() }));
vi.mock("@/lib/api/operations-log", () => ({ operationsLogApi: api }));
const sheets = vi.hoisted(() => ({ departments: vi.fn() }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));
vi.mock("@/components/service-jobs/partner-picker", () => ({
  PartnerPicker: (props: {
    value?: string;
    onPick: (partner: { customerId: string; name: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.onPick({ customerId: "c2", name: "Másik partner" })}
    >
      partner:{props.value ?? ""}
    </button>
  ),
}));

const auth = vi.hoisted(() => ({
  role: "SERVICE" as UserRole,
  permissions: undefined as Permission[] | undefined,
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
        displayName: "Béla",
        role: auth.role,
        ...(auth.permissions ? { permissions: auth.permissions } : {}),
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const REPORT: OperationsReportResponse = {
  siteLabel: "Állatkert · Biodóm",
  departmentId: "d0",
  assetId: null,
  generatedAt: "2026-11-20T09:00:00.000Z",
  report: {
    month: "2026-11",
    monthStart: "2026-10-31T23:00:00.000Z",
    monthEnd: "2026-11-30T23:00:00.000Z",
    audience: "INTERNAL",
    totals: { entries: 2, totalMinutes: 55, anomalies: 1, missed: 2 },
    assets: [
      {
        assetId: "a1",
        assetLabel: "E-1 Homokszűrő",
        totalMinutes: 55,
        meterTotal: 12.5,
        meterUnit: "m3",
        anomalies: 1,
        entries: [
          {
            id: "e1",
            startedAt: "2026-11-12T09:00:00.000Z",
            templateName: "Visszamosás",
            frequency: "WEEKLY",
            assetId: "a1",
            minutes: 25,
            meterBefore: 100,
            meterAfter: 112.5,
            meterDifference: 12.5,
            meterUnit: "m3",
            meterSuspicious: false,
            performers: ["Kovács Béla", "Őri Ágnes"],
            values: [
              { label: "pH", unit: null, value: 7.8 },
              { label: "Szűrő rendben", unit: null, value: true },
            ],
            anomaly: true,
            anomalyNote: "Szivárog a szelep",
            ticket: { id: "sj1", jobNumber: "HJ-2026-0042", status: "NEW" },
          },
          {
            id: "e2",
            startedAt: "2026-11-19T09:00:00.000Z",
            templateName: "Visszamosás",
            frequency: "WEEKLY",
            assetId: "a1",
            minutes: 30,
            meterBefore: null,
            meterAfter: null,
            meterDifference: null,
            meterUnit: null,
            meterSuspicious: false,
            performers: ["Kovács Béla"],
            values: [],
            anomaly: false,
            anomalyNote: null,
            ticket: null,
          },
        ],
      },
    ],
    missed: [
      {
        assetId: "a1",
        assetLabel: "E-1 Homokszűrő",
        templateId: "t1",
        templateName: "Visszamosás",
        frequency: "WEEKLY",
        periods: ["2026-11-02"],
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SERVICE";
  auth.permissions = undefined;
  query.params = new URLSearchParams("month=2026-11");
  api.report.mockResolvedValue(REPORT);
  api.reportPdf.mockResolvedValue({
    blob: new Blob(["%PDF"]),
    fileName: "uzemeltetesi-naplo-2026-11.pdf",
  });
  sheets.departments.mockResolvedValue({
    items: [
      { id: "d0", parentId: null, code: "BIO", name: "Biodóm" },
      { id: "d1", parentId: "d0", code: "NAGY", name: "Nagy főmedence" },
    ],
  });
});

describe("az üzemeltetési napló havi kimutatása", () => {
  it("jog nélkül nem látszik, és nem kérdez le semmit", () => {
    auth.role = "VIEWER";
    render(<OperationsReportPage />);
    expect(
      screen.getByText("Nincs hozzáférésed az üzemeltetési naplóhoz"),
    ).toBeTruthy();
    expect(api.report).not.toHaveBeenCalled();
  });

  it("a partner választó ugyanolyan magas, mint a helyszín mezője (a felirata egy vonalban áll a másik kettőével)", () => {
    // MI PIROSIT: ha a partner választó a saját (alacsonyabb) magasságán maradna, a sor `items-end` miatt az alja egy vonalon áll, a felirata
    // viszont ~8 px-szel lejjebb: ezt mérte a stage 1440 px-es képe
    render(<OperationsReportPage />);
    const partnerBox = screen.getByText(/^partner:/)
      .parentElement as HTMLElement;
    const siteSelect = screen
      .getByLabelText("Helyszín")
      .closest("[class*='[&_select]:h-10']") as HTMLElement | null;
    expect(partnerBox.className).toContain("[&_select]:h-10");
    // KONTROLL: a helyszín mezője ugyanezt a magasságot hordozza, tehát a kettő egyezése a mérés, nem a véletlen
    expect(siteSelect).not.toBeNull();
  });

  it("helyszín nélkül kiírja, mit válassz, és nem kér kimutatást", async () => {
    render(<OperationsReportPage />);
    expect(
      screen.getByText("Válassz partnert és helyszínt a kimutatáshoz"),
    ).toBeTruthy();
    expect(api.report).not.toHaveBeenCalled();
    expect(
      (screen.getByText("PDF letöltése").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("a partner helyszíneit fa-címkével kínálja, és a partner váltása törli a helyszínt", async () => {
    query.params = new URLSearchParams("partnerId=c1&month=2026-11");
    render(<OperationsReportPage />);
    await waitFor(() =>
      expect(sheets.departments).toHaveBeenCalledWith(
        "token-1",
        "c1",
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Biodóm / Nagy főmedence")).toBeTruthy();
    fireEvent.click(screen.getByText("partner:c1"));
    expect(query.update).toHaveBeenCalledWith({
      partnerId: "c2",
      departmentId: null,
    });
  });

  it("a kiválasztott helyszín és hónap szerint kérdez, és megmutatja az összesítőt, a sorokat, a vízóra-különbséget, a jegyet és a kimaradást", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d0&month=2026-11",
    );
    render(<OperationsReportPage />);
    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith(
        "token-1",
        { month: "2026-11", departmentId: "d0" },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Elvégzett feladat")).toBeTruthy();
    expect(screen.getByText("55 perc")).toBeTruthy();
    expect(screen.getAllByText("E-1 Homokszűrő").length).toBeGreaterThan(0);
    expect(screen.getByText("különbség: +12,5 m3")).toBeTruthy();
    expect(screen.getByText(/előtte: 100 m3/)).toBeTruthy();
    expect(screen.getByText("Kovács Béla, Őri Ágnes")).toBeTruthy();
    expect(screen.getByText("pH: 7,8")).toBeTruthy();
    expect(screen.getByText("Szűrő rendben: igen")).toBeTruthy();
    expect(screen.getByText("Szivárog a szelep")).toBeTruthy();
    expect(screen.getByText("Hibajegy: HJ-2026-0042")).toBeTruthy();
    expect(screen.getByText("Kimaradt ütemezett feladatok")).toBeTruthy();
    expect(screen.getByText(/11\.02\.–11\.08\./)).toBeTruthy();
  });

  it("üres hónapnál kimondja, hogy nincs bejegyzés", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d0&month=2026-09",
    );
    api.report.mockResolvedValue({
      ...REPORT,
      report: {
        ...REPORT.report,
        month: "2026-09",
        totals: { entries: 0, totalMinutes: 0, anomalies: 0, missed: 0 },
        assets: [],
        missed: [],
      },
    });
    render(<OperationsReportPage />);
    expect(
      await screen.findByText("Ebben a hónapban nincs rögzített bejegyzés"),
    ).toBeTruthy();
  });

  it("a PDF-letöltés a kiválasztott hónapra és helyszínre kér, és fájlt ment", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d0&month=2026-11",
    );
    const createUrl = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<OperationsReportPage />);
    await screen.findByText("Elvégzett feladat");
    fireEvent.click(screen.getByText("PDF letöltése"));
    await waitFor(() =>
      expect(api.reportPdf).toHaveBeenCalledWith("token-1", {
        month: "2026-11",
        departmentId: "d0",
      }),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalled();
    click.mockRestore();
  });

  it("a hibát megmutatja, és az újrapróbálás újra kér", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d0&month=2026-11",
    );
    api.report.mockRejectedValueOnce(new Error("A helyszín nem található."));
    render(<OperationsReportPage />);
    expect(await screen.findByText("A helyszín nem található.")).toBeTruthy();
    fireEvent.click(screen.getByText("Újrapróbálás"));
    expect(await screen.findByText("Elvégzett feladat")).toBeTruthy();
    expect(api.report).toHaveBeenCalledTimes(2);
  });

  it("a más helyszínre vagy hónapra készült kimutatás nem látszik, és a PDF-gomb tiltva marad", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d1&month=2026-11",
    );
    // a válasz a d0 helyszínre készült, a kiválasztott a d1: az előző kimutatás nem maradhat a képernyőn
    api.report.mockResolvedValue(REPORT);
    render(<OperationsReportPage />);
    await waitFor(() => expect(api.report).toHaveBeenCalled());
    expect(screen.queryByText("Elvégzett feladat")).toBeNull();
    expect(
      (screen.getByText("PDF letöltése").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("a letöltés az objektum-URL-t nem vonja vissza azonnal", async () => {
    query.params = new URLSearchParams(
      "partnerId=c1&departmentId=d0&month=2026-11",
    );
    const revoke = vi.fn();
    Object.assign(URL, {
      createObjectURL: () => "blob:x",
      revokeObjectURL: revoke,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<OperationsReportPage />);
    await screen.findByText("Elvégzett feladat");
    fireEvent.click(screen.getByText("PDF letöltése"));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(revoke).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
