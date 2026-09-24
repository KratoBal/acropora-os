import { render, screen, waitFor } from "@testing-library/react";
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

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  documents: vi.fn(),
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
