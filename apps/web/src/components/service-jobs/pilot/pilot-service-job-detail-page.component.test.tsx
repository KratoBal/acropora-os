import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServiceJobDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotServiceJobDetailPage } from "./pilot-service-job-detail-page";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Ez a modul csak a `PilotThemeRoot`-on keresztül,
 * TRANZITÍVEN kerül ide (`pilot-ui.tsx` importálja `pilot-font.ts`-ből,
 * ezt pedig a `PilotDelegatedColleaguesCard`) -- lásd ugyanezt a mockot
 * a `pilot-theme-root.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A MAINTENANCE-PANELEK JELENLÉTE -- acrobot javítási kérése (msg 23174,
 * a mai kiadás blokkolója volt).
 *
 * TÉVES FELTEVÉS ÁLLT A LAP FEJLÉCÉBEN: hogy a `/szerviz/hibajegyek/[id]`
 * útvonal csak REPAIR jegyet szolgál ki. NEM IGAZ -- a karbantartás-lista
 * (`service-job-list-page.tsx`, `kind="MAINTENANCE"`) minden sorát erre az
 * útvonalra viszi, mert a `/szerviz/karbantartas/` alatt nincs saját
 * `[id]/page.tsx`. A mai (nem-pilot) lap ezért `job.kind === "MAINTENANCE"`
 * esetén megjeleníti a `CompletionCertificatePanel`-t és a
 * `MaintenancePackagePanel`-t -- ez a spec azt méri, hogy a pilot lap
 * UGYANEZT teszi, mindkét irányban (pozitív: MAINTENANCE mutatja őket;
 * negatív kontroll: REPAIR-nál nincsenek).
 *
 * A KÉT PANEL STUBOLVA VAN: mindkettő saját, önálló API-hívásokat indít
 * (`useAuth`, csatolt lekérdezések) -- ennek a specnek nem a panelek saját
 * viselkedése a tárgya, hanem a FELTÉTELES MEGJELENÍTÉS a szülő lapon. Egy
 * valódi renderelés ezeket is fel kellene készítenie, és az a panelek SAJÁT
 * teszt-felelőssége, nem ezé a lapé.
 */

vi.mock("../completion-certificate-panel", () => ({
  CompletionCertificatePanel: ({ serviceJobId }: { serviceJobId: string }) => (
    <div data-testid="completion-certificate-panel-stub">
      teljesítési igazolás panel ({serviceJobId})
    </div>
  ),
}));
vi.mock("../maintenance-package-panel", () => ({
  MaintenancePackagePanel: ({
    serviceJobId,
    jobNumber,
  }: {
    serviceJobId: string;
    jobNumber: string;
  }) => (
    <div data-testid="maintenance-package-panel-stub">
      karbantartási csomag panel ({serviceJobId}, {jobNumber})
    </div>
  ),
}));

/**
 * A `ServiceJobPlacementEditor` STUBOLVA VAN, UGYANAZZAL AZ OKKAL, MINT A
 * KARBANTARTAS-PANELEK: sajat API-hivasokat indit (helyszin-fa, stb.), es
 * a sajat viselkedese mar meg van merve a sajat specjeben
 * (`service-job-placement-editor.component.test.tsx`, 26 teszt). Ez a
 * spec a "Szerkesztés" hivatkozas MEGJELENITO/ELREJTO mechanizmusat meri,
 * nem az editor belsejet.
 */
vi.mock("../service-job-placement-editor", () => ({
  ServiceJobPlacementEditor: () => (
    <div data-testid="placement-editor-stub">helyszín+eszköz szerkesztő</div>
  ),
}));

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  documents: vi.fn(),
  uploadDocument: vi.fn(),
}));
const sheets = vi.hoisted(() => ({
  attachable: vi.fn(),
  assignableUsers: vi.fn(),
  departments: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-sanyi",
      email: "sanyi@acropora.local",
      displayName: "Szerelő Sándor",
      nickname: "Sanyi",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

function detail(overrides: Partial<ServiceJobDetail> = {}): ServiceJobDetail {
  return {
    id: "job-1",
    jobNumber: "KB-2026-001",
    kind: "REPAIR",
    title: "Negyedéves ellenőrzés",
    description: "Ütemezett karbantartás.",
    status: "TRIAGED",
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName: "Fővárosi Állat- És Növénykert",
    customerId: "cust-1",
    departmentId: null,
    departmentName: null,
    departmentPath: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    allowedSteps: ["SCHEDULED", "CANCELLED"],
    assets: [],
    assignees: [],
    timeline: [],
    hidden: false,
    ...overrides,
  };
}

describe("PilotServiceJobDetailPage -- MAINTENANCE panelek", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset();
    api.documents.mockReset().mockResolvedValue({ items: [] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
  });

  it("MAINTENANCE jegyen megjeleníti mindkét karbantartás-panelt", async () => {
    api.detail.mockResolvedValue(detail({ kind: "MAINTENANCE" }));

    render(<PilotServiceJobDetailPage jobId="job-1" />);

    await waitFor(() => {
      expect(
        screen.getByTestId("completion-certificate-panel-stub"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("maintenance-package-panel-stub"),
    ).toBeInTheDocument();
  });

  /*
    NEGATÍV KONTROLL: REPAIR jegyen egyik panel sem jelenik meg. Enélkül a
    fenti állítás azt is fedhetné, hogy a panelek MINDIG megjelennek,
    függetlenül a `job.kind`-tól.
  */
  it("REPAIR jegyen egyik karbantartás-panel sem jelenik meg", async () => {
    api.detail.mockResolvedValue(detail({ kind: "REPAIR" }));

    render(<PilotServiceJobDetailPage jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByText("Negyedéves ellenőrzés")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("completion-certificate-panel-stub"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("maintenance-package-panel-stub"),
    ).not.toBeInTheDocument();
  });
});

/**
 * FIGMA-IGAZÍTÁS, 2026-09-25 -- a "Mi a baj?" és az "Eszköz" kártya
 * fejléc-hivatkozása, a "+ fotó" feltöltő csempe, és az olvasó Eszköz-
 * összefoglaló. A `ServiceJobFieldsEditor`/`ServiceJobPlacementEditor`
 * saját viselkedését a saját specjeik mérik (lásd a fenti stub
 * fejlécét) -- ez a blokk csak azt méri, amit EZ a lap ad hozzá: a
 * fejléc-hivatkozás nyit/zár, és mi látszik nyitva/zárva állapotban.
 */
describe("PilotServiceJobDetailPage -- Figma-igazítás (Mi a baj?, Eszköz)", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset();
    api.documents.mockReset().mockResolvedValue({ items: [] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
  });

  it("a Szerkesztés hivatkozás megnyitja, majd Bezárás elrejti a bejelentés-szerkesztőt", async () => {
    const user = userEvent.setup();
    api.detail.mockResolvedValue(detail());

    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await waitFor(() =>
      expect(screen.getByText("Ütemezett karbantartás.")).toBeInTheDocument(),
    );

    expect(screen.queryByLabelText("A hibajegy címe")).not.toBeInTheDocument();

    // KETTO VAN A LAPON ("Mi a baj?" es "Eszköz" fejleceben egyarant) --
    // az ELSO a "Mi a baj?"-e, mert az a korabbi kartya a lapon.
    const szerkesztesGombok = screen.getAllByRole("button", {
      name: "Szerkesztés",
    });
    await user.click(szerkesztesGombok[0]!);
    expect(screen.getByLabelText("A hibajegy címe")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bezárás" }));
    expect(screen.queryByLabelText("A hibajegy címe")).not.toBeInTheDocument();
  });

  it("a + fotó csempe felirat nélkül, azonnal feltölt", async () => {
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await waitFor(() =>
      expect(screen.getByText("Ütemezett karbantartás.")).toBeInTheDocument(),
    );

    // NINCS TÖBBÉ KÜLÖN FELIRAT-MEZŐ A FELTÖLTÉS TRIGGERÉN -- lásd a lap
    // saját "A FELIRAT MEZO ELTUNT INNEN" fejlécét.
    expect(
      screen.queryByLabelText("Felirat (elhagyható)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Feltöltés/ }),
    ).not.toBeInTheDocument();

    const file = new File(["kep"], "hiba.jpg", { type: "image/jpeg" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(api.uploadDocument).toHaveBeenCalledWith(
        "token-1",
        "job-1",
        "PHOTO",
        [file],
      ),
    );
  });

  it("KONTROLL: eszköz nélküli jegyen a megszokott üres-szöveg jelenik meg", async () => {
    api.detail.mockResolvedValue(detail({ assets: [] }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);

    expect(
      await screen.findByText("Ehhez a jegyhez nincs eszköz rendelve."),
    ).toBeInTheDocument();
  });

  it("eszközzel rendelkező jegyen név, kód és -- ha van -- kategória is látszik", async () => {
    api.detail.mockResolvedValue(
      detail({
        assets: [
          {
            id: "link-1",
            assetId: "asset-1",
            assetNumber: "AKV-NMD-SKM-01",
            assetName: "Royal Exclusiv Dreambox 200",
            assetCategoryName: "Lehabzó",
            attachedAt: "2026-09-20T08:00:00.000Z",
          },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);

    expect(
      await screen.findByText("Royal Exclusiv Dreambox 200"),
    ).toBeInTheDocument();
    expect(screen.getByText("AKV-NMD-SKM-01")).toBeInTheDocument();
    expect(screen.getByText("Lehabzó")).toBeInTheDocument();
  });

  /**
   * A KATEGÓRIA-SOR NEM JELENIK MEG, HA `assetCategoryName` `null` -- lásd
   * a `ServiceJobAssetLink.assetCategoryName` fejlécét: az eszköznek nem
   * mindig van kategóriája. Kontroll nélkül egy `null`-t szövegként kiíró
   * hiba (pl. "null" a képernyőn) észrevétlen maradna.
   */
  it("KONTROLL: kategória nélküli eszköznél nincs harmadik sor", async () => {
    api.detail.mockResolvedValue(
      detail({
        assets: [
          {
            id: "link-1",
            assetId: "asset-1",
            assetNumber: "AKV-NMD-SKM-01",
            assetName: "Royal Exclusiv Dreambox 200",
            assetCategoryName: null,
            attachedAt: "2026-09-20T08:00:00.000Z",
          },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);

    await screen.findByText("Royal Exclusiv Dreambox 200");
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("az Eszköz kártya Szerkesztés hivatkozása megjeleníti a helyszín+eszköz szerkesztőt", async () => {
    const user = userEvent.setup();
    api.detail.mockResolvedValue(detail({ assets: [] }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("Ehhez a jegyhez nincs eszköz rendelve.");

    expect(
      screen.queryByTestId("placement-editor-stub"),
    ).not.toBeInTheDocument();

    const szerkesztesGombok = screen.getAllByRole("button", {
      name: "Szerkesztés",
    });
    // KETTO VAN: "Mi a baj?" es "Eszköz" fejleceben egyarant -- az UTOLSO
    // az Eszkozé, mert az a kesobbi kartya a lapon.
    await user.click(szerkesztesGombok[szerkesztesGombok.length - 1]!);

    expect(screen.getByTestId("placement-editor-stub")).toBeInTheDocument();
    expect(
      screen.queryByText("Ehhez a jegyhez nincs eszköz rendelve."),
    ).not.toBeInTheDocument();
  });
});
