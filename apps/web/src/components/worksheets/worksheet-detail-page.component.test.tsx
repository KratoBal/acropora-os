import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  /**
   * A VARRAT, ES A DUPLABOL 2026-09-04-IG HIANYZOTT.
   *
   * A lap MOSTANTOL lekeri az alairo-jelolteket. A dupla nem tud rola, tehat
   * a hivas `undefined`-ot hivna fuggvenykent -- es NEGY, egeszen mas
   * allitasrol szolo teszt bukott el rajta. Amit a HIVO hasznal, de a teszt
   * nem allit, az a dupla biztos hibaja.
   */
  signers: vi.fn(),
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
    // ALAPBOL NINCS MOGOTTE JEGY, mert az a folyamat egyik rendes kiindulasa:
    // a lap keletkezhet elobb, es a jegy utolag szuletik meg. Ami a masik
    // allapotot meri, az a hivas helyen allitja be.
    serviceJob: null,
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
    api.signers.mockResolvedValue({ items: [], emptyReason: null });
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

  /**
   * A LAP MEGMONDJA, MELYIK HIBAJEGY ALATT ALL, ES ODA IS VISZ.
   *
   * A kapcsolat a semaban hetek ota all, es a lezarasi feltetel is ismeri - a
   * reszletlap viszont hallgatott rola. Ez nem hianyzo funkcio volt, hanem egy
   * elmaradt osszekotes: mindket oldal helyes volt onmagaban.
   */
  it("names the service job behind the sheet, and links to it", async () => {
    api.detail.mockResolvedValue({
      ...detail(null),
      serviceJob: { id: "job-7", jobNumber: "HJ-2026-007" },
    });

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    const link = await screen.findByRole("link", { name: "HJ-2026-007" });
    expect(link.getAttribute("href")).toBe("/szerviz/hibajegyek/job-7");
  });

  /**
   * ES A HIANY IS ALLITAS, NEM URES MEZO.
   *
   * A lap keletkezhet hibajegy nelkul, es az nem hianyzo ADAT, hanem a
   * folyamat egyik rendes allapota. Egy gondolatjel - ahogy a tobbi ures
   * mezonel - azt sugallna, hogy valamit nem toltottek ki.
   *
   * EZ AZ ALLITAS A SZUKITEST MERI: a `serviceJob` nelkuli agnak SAJAT szoveget
   * kell adnia. Enelkul a keszlet csak azt nezne, hogy a jegy megjelenik, ha
   * van - es akkor is zold maradna, ha a hianyt semmi nem mondana ki.
   */
  it("says the sheet has no service job instead of leaving a dash", async () => {
    api.detail.mockResolvedValue(detail(null));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText("Nincs mögötte hibajegy")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^HJ-/ })).toBeNull();
  });
});

/**
 * KI IRJA ALA A LAPOT (Balazs, 2026-09-04).
 *
 * Az alairo a lap partnerenek nyilvantartott munkatarsa, listarol valasztva; az
 * "egyik sem" agon az iroda irja be a nevet, ES A LAP EZT KIMONDJA. A jelzes a
 * SZERVERTOL jon, tarolt allapotbol.
 */
describe("WorksheetDetailPage és az aláíró", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
    api.sign.mockReset();
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({
      items: [{ id: "kontakt-1", name: "Vevő Vilmos" }],
      emptyReason: null,
    });
  });

  function awaitingSignature() {
    const alap = detail(null);
    return {
      ...alap,
      currentVersion: { ...alap.currentVersion, status: "AWAITING_SIGNATURE" },
    };
  }

  it("a LISTÁRÓL választott aláírónál CSAK az azonosító megy fel", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS. A nevet a SZERVER veszi a valasztott sorbol; ha
      a kliens is kuldene egyet, a lapra MAS nev kerulhetne, mint akit
      valasztottak.

      MI PIROSIT: ha a `signerName` is bekerulne a torzsbe.
    */
    api.detail.mockResolvedValue(awaitingSignature());
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByLabelText("Aláíró");
    fireEvent.change(screen.getByLabelText("Aláíró"), {
      target: { value: "kontakt-1" },
    });
    api.sign.mockResolvedValue(awaitingSignature());
    fireEvent.click(screen.getByRole("button", { name: "Döntés rögzítése" }));
    await waitFor(() => expect(api.sign).toHaveBeenCalled());
    const [, , input] = api.sign.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(input.signerUserId).toBe("kontakt-1");
    expect("signerName" in input).toBe(false);
  });

  it("az EGYIK SEM ágon jön elő a névmező, és KIMONDJA a következményét", async () => {
    /*
      A szabad szoveges ag NEM kiskapu: ez az az ut, amin az iroda beirja a
      nevet -- es a lap KIMONDJA, hogy nem a partner nyilvantartott munkatarsa
      irta ala. Ha a mondat hianyozna, a ket ag a kepernyon
      megkulonboztethetetlen lenne.

      MI PIROSIT: a mondat torlese, vagy ha a mezo a valasztott agon is ott
      allna.
    */
    api.detail.mockResolvedValue(awaitingSignature());
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByLabelText("Aláíró");
    expect(screen.getByLabelText("Aláíró neve")).toBeTruthy();
    expect(screen.getByText(/a nevet te írtad be/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Aláíró"), {
      target: { value: "kontakt-1" },
    });
    await waitFor(() =>
      expect(screen.queryByLabelText("Aláíró neve")).toBeNull(),
    );
  });

  it("az ÜRES listánál a szerver mondata látszik, nem néma üres legördülő", async () => {
    /*
      Ket kulonbozo ok van, es a teendojuk MAS. Egy nema ures legordulo mind a
      kettore raillik, es a felhasznalo egyiket sem tudja megoldani.

      MI PIROSIT: az `emptyReason` kirajzolasanak elhagyasa.
    */
    api.detail.mockResolvedValue(awaitingSignature());
    api.signers.mockResolvedValue({
      items: [],
      emptyReason: "Ehhez a partnerhez még nincs hozzákötött munkatárs.",
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByText(/nincs hozzákötött munkatárs/);
  });

  it("a RÖGZÍTETT aláírás mellett a szerver jelzése áll", async () => {
    /*
      A jelzes TAROLT allapotbol jon, nem abbol, hogy a nev "ugy nez ki",
      mintha ugyfele lenne -- es a regi sorokrol MAST mond, mint az ujakrol.

      MI PIROSIT: a `signerNotice` kirajzolasanak elhagyasa.
    */
    const alap = detail(null);
    /*
      A VERZIO-TABLAZAT SORAT ALLITJUK ELO, mert a jelzes OTT latszik: a
      fixture alapbol ures `versions` tombot ad (a lap tobbi allitasa nem
      hasznalja), tehat a jelzest egy sor NELKUL nem is lehetne merni -- a
      teszt zold maradna, es semmit nem mondana.
    */
    api.detail.mockResolvedValue({
      ...alap,
      versions: [
        {
          ...alap.currentVersion,
          signature: {
            decision: "ACCEPTED" as const,
            signerName: "Kovács Kázmér",
            signedByName: "Szerelő Sándor",
            signedAt: "2026-09-04T10:00:00.000Z",
            note: null,
            signerNotice:
              "A nevet a szerelő írta be: az aláíró NEM a partner munkatársa.",
          },
        },
      ],
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByText(/NEM a partner munkatársa/);
  });
});
