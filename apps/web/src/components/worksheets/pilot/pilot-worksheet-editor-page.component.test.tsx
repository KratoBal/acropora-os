import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotWorksheetEditorPage } from "./pilot-worksheet-editor-page";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható. Tranzitíven kerül ide (`pilot-ui.tsx`
 * -> `pilot-font.ts`), ugyanaz a mock, mint a többi pilot komponens tesztjén.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const worksheets = vi.hoisted(() => ({
  detail: vi.fn(),
  updateDraft: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));

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

function detailFixture() {
  return {
    id: "ws-1",
    hidden: false,
    number: null,
    numberYear: null,
    sequence: null,
    customer: {
      id: "customer-1",
      customerNumber: "V-1",
      displayName: "Fankó Kft.",
      worksheetPartnerCode: "FANK",
    },
    department: {
      id: "dep-1",
      code: "BIO",
      name: "Biodóm",
      path: ["Fánk", "Biodóm"],
      isActive: true,
    },
    createdByName: "Szerelő Sándor",
    handedOverAt: null,
    handedOverToName: null,
    continues: null,
    continuedBy: [],
    currentVersion: {
      subject: "Szivattyú csere",
      description: "Zajos lett a szivattyú.",
      issueDate: "2026-09-20",
      fulfillmentDate: "",
      dueDate: "2026-09-30",
      lines: [
        {
          description: "Szivattyú",
          detail: null,
          quantity: "1",
          unit: "db",
          kind: "MATERIAL",
          workerCount: 1,
          unitNet: "15000",
          vatRatePercent: "27",
        },
      ],
    },
  };
}

describe("PilotWorksheetEditorPage", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.push.mockReset();
    worksheets.detail.mockReset().mockResolvedValue(detailFixture());
    worksheets.updateDraft.mockReset().mockResolvedValue({ id: "ws-1" });
  });

  it("service.manage jog nélkül elutasítja a hozzáférést", () => {
    auth.session = null;

    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);

    expect(
      screen.getByText("Nincs jogosultságod munkalapot írni"),
    ).toBeInTheDocument();
    expect(worksheets.detail).not.toHaveBeenCalled();
  });

  it("betöltés után a mai mezőkkel jelenik meg: Partner/Alegység csak-olvasó, a többi szerkeszthető", async () => {
    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);

    expect(await screen.findByText("Fankó Kft.")).toBeInTheDocument();
    expect(screen.getByText("Fánk / Biodóm")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tárgy" })).toHaveValue(
      "Szivattyú csere",
    );
    expect(screen.getByLabelText("Keltezés")).toHaveValue("2026-09-20");
    expect(screen.getByLabelText("Határidő")).toHaveValue("2026-09-30");
    expect(screen.getByRole("textbox", { name: "Megjegyzés" })).toHaveValue(
      "Zajos lett a szivattyú.",
    );
  });

  /**
   * A RÉGI LAPON A FELVITEL-CSAK MEZŐK (Partner-választó, Alegység-választó,
   * új alegység mini-űrlap, Felelősök, eszköz-választó) SZERKESZTÉSKOR SOSEM
   * jelentek meg -- ez a lap ugyanezt tartja: nincs ilyen mező.
   */
  it("nem jelenik meg a partner-választó, az alegység-választó, az új alegység űrlap, a felelős-választó vagy az eszköz-választó", async () => {
    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);
    await screen.findByText("Fankó Kft.");

    expect(screen.queryByLabelText("Partner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Alegység")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Új alegység kódja"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Felelősök")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Mentés után az adatlapon vehetők fel és le/),
    ).toBeInTheDocument();
  });

  it("mentéskor a mai tartalmat küldi, majd az adatlapra navigál", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);

    const subject = await screen.findByRole("textbox", { name: "Tárgy" });
    await user.clear(subject);
    await user.type(subject, "Szivattyú csere és tömítés");

    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(worksheets.updateDraft).toHaveBeenCalledWith(
        "token-1",
        "ws-1",
        expect.objectContaining({
          subject: "Szivattyú csere és tömítés",
          issueDate: "2026-09-20",
          fulfillmentDate: null,
          dueDate: "2026-09-30",
        }),
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/munkalapok/ws-1");
  });

  it("a Mégsem az adatlapra visz mentés nélkül", async () => {
    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);
    await screen.findByText("Fankó Kft.");

    expect(screen.getByRole("link", { name: "Mégsem" })).toHaveAttribute(
      "href",
      "/szerviz/munkalapok/ws-1",
    );
    expect(worksheets.updateDraft).not.toHaveBeenCalled();
  });

  it("üres tárgynál a Mentés le van tiltva", async () => {
    const user = userEvent.setup();
    render(<PilotWorksheetEditorPage worksheetId="ws-1" />);

    const subject = await screen.findByRole("textbox", { name: "Tárgy" });
    await user.clear(subject);

    expect(screen.getByRole("button", { name: "Mentés" })).toBeDisabled();
  });
});
