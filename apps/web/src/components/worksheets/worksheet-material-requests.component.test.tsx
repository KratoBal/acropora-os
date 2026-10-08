import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MaterialRequestDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetMaterialRequests } from "./worksheet-material-requests";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Ez a modul csak a `PilotCard`/`PilotCardHeader`-en
 * keresztül, TRANZITÍVEN kerül ide (`pilot-ui.tsx` importálja
 * `pilot-font.ts`-ből) -- lásd ugyanezt a mockot a
 * `pilot-theme-root.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const api = vi.hoisted(() => ({
  listForWorksheet: vi.fn(),
  create: vi.fn(),
  submit: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/material-requests", () => ({ materialRequestsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function request(
  over: Partial<MaterialRequestDetail> = {},
): MaterialRequestDetail {
  return {
    id: "mr-1",
    worksheetId: "w-1",
    projectId: null,
    status: "OPEN",
    handlerId: null,
    handlerName: null,
    handlerAssignedAt: null,
    orderedAt: null,
    orderedByName: null,
    cancelledAt: null,
    cancelledByName: null,
    note: null,
    neededBy: null,
    priority: null,
    requestedByName: "Szerelő Sándor",
    createdAt: "2026-09-22T20:00:00.000Z",
    submittedAt: "2026-09-22T20:05:00.000Z",
    receivedAt: null,
    receivedByName: null,
    items: [
      {
        id: "item-1",
        name: "40mm könyök",
        quantity: "2",
        unit: "db",
        quantityValue: "2",
        receivedQuantity: null,
        receivedAt: null,
        arrived: false,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  auth.session = session;
  api.listForWorksheet.mockReset();
  api.create.mockReset();
  api.submit.mockReset();
  api.listForWorksheet.mockResolvedValue({ items: [request()] });
});

describe("anyagigénylés a munkalapon, a weben", () => {
  it("a GOMB a formra nyílik, nem áll ott mindig", async () => {
    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    expect(screen.queryByLabelText("Tétel neve")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    expect(screen.getByLabelText("Tétel neve")).toBeTruthy();
  });

  it("aki NEM írhat, gombot sem lát", async () => {
    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite={false} />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    expect(screen.queryByRole("button", { name: "Anyagigénylés" })).toBeNull();
  });

  it("hiányos sorral NEM küld -- a kérés el sem megy", async () => {
    /*
      MI PIROSIT: ha a validacio kihagyna barmelyik mezot. A `create` HIVAS
      HIANYA a lenyeg, nem a hibauzenet szovege.
    */
    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    fireEvent.change(screen.getByLabelText("Tétel neve"), {
      target: { value: "PVC cső" },
    });
    // mennyiseg es egyseg uresen marad
    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));
    await waitFor(() =>
      screen.getByText(/töltsd ki a nevet, a mennyiséget és az egységet/),
    );
    expect(api.create).toHaveBeenCalledTimes(0);
  });

  it("SIKERES küldés: create ÉS submit is lefut, ebben a sorrendben", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN: acrobot kikotese (msg
      22192) szerint a letrehozas es a kuldes KET KULON API-hivas, es a
      felulet ezt EGY felhasznaloi lepesbol inditja. A sorrend szamit: a
      `submit` a `create` VISSZAADOTT azonositojaval megy.
    */
    api.create.mockResolvedValue(request({ id: "mr-uj", status: "DRAFT" }));
    api.submit.mockResolvedValue({
      items: [request({ id: "mr-uj", status: "OPEN" })],
    });

    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    fireEvent.change(screen.getByLabelText("Tétel neve"), {
      target: { value: "PVC cső" },
    });
    fireEvent.change(screen.getByLabelText("Mennyiség"), {
      target: { value: "10 méter" },
    });
    fireEvent.change(screen.getByLabelText("Egység"), {
      target: { value: "db" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("token-1", "w-1", {
        items: [{ name: "PVC cső", quantity: "10 méter", unit: "db" }],
      }),
    );
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith("token-1", "mr-uj"),
    );
    // A forma bezarodik sikeres kuldes utan.
    await waitFor(() =>
      expect(screen.queryByLabelText("Tétel neve")).toBeNull(),
    );
  });

  it("V2: a határidő, a prioritás és a megjegyzés csak kitöltve megy el", async () => {
    // the test above pins the other half: left empty, none of them is sent
    api.create.mockResolvedValue(request({ id: "mr-uj", status: "DRAFT" }));
    api.submit.mockResolvedValue({
      items: [request({ id: "mr-uj", status: "OPEN" })],
    });

    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    fireEvent.change(screen.getByLabelText("Tétel neve"), {
      target: { value: "Kitalált idom" },
    });
    fireEvent.change(screen.getByLabelText("Mennyiség"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Egység"), {
      target: { value: "db" },
    });
    fireEvent.change(screen.getByLabelText("Szükséges"), {
      target: { value: "2026-10-05" },
    });
    fireEvent.change(screen.getByLabelText("Prioritás"), {
      target: { value: "URGENT" },
    });
    fireEvent.change(screen.getByLabelText("Megjegyzés"), {
      target: { value: "  Kitalált megjegyzés  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("token-1", "w-1", {
        items: [{ name: "Kitalált idom", quantity: "4", unit: "db" }],
        note: "Kitalált megjegyzés",
        neededBy: "2026-10-05",
        priority: "URGENT",
      }),
    );
  });

  /**
   * A `submit` VALASZANAK `warning` MEZOJE MEGJELENIK, DE NEM HIBAKENT.
   *
   * Balazs kerese, acrobot dontese a helyerol (2026-09-23): ha a kuldes
   * pillanataban senkinel nincs bejelolve a beerkezes-jelolo kepesseg, a
   * szervizes lassa, hogy TOVABBRA IS sikeres volt a kuldes -- a figyelmeztetes
   * NEM az `error` dobozban all, mert az a kuldes SIKERTELENSEGET jelentene.
   */
  it("a submit `warning` mezője figyelmeztetésként jelenik meg, nem hibaként", async () => {
    api.create.mockResolvedValue(request({ id: "mr-uj", status: "DRAFT" }));
    api.submit.mockResolvedValue({
      items: [request({ id: "mr-uj", status: "OPEN" })],
      warning:
        "Az anyagigény elküldve, de ma senki nem tudja megjelölni, ha beérkezik.",
    });

    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    fireEvent.change(screen.getByLabelText("Tétel neve"), {
      target: { value: "PVC cső" },
    });
    fireEvent.change(screen.getByLabelText("Mennyiség"), {
      target: { value: "10 méter" },
    });
    fireEvent.change(screen.getByLabelText("Egység"), {
      target: { value: "db" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));

    await waitFor(() =>
      expect(
        screen.getByText(/ma senki nem tudja megjelölni/),
      ).toBeInTheDocument(),
    );
    // NEM az `alert` szerepkorben all -- az a hiba-dobozt jelentene.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("HA a submit elhasal a create UTÁN, a lista frissül -- a piszkozat LÁTHATÓ marad", async () => {
    /*
      acrobot kikotese: "ha egy DRAFT igeny sosem kerul elkuldesre, orokre
      ott marad... a szervizes lassa a sajat piszkozatat". Ez az allitas
      azt zarja ki, hogy egy felbeszakadt kuldes UTAN a piszkozat eltunjon
      a kepernyorol.
    */
    api.create.mockResolvedValue(request({ id: "mr-uj", status: "DRAFT" }));
    api.submit.mockRejectedValue(new Error("hálózati hiba"));
    api.listForWorksheet.mockResolvedValueOnce({ items: [request()] });

    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    fireEvent.click(screen.getByRole("button", { name: "Anyagigénylés" }));
    fireEvent.change(screen.getByLabelText("Tétel neve"), {
      target: { value: "PVC cső" },
    });
    fireEvent.change(screen.getByLabelText("Mennyiség"), {
      target: { value: "10 méter" },
    });
    fireEvent.change(screen.getByLabelText("Egység"), {
      target: { value: "db" },
    });
    // A masodik `listForWorksheet` hivas mar a piszkozatot is hozza.
    api.listForWorksheet.mockResolvedValueOnce({
      items: [request(), request({ id: "mr-uj", status: "DRAFT" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));

    await waitFor(() => screen.getByText("hálózati hiba"));
    await waitFor(() => expect(api.listForWorksheet).toHaveBeenCalledTimes(2));
  });

  it("egy DRAFT sorhoz Küldés gomb tartozik, ami újra próbálja a submitot", async () => {
    api.listForWorksheet.mockResolvedValue({
      items: [request({ id: "mr-draft", status: "DRAFT" })],
    });
    api.submit.mockResolvedValue({
      items: [request({ id: "mr-draft", status: "OPEN" })],
    });

    render(<WorksheetMaterialRequests worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/40mm könyök/));
    expect(screen.getByText("Piszkozat")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Küldés" }));
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith("token-1", "mr-draft"),
    );
  });
});
