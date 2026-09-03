import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  Session,
  WorksheetSelectablePartnerListResponse,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobEditorPage } from "./service-job-editor-page";

const api = vi.hoisted(() => ({ create: vi.fn() }));
const sheets = vi.hoisted(() => ({ selectablePartners: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
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

/**
 * A VALASZTO A SZERVIZPARTNEREKET KINALJA, nem a vevoket (Balazs dontese,
 * 2026-09-03). A fixtura ezert a `selectable-partners` valaszanak alakjaban all,
 * es TELJES tipussal: egy `as unknown as` epp azt az egy ellenorzest kapcsolna
 * ki, amiert a varrat letezik.
 */
const partnerList: WorksheetSelectablePartnerListResponse = {
  items: [
    {
      customerId: "vevo-1",
      name: "Fővárosi Állat- És Növénykert",
      partnerCode: "FANK",
    },
  ],
};

describe("ServiceJobEditorPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.create.mockReset().mockResolvedValue({
      id: "job-uj",
      jobNumber: "HJ-2026-009",
    });
    sheets.selectablePartners.mockReset().mockResolvedValue(partnerList);
    navigation.push.mockReset();
  });

  /**
   * A PARTNER ELHAGYHATÓ, és ez a folyamat egyik rendes útja: a jegy egy már
   * meglévő lapból születik, aminek van partnere. Ha itt kötelező lenne, épp
   * azt az utat nehezítenénk, amit az owner leírt.
   */
  it("partner nélkül is megnyitja a jegyet, és a friss lapjára visz", async () => {
    render(<ServiceJobEditorPage />);

    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toEqual({
      title: "A hármas medence szivattyúja nem indul",
      description: null,
      customerId: null,
    });
    // A LISTÁRA VISSZAVINNI ANNYI LENNE, mint a felhasználóra hagyni, hogy
    // megkeresse, amit épp létrehozott.
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/szerviz/hibajegyek/job-uj",
      ),
    );
  });

  /**
   * A KÖVETKEZMÉNY OTT ÁLL A HIÁNY MELLETT. Egy "elhagyható" felirat önmagában
   * elhallgatná, hogy a partner nélküli jegy MA nem tud munkalapot fogadni - és
   * a felhasználó a csatolásnál futna bele, egy másik képernyőn.
   */
  it("kimondja, hogy partner nélkül nem lehet munkalapot csatolni", () => {
    render(<ServiceJobEditorPage />);

    expect(
      screen.getByText(
        /Partner nélkül a jegy megnyílik, de munkalapot csak azután lehet alá csatolni/,
      ),
    ).toBeTruthy();
  });

  /**
   * A VALASZTO A SZERVIZPARTNEREKBOL LISTAZ, es a KERESES INDOKA MEGSZUNT: a
   * vevo-lista lapozott volt, a `selectable-partners` nem az. Ez az allitas
   * NEV SZERINT nevezi meg a regi viselkedest, hogy egy visszalepes ne
   * csendben tortenjen.
   */
  it("a szervizpartnerek listájából választ, keresés nélkül", async () => {
    render(<ServiceJobEditorPage />);

    await waitFor(() =>
      expect(sheets.selectablePartners).toHaveBeenCalledTimes(1),
    );
    const valaszto = await screen.findByLabelText("Partner");
    expect(
      within(valaszto).getByRole("option", {
        name: "Fővárosi Állat- És Növénykert (FANK)",
      }),
    ).toBeTruthy();
  });

  /**
   * A KIVALASZTOTT PARTNER AZONOSITOJA MEGY EL, NEM A NEVE.
   *
   * A testver-kontroll a fenti "partner nelkul is megnyitja" allitas: az
   * `customerId: null` erteket kuldi. A ketto egyutt mondja ki, hogy a mezo
   * TENYLEG a valasztastol fugg, nem mindig ugyanazt kuldi.
   */
  it("a kiválasztott partner azonosítóját küldi el", async () => {
    render(<ServiceJobEditorPage />);
    await waitFor(() =>
      expect(sheets.selectablePartners).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toEqual({
      title: "A hármas medence szivattyúja nem indul",
      description: null,
      customerId: "vevo-1",
    });
  });

  /**
   * URES LISTANAL MONDAT ALL, NEM URES LEGORDULO.
   *
   * Ez ma valos eset: a szerver ot feltetelre szur (szerviz, aktiv, nem torolt,
   * van munkalap-rovidites, van tukor-sor), es egy partner barmelyiken kieshet.
   * Egy ures legordulo ugy nezne ki, mint egy betoltesi hiba -- a mondat
   * megnevezi a FELTETELT, tehat a felhasznalo tudja, mit kell potolni.
   */
  it("üres listánál megnevezi, mitől jelenik meg egy partner", async () => {
    sheets.selectablePartners.mockResolvedValue({ items: [] });
    render(<ServiceJobEditorPage />);

    expect(
      await screen.findByText(/Nincs kiválasztható szervizpartner/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Partner")).toBeNull();
  });

  /**
   * A SZŰKÍTÉST MÉRŐ ÁLLÍTÁS: olvasó jognál a felvitel nem nyílik meg.
   */
  it("olvasó jognál nem enged hibajegyet nyitni", () => {
    auth.session = sessionAs("VIEWER");
    render(<ServiceJobEditorPage />);

    expect(
      screen.getByText("Nincs jogosultságod hibajegyet nyitni"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Mi a baj?")).toBeNull();
  });
});
