import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserVisibleUnits } from "./user-visible-units";

const jobs = vi.hoisted(() => ({
  visibilityAssignments: vi.fn(),
  selectableUnits: vi.fn(),
  assignUnit: vi.fn(),
  unassignUnit: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: jobs }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "owner@acropora.local",
      displayName: "Tulaj Tibor",
      nickname: null,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

/**
 * A LISTAN BELUL KERESUNK, NEM A LAPON.
 *
 * A hozzarendelt alegyseg neve KETSZER is szerepelhet a kepernyon: a listaban
 * es -- ha a szures elromlik -- a valasztoban is. Egy `screen.findByText` ilyenkor
 * KETERTELMU lesz es HIBAT dob, tehat MINDEN allitas pirosodna, nem csak az, ami
 * a szurest meri. Merve: a szures kikapcsolasa igy hat allitast dontott pirosra
 * harom helyett -- vagyis a keszlet nem kulonboztetett.
 */
async function listaSora(nev: string) {
  const lista = await screen.findByLabelText("Látható alegységek");
  return within(lista).getByText(nev);
}

describe("UserVisibleUnits", () => {
  beforeEach(() => {
    auth.session = sessionAs("OWNER");
    jobs.visibilityAssignments.mockReset().mockResolvedValue([
      {
        departmentId: "u1",
        createdAt: "2026-09-01T08:00:00.000Z",
        department: { name: "Biotóp", code: "BIO" },
      },
    ]);
    jobs.selectableUnits.mockReset().mockResolvedValue({
      items: [
        { id: "u1", name: "Biotóp", code: "BIO", parentId: null },
        { id: "u2", name: "Pingvin", code: "PPU", parentId: null },
      ],
    });
    jobs.assignUnit.mockReset().mockResolvedValue({ departmentId: "u2" });
    jobs.unassignUnit.mockReset().mockResolvedValue({ ok: true });
  });

  it("kilistázza a hozzárendelt alegységeket", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );

    expect(await listaSora("BIO - Biotóp")).toBeTruthy();
  });

  /**
   * A MAR HOZZARENDELT ALEGYSEG NEM KINALODIK FEL UJRA.
   *
   * A szerver a duplikatumot HIBAVAL utasitja el (szandekosan, mert aki ketszer
   * rendeli hozza ugyanazt, valoszinuleg mast akart) -- a felulet ezert ki sem
   * kinalja. Ket allitas: a szabad alegyseg OTT VAN, a mar hozzarendelt NINCS.
   * Az elso nelkul a masodik akkor is zold lenne, ha a legordulo URES.
   */
  it("csak a még nem hozzárendelt alegységeket kínálja", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );
    const valaszto = await screen.findByLabelText("Alegység hozzáadása");

    expect(screen.getByRole("option", { name: "PPU - Pingvin" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "BIO - Biotóp" })).toBeNull();
    expect(valaszto).toBeTruthy();
  });

  /**
   * A JOG A SZAKASZE, NEM A LAPE.
   *
   * A felhasznalo-lap `users.manage` alatt all, ez a szakasz
   * `service.visibility.assign` alatt. Ma a ket halmaz egybeesik, de nem
   * ugyanaz a szabaly -- a MANAGER szerep epp az a bemenet, ahol a ketto
   * elvalik: `users.manage` nelkul van, `service.visibility.assign` nelkul is.
   */
  it("a jogosultság nélküli nézőnek meg sem jelenik, és nem is kérdez", () => {
    auth.session = sessionAs("MANAGER");
    const { container } = render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );

    expect(container.textContent).toBe("");
    expect(jobs.visibilityAssignments).not.toHaveBeenCalled();
  });

  it("hozzáad egy alegységet, és utána újratölt", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );
    await listaSora("BIO - Biotóp");
    expect(jobs.visibilityAssignments).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Alegység hozzáadása"), {
      target: { value: "u2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hozzáadás" }));

    await waitFor(() => expect(jobs.assignUnit).toHaveBeenCalledTimes(1));
    expect(jobs.assignUnit.mock.calls[0]?.[1]).toBe("target-1");
    expect(jobs.assignUnit.mock.calls[0]?.[2]).toBe("u2");
    await waitFor(() =>
      expect(jobs.visibilityAssignments).toHaveBeenCalledTimes(2),
    );
  });

  /**
   * A LEVETEL KERDEZ, ES A KERDES ELOTT NEM TORTENIK SEMMI.
   *
   * KET MERES: a kerdes megjelenik, ES a hivas NEM megy el. Egy orzot nem az
   * bizonyit, hogy szol, hanem hogy nem tortent semmi -- itt a "semmi" azt
   * jelenti, hogy a fiok latokore nem szukult.
   */
  it("levétel előtt kérdez, és addig nem hív", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );
    await listaSora("BIO - Biotóp");

    fireEvent.click(screen.getByRole("button", { name: "Levétel" }));

    expect(
      await screen.findByText("Leveszed ezt az alegységet a fiókról?"),
    ).toBeTruthy();
    expect(jobs.unassignUnit).not.toHaveBeenCalled();
  });

  /**
   * A KERDES MEGMONDJA A VISSZAUTAT. A levetel visszafordithato -- egy kerdes,
   * ami ezt elhallgatja, ugyanugy megijeszt egy artalmatlan lepesnel, mint egy
   * veglegesnel.
   */
  it("a kérdés kimondja, hogy visszatehető", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );
    await listaSora("BIO - Biotóp");

    fireEvent.click(screen.getByRole("button", { name: "Levétel" }));

    expect(await screen.findByText(/Visszatehető/)).toBeTruthy();
  });

  /**
   * A SZERVER MONDATA MEGY KI, NEM EGY SAJAT.
   *
   * A harom elutasitas harom KULONBOZO teendot ad (nem partner-fiok, nincs
   * tukor-sor, masik partner alegysege). Egy kozos "nem sikerult" mindharmat
   * elrejtene, es a kezelo nem tudna, mit javitson.
   */
  it("a szerver elutasítását szó szerint mutatja", async () => {
    jobs.assignUnit.mockRejectedValue(
      new Error("Ez az alegység másik partnerhez tartozik."),
    );
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );
    await listaSora("BIO - Biotóp");

    fireEvent.change(screen.getByLabelText("Alegység hozzáadása"), {
      target: { value: "u2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hozzáadás" }));

    expect(
      await screen.findByText("Ez az alegység másik partnerhez tartozik."),
    ).toBeTruthy();
  });

  /**
   * A BETOLTESI HIBA NEM URES LISTA.
   *
   * Egy sikertelen lekerdezes ures tombre esve azt mondana, hogy ennek a
   * fioknak nincs hozzarendelese -- es aki ezt latja, nyugodtan adna neki egy
   * ujat, holott lehet, hogy mar van. Ugyanaz a nema alak, amit ma a
   * matricak-lapon es a keszlet-kimenosoron is megtalaltunk.
   */
  it("betöltési hibánál nem az üres állapotot mutatja", async () => {
    jobs.visibilityAssignments.mockRejectedValue(
      new Error("A szerver nem válaszol."),
    );
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );

    expect(await screen.findByText("Nem tölthető be")).toBeTruthy();
    expect(screen.queryByText("Nincs hozzárendelt alegység")).toBeNull();
  });

  /**
   * TESTVER-KONTROLL: A VALODI URES ALLAPOT MAS MONDATOT KAP, es a valaszto
   * uressegehez ODAIRJA A FELTETELT. Tobbfele, RENDES ok adhat ures listat, es a
   * mondat ezert nem hibat allit, hanem megmondja, mitol jelenne meg alegyseg.
   *
   * A FELTETEL SZOVEGE 2026-09-17 OTA A FIOK ALAKJATOL FUGG (lasd a lenti
   * szakaszt); ez az allitas azt meri, hogy a mondat OTT VAN es nem hibat
   * mond -- a HAROM alak kulonbsegét a masik szakasz meri.
   */
  it("üres listánál a feltételt mondja ki, nem hibát", async () => {
    jobs.visibilityAssignments.mockResolvedValue([]);
    jobs.selectableUnits.mockResolvedValue({ items: [] });
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );

    expect(await screen.findByText("Nincs hozzárendelt alegység")).toBeTruthy();
    expect(
      screen.getByText(/Alegység akkor jelenik meg itt, ha a fiók szerviz/),
    ).toBeTruthy();
    expect(screen.queryByText("Nem tölthető be")).toBeNull();
  });
});

/**
 * AZ URES VALASZTO MONDATA A FIOK ALAKJAHOZ BESZELJEN.
 *
 * A MERT AKADALY (2026-09-17, Balazs eles partner-bevezetese): a szoveg MINDIG
 * a szallitos lancot sorolta fel -- szerviz partner, tukor-vevo sor, aktiv
 * alegyseg --, holott a mai partner-fiokok TOBBSEGE vevohoz kotott. Annak a
 * tulajdonosa harom olyan feltetelt olvasott, amibol EGY SEM rola szolt.
 *
 * Szo szerint ezt valtotta ki: "miert kellenek ezek a baromsagok hogy tukor
 * vevo meg mit tudom en".
 */
describe("UserVisibleUnits: az üres választó mondata", () => {
  beforeEach(() => {
    auth.session = sessionAs("OWNER");
    jobs.visibilityAssignments.mockReset().mockResolvedValue([]);
    jobs.selectableUnits.mockReset().mockResolvedValue({ items: [] });
  });

  it("vevőhöz kötött fióknál a saját vevőjéről beszél, nem tükör-vevőről", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="customer" />,
    );

    const mondat = await screen.findByText(/nincs választható alegység/);
    expect(mondat.textContent).toContain("a fiók vevője alatt");
    // MI PIROSIT: a regi, mindenre egyforma szoveg. A "tukor-vevo" egy vevohoz
    // kotott fioknal ertelmetlen szo.
    expect(mondat.textContent).not.toContain("tükör-vevő");
  });

  /**
   * POZITIV KONTROLL A MASIK AGRA: a szallitos fioknal a tukor-vevo TOVABBRA IS
   * ott all. Enelkul a fenti tagadas akkor is teljesulne, ha a szot egyszeruen
   * kivettuk volna mindenhonnan -- es akkor a szallitos fiok tulajdonosa
   * veszitene el a feltetelt, amire varnia kell.
   */
  it("szállítóhoz kötött fióknál továbbra is a tükör-vevő sorról beszél", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="supplier" />,
    );

    const mondat = await screen.findByText(/nincs választható alegység/);
    expect(mondat.textContent).toContain("tükör-vevő");
  });

  /**
   * A BELSOS FIOK NEM "URES VALASZTO", HANEM MAS ALLAPOT: nincs mit szukiteni.
   * A korabbi szoveg ot is a partner-lancra kuldte volna.
   */
  it("belsős fióknál kimondja, hogy nincs mit szűkíteni", async () => {
    render(
      <UserVisibleUnits userId="target-1" role="SERVICE" binding="internal" />,
    );

    expect(await screen.findByText(/nincs mit szűkíteni/)).toBeTruthy();
  });
});
