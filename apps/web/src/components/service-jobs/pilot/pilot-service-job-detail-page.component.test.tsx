import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  commonJobStatus,
  type ServiceJobDetail,
  type ServiceJobDocumentSummary,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KULDES_KIHAGYAS_OKA } from "../handover-mail-skip-reason";
import { answered } from "@/test/answered";
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
  CompletionCertificatePanel: ({
    serviceJobId,
    blockedReason,
    onChanged,
  }: {
    serviceJobId: string;
    blockedReason?: string | null;
    onChanged?: () => void;
  }) => (
    <div data-testid="completion-certificate-panel-stub">
      teljesítési igazolás panel ({serviceJobId})
      <span data-testid="certificate-blocked">
        {blockedReason ?? "nincs ok"}
      </span>
      <button onClick={onChanged}>igazolás változott</button>
    </div>
  ),
}));
// the draft invoice, back on the pilot page (kanban 0baba3b9, acrobot 44712)
vi.mock("../maintenance-invoice-panel", () => ({
  MaintenanceInvoicePanel: ({
    serviceJobId,
    refreshKey,
  }: {
    serviceJobId: string;
    refreshKey?: number;
  }) => (
    <div data-testid="maintenance-invoice-panel-stub">
      számla panel ({serviceJobId})
      <span data-testid="invoice-refresh-key">{refreshKey}</span>
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

// the "Kapcsolódó munkalapok" card (card 5b366f5d) has its own component test; here only WHERE it shows and with which right
vi.mock("./pilot-linked-worksheets-card", () => ({
  PilotLinkedWorksheetsCard: ({
    jobId,
    canManage,
  }: {
    jobId: string;
    canManage: boolean;
  }) => (
    <div data-testid="linked-worksheets-card-stub">
      kapcsolódó munkalapok ({jobId}, {canManage ? "kezelhet" : "csak olvas"})
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
  move: vi.fn(),
  setAssignees: vi.fn(),
  deleteDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadDocumentThumbnail: vi.fn(),
  handoverMailPreview: vi.fn(),
  sendHandoverMail: vi.fn(),
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
// Üzenetek 4. fázis: a „Beszélgetés” gombnak saját tesztje van; itt csak a helye és a tárgya
vi.mock("@/components/messages/context-conversation-button", () => ({
  ContextConversationButton: ({
    kind,
    objectId,
    partner,
  }: {
    kind: string;
    objectId: string;
    partner?: boolean;
  }) => (
    <span
      data-testid="context-conversation-button"
      data-kind={kind}
      data-object={objectId}
      data-partner={partner ? "true" : "false"}
    />
  ),
}));
// the partner picker loads partners itself: a stub, so the partner form can be asserted (only shown on a job without a partner)
vi.mock("../partner-picker", () => ({
  PartnerPicker: () => <div data-testid="partner-picker-stub" />,
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));
// The list's latest query, as the navigation trail would hand it over.
vi.mock("@/components/navigation-history", () => ({
  useListHref: (listPath: string) => `${listPath}?tab=closed&partner=Alfa`,
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));
// the page redirects a job to the route of its kind (maintenance sheet / ticket), so it needs the router
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));

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

/*
  THE SERVER'S COMMON STATUS, BY THE SHARED RULE (card 7f23785c): the fixture computes it the way the server does, from the stored
  status and the linked sheets, unless a test sets it itself. The page only draws it; a test that wants to prove that sets a common
  status the sheets would not give.
*/
function detail(overrides: Partial<ServiceJobDetail> = {}): ServiceJobDetail {
  const base = baseDetail(overrides);
  const state = commonJobStatus(
    base.status,
    base.timeline.flatMap((entry) =>
      entry.kind === "worksheet"
        ? [
            {
              currentVersionStatus: entry.worksheet.status,
              handedOver: entry.worksheet.handedOverAt !== null,
            },
          ]
        : [],
    ),
    base.kind,
  );
  return {
    commonStatus: state.status,
    commonReason: state.reason,
    ...base,
  };
}

function baseDetail(overrides: Partial<ServiceJobDetail>): ServiceJobDetail {
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
    // the transition table since #2898: TRIAGED goes on to the work, a wait, or a failure; never to SCHEDULED
    allowedSteps: ["IN_PROGRESS", "CANCELLED"],
    assets: [],
    assignees: [],
    source: null,
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
    expect(
      screen.getByTestId("maintenance-invoice-panel-stub"),
    ).toHaveTextContent("job-1");
  });

  it("olvasó jogú nézőnek a kártya csak olvasó módban jelenik meg (a levétel és a választó a szerver jogán is áll)", async () => {
    auth.session = sessionAs("VIEWER");
    api.detail.mockResolvedValue(detail({ kind: "MAINTENANCE" }));

    render(<PilotServiceJobDetailPage jobId="job-1" />);

    expect(
      await screen.findByTestId("linked-worksheets-card-stub"),
    ).toHaveTextContent("job-1, csak olvas");
  });

  it("MAINTENANCE jegyen megjelenik a Kapcsolódó munkalapok kártya, a kezelő joggal", async () => {
    api.detail.mockResolvedValue(detail({ kind: "MAINTENANCE" }));

    render(<PilotServiceJobDetailPage jobId="job-1" />);

    expect(
      await screen.findByTestId("linked-worksheets-card-stub"),
    ).toHaveTextContent("job-1, kezelhet");
  });

  /*
    A KÉT PANEL ÖSSZEKÖTÉSE (stage-végigjárás, 2026-11-18): az igazolás panel változása újratölti a számla-kártyát, és a forrás nélküli lap okot ad át a TIG-gombnak. MI PIROSÍT: ha az
    "igazolás változott" jelzés nem változtatja a számla-panel `refreshKey`-ét; ha a forrás nélküli lapnál nem megy át az ok.
  */
  it("az igazolás panel változása a számla-panel refreshKey-ét lépteti, a forrás nélküli lap okot ad át", async () => {
    api.detail.mockResolvedValue(detail({ kind: "MAINTENANCE", source: null }));

    render(<PilotServiceJobDetailPage jobId="job-1" />);

    const key = await screen.findByTestId("invoice-refresh-key");
    expect(key).toHaveTextContent("0");
    expect(screen.getByTestId("certificate-blocked")).toHaveTextContent(
      /nincs megrendelőlapja/,
    );
    fireEvent.click(screen.getByRole("button", { name: "igazolás változott" }));
    expect(screen.getByTestId("invoice-refresh-key")).toHaveTextContent("1");
  });

  /*
    KARBANTARTÁSI FELMÉRÉS S7: a lap forrása az „Az ügy adatai” kártyán; a
    hibajegyen (REPAIR) nincs ilyen sor.
  */
  it("WEB-JOB-SOURCE: a karbantartási lapon a forrás látszik, a hibajegyen nem", async () => {
    api.detail.mockResolvedValue(
      detail({
        kind: "MAINTENANCE",
        source: {
          kind: "CONTRACT",
          contract: { id: "c1", number: "SZ-2026-001", title: "Éves" },
          itemDescriptions: ["Szűrőcsere", "Vízcsere"],
        },
      }),
    );
    const { unmount } = render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(
      await screen.findByText(
        "Szerződésből, megrendelőlap nélkül: SZ-2026-001",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tételek: Szűrőcsere, Vízcsere"),
    ).toBeInTheDocument();
    unmount();

    api.detail.mockResolvedValue(detail({ kind: "REPAIR" }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(screen.queryByText("Forrás")).toBeNull();
  });

  it("a hibajegyen áll a „Beszélgetés” gomb, a jegy azonosítójával", async () => {
    api.detail.mockResolvedValue(detail({ kind: "REPAIR" }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    // a belső „Beszélgetés” és (bd46ff05) a „Beszélgetés a partnerrel”
    const buttons = await screen.findAllByTestId("context-conversation-button");
    expect(buttons.map((b) => b.getAttribute("data-partner"))).toEqual([
      "false",
      "true",
    ]);
    for (const button of buttons) {
      expect(button.getAttribute("data-kind")).toBe("service-job");
      expect(button.getAttribute("data-object")).toBe("job-1");
    }
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
    expect(
      screen.queryByTestId("maintenance-invoice-panel-stub"),
    ).not.toBeInTheDocument();
    // a repair ticket has its own attach box; the link card is for maintenance sheets only
    expect(
      screen.queryByTestId("linked-worksheets-card-stub"),
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

  /*
    BALÁZS KÉRÉSE (2026-09-30): a "Hibajegyek" morzsa a lista legutóbbi
    szűrésére vigyen vissza, ne a szűretlen listára. MI PIROSÍT: ha a link
    megint fix útvonalra mutat.
  */
  it("a Hibajegyek morzsa a lista legutóbbi szűrésére mutat", async () => {
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const crumb = await screen.findByRole("link", { name: "Hibajegyek" });
    expect(crumb.getAttribute("href")).toBe(
      "/szerviz/hibajegyek?tab=closed&partner=Alfa",
    );
  });
});

/**
 * THE SERVICE REDESIGN'S DETAIL (Figma 423:234, Balázs, 2026-10-04): the
 * internal and the partner's status as two badges, the next step drawn only
 * from the server's `allowedSteps`, the linked sheets with their state and
 * hours (E3), and the assignees by name in the case data.
 */
describe("PilotServiceJobDetailPage -- redesign", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset();
    api.documents.mockReset().mockResolvedValue({ items: [] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
  });

  const sheet = {
    kind: "worksheet" as const,
    at: "2026-10-04T09:14:00.000Z",
    sortKey: "ws-1",
    worksheet: {
      id: "ws-1",
      number: "ML-2026-00814",
      subject: "Tömítéscsere",
      createdAt: "2026-10-04T09:14:00.000Z",
      handedOverAt: null,
      status: "DRAFT" as const,
      lineCount: 3,
      laborHours: "2.5",
    },
  };

  it("keeps the internal and the partner's status as two badges", async () => {
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(
      await screen.findByText("Partner: Feldolgozás alatt"),
    ).toBeInTheDocument();
    // the stored TRIAGED reads as the common Folyamatban; the old Felmérve is gone from the header
    expect(screen.getByTestId("job-status")).toHaveTextContent("Folyamatban");
    expect(screen.queryByText("Felmérve")).toBeNull();
  });

  it("draws one button per step the server allows, and no other", async () => {
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const panel = await screen.findByRole("region", {
      name: "Következő lépés",
    });
    const buttons = Array.from(panel.querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    // the labels are verbs (card 7f23785c, picasso point 3), not state names
    expect(buttons).toEqual(["Munka megkezdése", "Meghiúsultnak jelölés"]);
    // f0b70dbd: one primary button, the main step; the others stay, as secondary
    const primary = Array.from(panel.querySelectorAll("button")).map((button) =>
      button.className.includes("bg-pilot-aqua-600"),
    );
    expect(primary).toEqual([true, false]);
  });

  it("says there is no further step when the server allows none", async () => {
    api.detail.mockResolvedValue(
      detail({ status: "COMPLETED", allowedSteps: [] }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const panel = await screen.findByRole("region", {
      name: "Következő lépés",
    });
    expect(panel.querySelectorAll("button")).toHaveLength(0);
    expect(panel.textContent).toContain("nincs több lépése");
  });

  it("does not offer a step to a reader without the manage permission", async () => {
    auth.session = sessionAs("VIEWER");
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(
      await screen.findByText("Negyedéves ellenőrzés"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Következő lépés" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Új munkalap")).not.toBeInTheDocument();
  });

  it("shows each linked sheet with its state and hours", async () => {
    api.detail.mockResolvedValue(detail({ timeline: [sheet] }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(await screen.findByText("ML-2026-00814")).toBeInTheDocument();
    // the sheet's own badge, next to its hours (the job's Folyamatban stands in the header too)
    const hours = screen.getByText("2,5 munkaóra");
    expect(
      within(hours.parentElement!).getByText("Folyamatban"),
    ).toBeInTheDocument();
  });

  /*
    THE SUBJECT IS THE MAIN LINE (the link), THE NUMBER UNDER IT (Balázs,
    2026-10-26, msg 1564259312728150148), as on the worksheet list.
  */
  it("names a linked sheet by its subject, with the number under it", async () => {
    api.detail.mockResolvedValue(
      detail({
        timeline: [
          sheet,
          {
            ...sheet,
            sortKey: "ws-2",
            worksheet: {
              ...sheet.worksheet,
              id: "ws-2",
              number: null,
              subject: "Szűrőcsere",
            },
          },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const link = await screen.findByRole("link", { name: "Tömítéscsere" });
    expect(link.getAttribute("href")).toBe("/szerviz/munkalapok/ws-1");
    expect(link.nextElementSibling?.textContent).toBe("ML-2026-00814");
    const draft = screen.getByRole("link", { name: "Szűrőcsere" });
    expect(draft.nextElementSibling?.textContent).toBe("Még nincs száma");
  });

  /*
    ON A PHONE THE SUBJECT GETS ITS OWN ROW (test OS, 390 px, 2026-11-20): with `flex-1` (a zero basis) the wrapping row never
    wrapped, and a long subject broke letter by letter in a narrow column beside the state, the hours and the detach link.
    jsdom does not lay out, so this pins the classes; the stage measurement at 390 px is the proof.
  */
  it("gives the sheet's subject a full row on a phone, the old shared row from sm up", async () => {
    api.detail.mockResolvedValue(detail({ timeline: [sheet] }));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const cell = (await screen.findByRole("link", { name: "Tömítéscsere" }))
      .parentElement!;
    expect(cell.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "grow", "basis-full", "sm:basis-0"]),
    );
    expect(cell.className.split(/\s+/)).not.toContain("flex-1");
  });

  // AN EMPTY SUBJECT (barracuda, #1891 review): the number is the link, and
  // it does not stand a second time under it.
  it("links an empty-subject sheet by its number, once", async () => {
    api.detail.mockResolvedValue(
      detail({
        timeline: [
          { ...sheet, worksheet: { ...sheet.worksheet, subject: "  " } },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const link = await screen.findByRole("link", { name: "ML-2026-00814" });
    expect(link.nextElementSibling).toBeNull();
    expect(screen.getAllByText("ML-2026-00814")).toHaveLength(1);
  });

  it("names the assignees in the case data, or says nobody is assigned", async () => {
    api.detail.mockResolvedValue(
      detail({
        assignees: [
          {
            userId: "u-1",
            name: "Ádám",
            assignedAt: "2026-10-04T08:00:00.000Z",
            assignedByName: null,
          },
          {
            userId: "u-2",
            name: "Péter",
            assignedAt: "2026-10-04T08:05:00.000Z",
            assignedByName: null,
          },
        ],
      }),
    );
    const { unmount } = render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(await screen.findByText("Ádám, Péter")).toBeInTheDocument();
    unmount();

    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(await screen.findByText("Nincs kiosztva")).toBeInTheDocument();
  });

  it("names who reported the job, from the job's own log", async () => {
    api.detail.mockResolvedValue(
      detail({
        timeline: [
          {
            kind: "status",
            at: "2026-10-04T08:14:00.000Z",
            sortKey: "e-1",
            event: {
              id: "e-1",
              fromStatus: null,
              toStatus: "NEW",
              note: null,
              actorName: "Kovács Anna",
              createdAt: "2026-10-04T08:14:00.000Z",
            },
          },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(
      await screen.findByText(/Bejelentette: Kovács Anna/),
    ).toBeInTheDocument();
  });

  it("shows the partner and report author from the shared API label", async () => {
    api.detail.mockResolvedValue(
      detail({
        reporterPersonName: "Szilveszter Roland",
        reporterName: "Cápasuli (Szilveszter Roland)",
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    expect(
      await screen.findByText(/Bejelentette: Cápasuli \(Szilveszter Roland\)/),
    ).toBeInTheDocument();
  });
  it("opens the location editor from Kezelés", async () => {
    const user = userEvent.setup();
    api.detail.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("Ehhez a jegyhez nincs eszköz rendelve.");
    await user.click(screen.getByRole("button", { name: "Helyszín" }));
    expect(screen.getByTestId("placement-editor-stub")).toBeInTheDocument();
  });
});

/*
  A RÉGI LAPRÓL ÁTHOZOTT ŐRÖK (kanban 0baba3b9, barracuda #2300). A régi `service-job-detail-page.tsx` útvonal nélkül
  állt, és a specje (50 teszt) vele ment. Ezek a ma élő viselkedést mérik az élő lapon: ugyanaz a logika a pilot
  lapon fut (kiküldés és a kihagyás oka, csatolmány-törlés, megtartott megjegyzés, jogkör), a delegálás a
  `PilotDelegatedColleaguesCard`-on. MI PIROSÍT: egy begépelt üzenet egy félrekattintástól elvész; egy `skipped` vagy
  `refused` válasz sikernek látszik, vagy a kihagyás oka helyett egy közös mondat jön; a bukott lépés megjegyzése
  csendben egy másik lépéssel megy el; a csatolmány kérdés nélkül törlődik; a delegálás nem a teljes névsort küldi;
  olvasó jognál feltöltés, törlés vagy delegálás kínálkozik.
*/
function csatolmany(
  overrides: Partial<ServiceJobDocumentSummary> = {},
): ServiceJobDocumentSummary {
  return {
    id: "doc-1",
    type: "OTHER",
    fileName: "jegyzokonyv.pdf",
    contentType: "application/pdf",
    sizeBytes: 204800,
    sha256: "a".repeat(64),
    caption: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("PilotServiceJobDetailPage -- a régi lapról áthozott őrök", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset().mockResolvedValue(detail());
    api.documents.mockReset().mockResolvedValue({ items: [csatolmany()] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    api.move.mockReset().mockResolvedValue({ ok: true });
    api.setAssignees.mockReset();
    api.deleteDocument.mockReset().mockResolvedValue(undefined);
    api.handoverMailPreview.mockReset().mockResolvedValue({
      kind: "send",
      recipients: [
        { name: "Üzemeltető Ubul", email: "uzem@partner.hu" },
        { name: "Műszaki Manó", email: "muszak@partner.hu" },
      ],
      subject: "A KB-2026-001 számú hibajegyet lezártuk.",
    });
    api.sendHandoverMail
      .mockReset()
      .mockResolvedValue({ kind: "sent", recipients: 2 });
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({
      items: [
        { id: "user-sanyi", name: "Sanyi" },
        { id: "user-eva", name: "Éva" },
      ],
    });
  });

  it("a csatolmány törlése ELŐBB kérdez, és csak a megerősítés után hív", async () => {
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Törlés" }));

    expect(await screen.findByText("Törlöd ezt a csatolmányt?")).toBeTruthy();
    expect(api.deleteDocument).not.toHaveBeenCalled();
    expect(
      screen.getByText(/csak úgy kerül vissza, ha újra feltöltöd/),
    ).toBeTruthy();

    const dialogus = screen.getByRole("dialog");
    fireEvent.click(within(dialogus).getByRole("button", { name: "Törlés" }));
    await waitFor(() =>
      expect(api.deleteDocument).toHaveBeenCalledWith(
        "token-1",
        "job-1",
        "doc-1",
      ),
    );
  });

  it("olvasó jogkörnél nincs feltöltés, törlés és delegálás, a delegáltak kártyája viszont látszik", async () => {
    auth.session = sessionAs("VIEWER");
    render(<PilotServiceJobDetailPage jobId="job-1" />);

    expect(await screen.findByText("jegyzokonyv.pdf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    expect(screen.queryByText("+ fotó")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Felelős kiosztása/ }),
    ).toBeNull();
    // the card is still there (its title is the one "Felelős" label, the data row beside it is the other)
    expect(screen.getAllByText("Felelős").length).toBeGreaterThanOrEqual(2);
  });

  it("a delegálás a TELJES névsort küldi: a meglévő delegált is megy az új mellett", async () => {
    // a jegyen már áll valaki: csak így különbözik a teljes névsor a változástól (barracuda, #2300)
    api.detail.mockResolvedValue(
      detail({
        assignees: [
          {
            userId: "user-sanyi",
            name: "Sanyi",
            assignedAt: "2026-09-13T08:00:00.000Z",
          },
        ],
      }),
    );
    api.setAssignees.mockResolvedValue(
      detail({
        assignees: [
          {
            userId: "user-eva",
            name: "Éva",
            assignedAt: "2026-09-14T18:00:00.000Z",
          },
        ],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /Felelős kiosztása/ }))[0]!,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Éva/ }));
    fireEvent.click(screen.getByRole("button", { name: "Felelős mentése" }));

    await waitFor(() =>
      expect(api.setAssignees).toHaveBeenCalledWith("token-1", "job-1", {
        userIds: ["user-sanyi", "user-eva"],
      }),
    );
  });

  /*
    A GÉPI FIÓK, AMELY MÁR A JEGYEN ÁLL, DE A LISTÁN NEM SZEREPEL (card b2e74712). MI PIROSÍT: ha a címkéje a nyers azonosítót írja; ha a mentés
    elhagyja (a lista nem kínálja, de a rá kiosztott sor marad, és a szerver is megtartja).
  */
  it("a listán nem szereplő, már kiosztott gépi fiók a nevét mutatja a címkén, és a mentés megtartja", async () => {
    api.detail.mockResolvedValue(
      detail({
        assignees: [
          {
            userId: "user-bot",
            name: "Acro Bot",
            assignedAt: "2026-09-13T08:00:00.000Z",
          },
        ],
      }),
    );
    api.setAssignees.mockResolvedValue(detail());
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /Felelős kiosztása/ }))[0]!,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Éva/ }));
    expect(screen.getByRole("button", { name: /Acro Bot\s*×/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("user-bot");
    fireEvent.click(screen.getByRole("button", { name: "Felelős mentése" }));
    await waitFor(() =>
      expect(api.setAssignees).toHaveBeenCalledWith("token-1", "job-1", {
        userIds: ["user-bot", "user-eva"],
      }),
    );
  });

  it("a bukott lépés megjegyzésével MÁSIK lépésre megáll, és NEM küld el semmit", async () => {
    api.move.mockRejectedValueOnce(new Error("A hálózat nem elérhető."));
    render(<PilotServiceJobDetailPage jobId="job-1" />);

    fireEvent.change(await screen.findByLabelText("Megjegyzés a lépéshez"), {
      target: { value: "Szivattyú rendelve" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Munka megkezdése" }));
    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    // the step buttons are off while the first move runs: the second click comes after its (failed) answer
    await answered(api.move);

    // the failure is an end state: it asks first, and the note check runs on the confirmed step
    fireEvent.click(
      screen.getByRole("button", { name: "Meghiúsultnak jelölés" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Meghiúsultnak jelölés",
      }),
    );

    expect(await screen.findByText(/lépéshez készült/)).toBeTruthy();
    expect(api.move).toHaveBeenCalledTimes(1);
  });

  describe("a lezárt hibajegy kiküldése", () => {
    async function ablakotNyit() {
      api.detail.mockResolvedValue(
        detail({
          status: "COMPLETED",
          partnerStatus: "COMPLETED",
          partnerStatusLabel: "Elkészült",
          allowedSteps: [],
        }),
      );
      render(<PilotServiceJobDetailPage jobId="job-1" />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Küldés e-mailben" }),
      );
      const ablak = await screen.findByRole("dialog", {
        name: "A KB-2026-001 számú hibajegy kiküldése",
      });
      await waitFor(() =>
        expect(within(ablak).getByLabelText("Üzenet")).toBeTruthy(),
      );
      return ablak;
    }
    const kuld = (ablak: HTMLElement) => {
      fireEvent.change(within(ablak).getByLabelText("Üzenet"), {
        target: { value: "Köszönjük." },
      });
      fireEvent.click(
        within(ablak).getByRole("button", { name: "Elküldés 2 címzettnek" }),
      );
    };

    it("a refused válasznál a szerver mondata jelenik meg, nem siker", async () => {
      api.sendHandoverMail.mockResolvedValue({
        kind: "refused",
        message: "A dokumentumcsomag 5,2 MB, a határ 4 MB.",
      });
      const ablak = await ablakotNyit();
      kuld(ablak);
      expect(
        await within(ablak).findByText(
          "A dokumentumcsomag 5,2 MB, a határ 4 MB.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/A hibajegy kiküldve/)).toBeNull();
    });

    it("a skipped választ NEM sikerként mutatja, és az ablak nyitva marad", async () => {
      api.sendHandoverMail.mockResolvedValue({
        kind: "skipped",
        reason: "no-recipient",
      });
      const ablak = await ablakotNyit();
      kuld(ablak);
      expect(
        await within(ablak).findByText("A kiküldés nem sikerült"),
      ).toBeTruthy();
      expect(screen.queryByText(/A hibajegy kiküldve/)).toBeNull();
      expect(within(ablak).getByLabelText("Üzenet")).toBeTruthy();
    });

    it("a küldés kihagyásának OKA jut el a kezelőhöz, nem egy közös mondat", async () => {
      api.sendHandoverMail.mockResolvedValue({
        kind: "skipped",
        reason: "no-sender",
      });
      const ablak = await ablakotNyit();
      kuld(ablak);
      expect(
        await within(ablak).findByText(KULDES_KIHAGYAS_OKA["no-sender"]),
      ).toBeTruthy();
    });

    it("begépelt üzenet mellett a háttérre kattintás NEM zárja be, üres mellett bezárja", async () => {
      const ablak = await ablakotNyit();
      fireEvent.change(within(ablak).getByLabelText("Üzenet"), {
        target: { value: "Köszönjük a bizalmat." },
      });
      fireEvent.click(ablak.parentElement as HTMLElement);
      expect(
        screen.getByRole("dialog", {
          name: "A KB-2026-001 számú hibajegy kiküldése",
        }),
      ).toBeTruthy();

      fireEvent.change(within(ablak).getByLabelText("Üzenet"), {
        target: { value: "" },
      });
      fireEvent.click(ablak.parentElement as HTMLElement);
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", {
            name: "A KB-2026-001 számú hibajegy kiküldése",
          }),
        ).toBeNull(),
      );
    });
  });
});

/*
  A KARBANTARTÁSI ADATLAP (Balázs és Luca, 2026-11-18, Luca-Balázs-Acrobot szál; acrobot 55781-55783): a szerződésből keletkező
  karbantartási lap NEM hibajegy. Balázs szavai: „a karbantartási lapból megnyílik a munkalap, ha az alá van írva, akkor kész a
  karbantartás, nem kell olyan, mint a hibajegynél, hogy elkészült, ügyfélre vár és egyebek”; a Kezelés blokk (Helyszín, Elrejtés) „ez se
  kell rá”. MI PIROSÍT: ha a karbantartási lapon megjelenik a hibajegy-állapotgép (Következő lépés), a Kezelés blokk, a partner-állapot, a
  csomag-letöltés/e-mail; ha az állapot nem a munkalapok aláírásából jön (minden aláírva = Kész, különben Folyamatban); ha a
  munkalapok nem az első blokk; ha a hibajegy (REPAIR) bármelyiket elveszti; ha egy lap a másik fajta útvonalán marad.
*/
describe("PilotServiceJobDetailPage -- a karbantartási adatlap nem hibajegy", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset();
    api.documents.mockReset().mockResolvedValue({ items: [] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
    nav.replace.mockReset();
  });

  const sheetEntry = (
    id: string,
    status: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED",
  ) => ({
    kind: "worksheet" as const,
    at: "2026-11-18T09:14:00.000Z",
    sortKey: id,
    worksheet: {
      id,
      number: `NMD-${id}`,
      subject: `Tétel ${id}`,
      createdAt: "2026-11-18T09:14:00.000Z",
      handedOverAt: null,
      status,
      lineCount: 1,
      laborHours: "0",
    },
  });
  const maintenance = (
    statuses: Parameters<typeof sheetEntry>[1][],
    over: Partial<ServiceJobDetail> = {},
  ) =>
    detail({
      kind: "MAINTENANCE",
      timeline: statuses.map((status, index) =>
        sheetEntry(`ws-${index + 1}`, status),
      ),
      ...over,
    });

  it("nincs hibajegy-állapotgép, Kezelés blokk, partner-állapot, csomag-letöltés", async () => {
    api.detail.mockResolvedValue(
      maintenance(["DRAFT"], {
        partnerStatus: "COMPLETED",
        status: "TRIAGED",
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(
      screen.queryByRole("region", { name: "Következő lépés" }),
    ).toBeNull();
    expect(screen.queryByText("Kezelés")).toBeNull();
    expect(screen.queryByRole("button", { name: "Elrejtés" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Helyszín" })).toBeNull();
    expect(screen.queryByText("A partner ezt látja")).toBeNull();
    expect(screen.queryByText(/^Partner: /)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Csomag letöltése/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Küldés e-mailben" }),
    ).toBeNull();
    // worksheets come from the contract: no attaching of an existing one, no detaching
    expect(screen.queryByText("Meglévő munkalap csatolása")).toBeNull();
    expect(screen.queryByRole("button", { name: "Leválasztás" })).toBeNull();
    // only the internal conversation: the partner-facing one belonged to the ticket's partner status
    expect(
      screen
        .getAllByTestId("context-conversation-button")
        .map((button) => button.getAttribute("data-partner")),
    ).toEqual(["false"]);
  });

  /*
    A KARBANTARTÁS JELVÉNYE A SZERVER KÖZÖS ÁLLAPOTA (kártya 7f23785c): Lezárt, ha minden munkalap aláírva, és ezt az ok ki is mondja
    (picasso 9. pont); különben Folyamatban. A szabályt a szerver számolja (`commonJobStatus`, a fixtúra is azt hívja); hogy a lap NEM
    számol újra, azt a következő teszt méri.
  */
  it("az állapot a szerver közös állapota: minden aláírva = Lezárt, különben (üresen is) Folyamatban", async () => {
    for (const [statuses, label] of [
      [["SIGNED", "SIGNED"], "Lezártminden munkalap aláírva"],
      [["SIGNED", "AWAITING_SIGNATURE"], "Folyamatban"],
      [["DRAFT"], "Folyamatban"],
      [["REJECTED"], "Folyamatban"],
      [[], "Folyamatban"],
    ] as const) {
      api.detail.mockResolvedValue(maintenance([...statuses]));
      const { unmount } = render(
        <PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />,
      );
      await screen.findByText("Negyedéves ellenőrzés");
      expect(screen.getByTestId("maintenance-status").textContent).toBe(label);
      // the ticket's own state labels are not shown
      expect(screen.queryByText("Szortírozva")).toBeNull();
      unmount();
    }
  });

  // NEGATÍV KONTROLL: minden lap aláírva, a szerver mégis Folyamatbant mond. Ha a lap a lapokból számolna, Lezártat írna.
  it("a jelvény a szerver mezőjét rajzolja, nem a munkalapokból számol", async () => {
    api.detail.mockResolvedValue(
      maintenance(["SIGNED", "SIGNED"], {
        commonStatus: "IN_PROGRESS",
        commonReason: null,
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(screen.getByTestId("maintenance-status").textContent).toBe(
      "Folyamatban",
    );
  });

  it("a karbantartási lap látható szövegében nincs hibajegy-szó (üres leírás, nincs fájl, nincs eszköz, napló)", async () => {
    api.detail.mockResolvedValue(
      maintenance(["SIGNED"], { description: null, assets: [] }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await screen.findByText("Negyedéves ellenőrzés");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/hibajegy/i);
    expect(text).not.toMatch(/bejelent/i);
    expect(text).not.toMatch(/\bjegy/i);
    expect(text).toMatch(/Létrehozta: /);
    expect(text).toMatch(/A karbantartási laphoz nem írtak leírást\./);
  });

  it("a Törlés blokk csak a törlési joggal látszik, hibajegyen és karbantartási lapon is", async () => {
    for (const [role, kind, shown] of [
      ["ADMIN", "MAINTENANCE", true],
      ["ADMIN", "REPAIR", true],
      ["SERVICE", "MAINTENANCE", false],
    ] as const) {
      auth.session = sessionAs(role);
      api.detail.mockResolvedValue(
        kind === "MAINTENANCE" ? maintenance(["DRAFT"]) : detail(),
      );
      const { unmount } = render(
        <PilotServiceJobDetailPage
          jobId="job-1"
          route={kind === "MAINTENANCE" ? "karbantartas" : "hibajegyek"}
        />,
      );
      await screen.findByText("Negyedéves ellenőrzés");
      expect(
        screen.queryByRole("button", { name: "Törlés" }) !== null,
        `${role} ${kind}`,
      ).toBe(shown);
      unmount();
    }
    auth.session = sessionAs("SERVICE");
  });

  it("az átszámozott karbantartási lap a régi HJ-számot is mutatja, a többi csak a sajátját", async () => {
    api.detail.mockResolvedValue(
      maintenance(["SIGNED"], {
        jobNumber: "KT-2026-003",
        previousNumber: "HJ-2026-041",
      }),
    );
    const { unmount } = render(
      <PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />,
    );
    await screen.findByText("Negyedéves ellenőrzés");
    expect(
      screen.getByText("KT-2026-003 (régi szám: HJ-2026-041)"),
    ).toBeTruthy();
    unmount();

    api.detail.mockResolvedValue(
      maintenance(["SIGNED"], { jobNumber: "KT-2026-004" }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(screen.getByText("KT-2026-004")).toBeTruthy();
    expect(screen.queryByText(/régi szám/)).toBeNull();
  });

  it("a szövegek karbantartásiak: vissza a Karbantartás listához, Munkalapok az első blokk", async () => {
    api.detail.mockResolvedValue(maintenance(["SIGNED"]));
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await screen.findByText("Negyedéves ellenőrzés");
    const back = screen.getByRole("link", { name: /Karbantartás/ });
    expect(back.getAttribute("href")).toMatch(/^\/szerviz\/karbantartas\?/);
    expect(screen.queryByText(/Munkalapok a jegy mögött/)).toBeNull();
    const heading = screen.getByText("Munkalapok");
    // the worksheets card leads the left column
    expect(
      heading.closest("section, div[class*='order-first']"),
    ).not.toBeNull();
    expect(screen.queryByText(/hibajegy/i)).toBeNull();
  });

  it("a hibajegy (REPAIR) mindezt megtartja", async () => {
    api.detail.mockResolvedValue(
      detail({
        kind: "REPAIR",
        partnerStatus: "COMPLETED",
        status: "COMPLETED",
        allowedSteps: [],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="hibajegyek" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(
      screen.getByRole("region", { name: "Következő lépés" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Kezelés")).toBeInTheDocument();
    expect(screen.getByText("A partner ezt látja")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Csomag letöltése/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("maintenance-status")).toBeNull();
    expect(screen.getByText("Meglévő munkalap csatolása")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a lap a saját fajtájának útvonalára tér át: karbantartás a hibajegyek útvonalán és fordítva", async () => {
    api.detail.mockResolvedValue(maintenance(["DRAFT"]));
    const first = render(
      <PilotServiceJobDetailPage jobId="job-1" route="hibajegyek" />,
    );
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/szerviz/karbantartas/job-1"),
    );
    // while it redirects, the wrong page's content is not drawn
    expect(screen.queryByText("Negyedéves ellenőrzés")).toBeNull();
    first.unmount();

    nav.replace.mockReset();
    api.detail.mockResolvedValue(detail({ kind: "REPAIR" }));
    render(<PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />);
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/szerviz/hibajegyek/job-1"),
    );
  });

  it("jogosultság nélkül a cím az útvonal szerint szól: a karbantartási lapé nem a hibajegyeké", () => {
    auth.session = null;
    const first = render(
      <PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />,
    );
    expect(
      screen.getByText("Nincs hozzáférésed a karbantartási lapokhoz"),
    ).toBeInTheDocument();
    first.unmount();
    render(<PilotServiceJobDetailPage jobId="job-1" route="hibajegyek" />);
    expect(
      screen.getByText("Nincs hozzáférésed a hibajegyekhez"),
    ).toBeInTheDocument();
  });

  it("partner nélküli karbantartási lapon nincs partner-beállítás (a Kezelés kártya nem áll ott; a szerver elutasítaná), a hibajegyen van", async () => {
    auth.session = sessionAs("ADMIN");
    api.detail.mockResolvedValue(
      maintenance(["DRAFT"], { customerName: null, customerId: null }),
    );
    const first = render(
      <PilotServiceJobDetailPage jobId="job-1" route="karbantartas" />,
    );
    await screen.findByText("Negyedéves ellenőrzés");
    expect(screen.queryByText("Partner beállítása")).toBeNull();
    first.unmount();

    api.detail.mockResolvedValue(
      detail({ kind: "REPAIR", customerName: null, customerId: null }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" route="hibajegyek" />);
    await screen.findByText("Negyedéves ellenőrzés");
    expect(screen.getByText("Partner beállítása")).toBeInTheDocument();
  });
});

/*
  A KÖZÖS ÁLLAPOT AZ ADATLAPON (kártya 7f23785c, 3. szelet; terv 9. pont, picasso 1-3. pont). MI PIROSÍT: ha az Elkészült ok nélkül áll,
  vagy a Lezárás akkor is élő gomb, amikor a közös állapotból biztos, hogy a kapu nem engedi (és nem mondja meg, mi hiányzik); ha a
  munkalap nélküli jegy Lezárását a lap tiltja (a kapu átengedi); ha a Lezárás vagy a Meghiúsultnak jelölés megerősítés nélkül lép, vagy
  a Mégse után mégis lép; ha az ütemezett időpont nem látszik sorként.
*/
describe("PilotServiceJobDetailPage -- a közös állapot és a két végállapot", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset();
    api.move.mockReset().mockResolvedValue({ ok: true });
    api.documents.mockReset().mockResolvedValue({ items: [] });
    api.uploadDocument.mockReset().mockResolvedValue([]);
    sheets.attachable.mockReset().mockResolvedValue({ items: [] });
    sheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
  });

  const sheetEntry = (
    id: string,
    status: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED",
    handedOverAt: string | null = null,
  ) => ({
    kind: "worksheet" as const,
    at: "2026-11-25T09:14:00.000Z",
    sortKey: id,
    worksheet: {
      id,
      number: `ML-${id}`,
      subject: `Tétel ${id}`,
      createdAt: "2026-11-25T09:14:00.000Z",
      handedOverAt,
      status,
      lineCount: 1,
      laborHours: "1",
    },
  });
  const working = (
    sheetsOnJob: ReturnType<typeof sheetEntry>[],
    over: Partial<ServiceJobDetail> = {},
  ) =>
    detail({
      status: "IN_PROGRESS",
      allowedSteps: ["COMPLETED", "WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"],
      timeline: sheetsOnJob,
      ...over,
    });
  const panel = async () =>
    screen.findByRole("region", { name: "Következő lépés" });

  it("az Elkészült mellett az ok áll, a Lezárás halvány, alatta a hiányzó feltétel", async () => {
    api.detail.mockResolvedValue(
      working([
        sheetEntry("1", "AWAITING_SIGNATURE"),
        sheetEntry("2", "SIGNED"),
        sheetEntry("3", "AWAITING_SIGNATURE"),
      ]),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    expect(screen.getByTestId("job-status").textContent).toBe(
      "Elkészültaláírásra vár",
    );
    expect(region.textContent).toContain("Jelenleg: Elkészült · aláírásra vár");
    const close = within(region).getByRole("button", { name: "Lezárás" });
    expect(close).toBeDisabled();
    expect(region.textContent).toContain(
      "Még nem zárható le: 2 munkalap nincs aláírva.",
    );
    // the waits stay usable
    expect(
      within(region).getByRole("button", { name: "Várakoztatás: alkatrészre" }),
    ).not.toBeDisabled();
  });

  it("aláírva, de átadás nélkül: a mondat az átadást nevezi meg", async () => {
    api.detail.mockResolvedValue(
      working([sheetEntry("1", "SIGNED"), sheetEntry("2", "SIGNED")]),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    expect(
      within(region).getByRole("button", { name: "Lezárás" }),
    ).toBeDisabled();
    expect(region.textContent).toContain(
      "Még nem zárható le: 2 munkalap átadása nincs rögzítve.",
    );
  });

  it("befejezetlen munkalappal a Folyamatban jegy Lezárása is halvány", async () => {
    api.detail.mockResolvedValue(
      working([
        sheetEntry("1", "SIGNED", "2026-11-25T10:00:00.000Z"),
        sheetEntry("2", "DRAFT"),
      ]),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    expect(
      within(region).getByRole("button", { name: "Lezárás" }),
    ).toBeDisabled();
    expect(region.textContent).toContain(
      "Még nem zárható le: 1 munkalap még nincs kész.",
    );
  });

  // A KAPU MUNKALAP NÉLKÜL ÁTENGED (worksheet-signature-gate.ts): a lap nem szigoríthat a szerveren túl
  it("munkalap nélkül a Lezárás él, és megerősítés után lép", async () => {
    api.detail.mockResolvedValue(working([]));
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    const close = within(region).getByRole("button", { name: "Lezárás" });
    expect(close).not.toBeDisabled();
    expect(region.textContent).not.toContain("Még nem zárható le");

    fireEvent.click(close);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "A KB-2026-001 hibajegy lezárul, és nem nyitható újra.",
    );
    expect(dialog.textContent).toContain("Ez nem vonható vissza.");
    // asking is not stepping
    expect(api.move).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Lezárás" }));
    await waitFor(() =>
      expect(api.move).toHaveBeenCalledWith("token-1", "job-1", {
        to: "COMPLETED",
        note: null,
      }),
    );
  });

  it("a lezárható Elkészült Lezárása él", async () => {
    api.detail.mockResolvedValue(
      working([sheetEntry("1", "SIGNED", "2026-11-25T10:00:00.000Z")]),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    expect(screen.getByTestId("job-status").textContent).toBe(
      "Elkészültlezárható",
    );
    expect(
      within(region).getByRole("button", { name: "Lezárás" }),
    ).not.toBeDisabled();
  });

  it("a Meghiúsultnak jelölés kérdez, és a Mégse után nem lép", async () => {
    api.detail.mockResolvedValue(
      detail({
        status: "WAITING_FOR_PARTS",
        allowedSteps: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "CANCELLED"],
      }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    const region = await panel();
    expect(
      Array.from(region.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["Folytatás", "Várakoztatás: ügyfélre", "Meghiúsultnak jelölés"]);
    expect(screen.getByTestId("job-status").textContent).toBe(
      "Vár valamirealkatrészre",
    );

    fireEvent.click(
      within(region).getByRole("button", { name: "Meghiúsultnak jelölés" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "A KB-2026-001 hibajegy meghiúsultként lezárul, és nem nyitható újra.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Mégsem" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.move).not.toHaveBeenCalled();
  });

  it("a meghiúsult jegy Lezárt, és az ok mellette áll", async () => {
    api.detail.mockResolvedValue(
      detail({ status: "CANCELLED", allowedSteps: [] }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await panel();
    expect(screen.getByTestId("job-status").textContent).toBe(
      "Lezártmeghiúsult",
    );
  });

  it("az ütemezett időpont sor az ügy adatai között, nem állapot", async () => {
    api.detail.mockResolvedValue(
      detail({ scheduledAt: "2026-11-27T08:00:00.000Z" }),
    );
    render(<PilotServiceJobDetailPage jobId="job-1" />);
    await panel();
    expect(screen.getByText("Ütemezve")).toBeInTheDocument();
    expect(screen.getByTestId("job-status")).not.toHaveTextContent("Ütemezve");
  });
});
