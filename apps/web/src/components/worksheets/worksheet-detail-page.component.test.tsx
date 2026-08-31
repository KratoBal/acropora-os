import { render, screen } from "@testing-library/react";
import type { Session, WorksheetDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetDetailPage } from "./worksheet-detail-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  close: vi.fn(),
  continueFrom: vi.fn(),
  sign: vi.fn(),
  setAssignees: vi.fn(),
  assignableUsers: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: (fallbackHref: string) => ({
    href: fallbackHref,
    label: "Vissza a listához",
  }),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function detail(inventoryNumber: string | null): WorksheetDetail {
  return {
    id: "worksheet-1",
    number: "BIO-2026-001",
    numberYear: 2026,
    sequence: 1,
    customer: {
      id: "customer-1",
      customerNumber: "VEVO-000001",
      displayName: "Fővárosi Állat- És Növénykert",
      worksheetPartnerCode: "FANK",
    },
    department: {
      id: "department-1",
      parentId: null,
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    createdByName: "Szerelő Sándor",
    assignees: [],
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T08:00:00.000Z",
    continues: null,
    continuedBy: [],
    currentVersion: {
      id: "version-1",
      version: 1,
      label: "BIO-2026-001/1",
      status: "SIGNED",
      changeReason: null,
      createdByName: "Szerelő Sándor",
      createdAt: "2026-08-27T08:00:00.000Z",
      closedAt: "2026-08-27T09:00:00.000Z",
      closedByName: "Szerelő Sándor",
      netAmount: "30000",
      vatAmount: "8100",
      grossAmount: "38100",
      signature: null,
      subject: "Kompresszorok bevizsgálása",
      unitName: "Cápasuli",
      description: null,
      issueDate: "2026-08-27",
      fulfillmentDate: "2026-08-27",
      dueDate: null,
      currency: "HUF",
      lines: [
        {
          id: "line-1",
          position: 1,
          description: "Kompresszor bevizsgálás",
          detail: null,
          assetId: "asset-1",
          assetNumber: "ESZK-000123",
          inventoryNumber,
          quantity: "2",
          unit: "óra",
          unitNet: "15000",
          vatRatePercent: "27",
          netAmount: "30000",
          vatAmount: "8100",
          grossAmount: "38100",
        },
      ],
    },
    versions: [],
  };
}

describe("WorksheetDetailPage és az ügyfél saját kódja a tételsoron", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
    api.assignableUsers.mockResolvedValue({ items: [] });
  });

  /**
   * A TÉTELSOR EDDIG CSAK A MI ESZKÖZSZÁMUNKAT MUTATTA. Az ügyfél a saját
   * kódján hivatkozik a gépre, tehát az aláírásra elé tett lapon annak is ott
   * kell lennie, különben a lap és a bejelentés két külön nyelven beszél.
   */
  it("shows the customer's own code under the asset number", async () => {
    api.detail.mockResolvedValue(detail("LT-4711"));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText("ESZK-000123")).toBeTruthy();
    expect(screen.getByText("LT-4711")).toBeTruthy();
    expect(screen.getByText(/Leltári szám/)).toBeTruthy();
  });

  /**
   * ÉS AMI NINCS, AZ NEM LESZ ÜRES FELIRAT: egy érték nélküli "Leltári szám:"
   * azt állítaná, hogy tudunk róla valamit. A felirat maga viszont kötelező
   * ott, ahol van érték: fölötte a MI eszközszámunk áll, és két csupasz kód
   * egymás alatt pont az a keveredés, ami ellen ez a mező külön nevet kapott.
   */
  it("writes no label at all when the asset has no such code", async () => {
    api.detail.mockResolvedValue(detail(null));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText("ESZK-000123")).toBeTruthy();
    expect(screen.queryByText(/Leltári szám/)).toBeNull();
  });
});
