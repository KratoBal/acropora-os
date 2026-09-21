import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetDetail } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";

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
  /**
   * UGYANAZ A VARRAT, MASODSZOR (2026-09-17): a lap mostantol lekeri a
   * CSATOLMANYOKAT is. Ami a hivo hasznal, de a dupla nem ad meg, az a dupla
   * biztos hibaja -- a szomszed komment epp errol szol, egy korral korabbrol.
   */
  documents: vi.fn(),
  downloadDocument: vi.fn(),
  /**
   * UGYANAZ A VARRAT, HARMADSZOR (2026-09-21): a lap mostantol JELOLNI tudja
   * az atadast. A gomb a duplat hivja, tehat ha itt nem all, a kattintas
   * `undefined`-ot hivna fuggvenykent.
   */
  setHandedOver: vi.fn(),
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
    /*
      ALAPBOL NINCS ATADVA, es ez a rendes kiindulas: a lap eletenek nagy
      reszeben nalunk van az eszkoz. Ami a masik allapotot meri, az a hivas
      helyen allitja be -- ugyanaz a szokas, mint a hibajegynel fentebb.
    */
    handedOverAt: null,
    handedOverByName: null,
    assignees: [],
    /*
      A MEZO KOTELEZO, NEM ELHAGYHATO -- es epp ezert szolt a fordito, amikor
      bekerult. Elhagyhatokent a lap CSENDBEN `undefined`-ot kapott volna, es a
      hiba a kepernyon jelent volna meg, nem itt.
    */
    assets: [],
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
      /*
      A KET UJ MEZO 2026-09-21 OTA KOTELEZO A FIXTURABAN IS, es ezt a FORDITO
      kenyszeritette ki. `null` = a lap ki van allitva, de nem kuldtuk ki
      alairasra -- epp az az allapot, amirol ez a kor szol.
    */
      sentForSignatureAt: null,
      sentForSignatureToName: null,
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
      // A lenti egyetlen sor 2 munkaórát ad (2 óra, egy ember).
      laborHours: "2",
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
          // ÓRA-tétel, egy emberrel: 2 * 1 = 2 munkaóra. A fixtúra így a
          // munkaóra-megjelenítésen is mér valamit, nem csak nullát ad.
          kind: "LABOR" as const,
          workerCount: 1,
          laborHours: "2",
          unitNet: "15000",
          vatRatePercent: "27",
          netAmount: "30000",
          vatAmount: "8100",
          grossAmount: "38100",
        },
      ],
    },
    versions: [],
    hidden: false,
  };
}

describe("WorksheetDetailPage és az ügyfél saját kódja a tételsoron", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.documents.mockResolvedValue({ items: [] });
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
    api.documents.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({
      items: [{ id: "kontakt-1", name: "Vevő Vilmos" }],
      emptyReason: null,
    });
  });

  /**
   * KIALLITOTT **ES KIKULDOTT** LAP.
   *
   * A `sentForSignatureAt` NEM azert all itt, mintha az alairas-urlap tole
   * fuggne -- az a belso feluleten CSAK az allapotot nezi (a kikuldes-kapu a
   * partnerportale). Azert all itt, mert ez a fixtura a KIKULDOTT lapot irja
   * le, es a kikuldes-blokk EZEN tunik el. A ket blokk igy megkulonboztetheto:
   * egy "soha ne mutasd a kikuldest" javitas ettol a fixturatol lesz piros.
   *
   * AZ ELSO ALAKJA MAST ALLITOTT ("a felulet ugyanazt a kettot nezi"), es egy
   * piros CI cafolta meg (2026-09-21): a tul szeles kapu a SZEMELYES alairast
   * zarta volna el.
   */
  function awaitingSignature() {
    const alap = detail(null);
    return {
      ...alap,
      currentVersion: {
        ...alap.currentVersion,
        status: "AWAITING_SIGNATURE",
        sentForSignatureAt: "2026-09-21T16:00:00.000Z",
        sentForSignatureToName: "Vevő Vilmos",
      },
    };
  }

  /**
   * A KI NEM KULDOTT LAPON MIND A KETTO ALL -- ES EZ EGY PIROS CI UTAN IGY
   * HELYES (2026-09-21).
   *
   * Elso alakjaban ez az allitas azt mondta ki, hogy a ki nem kuldott lapon az
   * alairas-urlap NEM latszik. Az a felulet a SZEMELYES alairas helye: a belso
   * kollega a helyszinen vetet ala, gepelt nevvel, es ahhoz nincs kikuldes --
   * nem is lehet, mert a cimzett kotelezoen a vevo aktiv munkatarsa. Egy ilyen
   * vevonel az urlap elrejtese azt jelentette volna, hogy a lapot SOHA nem
   * lehet alairni.
   *
   * A KIKULDES-KAPU A PARTNERPORTALRA VALO, ES OTT ALL (`worksheet-detail.tsx`).
   * Itt a ket blokk egyszerre kinal ket utat: "kuldd ki az ugyfelnek" VAGY
   * "irasd ala most itt".
   */
  it("kiállított, de KI NEM KÜLDÖTT lapon MINDKÉT út nyitva áll", async () => {
    const alap = detail(null);
    api.detail.mockResolvedValue({
      ...alap,
      currentVersion: {
        ...alap.currentVersion,
        status: "AWAITING_SIGNATURE",
        sentForSignatureAt: null,
        sentForSignatureToName: null,
      },
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await waitFor(() =>
      expect(screen.getByText("Kiküldés aláírásra")).toBeTruthy(),
    );
    expect(screen.getByText("Ügyfél döntésének rögzítése")).toBeTruthy();
  });

  /**
   * ES A MASIK IRANY: A KIKULDOTT LAPON AZ ALAIRAS ALL, A KIKULDES NEM.
   *
   * Enelkul egy "soha ne mutasd az alairast" javitas is zold lenne -- es akkor
   * a belsos rogzites egyaltalan nem lenne elerheto.
   */
  it("KIKÜLDÖTT lapon az aláírás áll, a kiküldés-blokk nem", async () => {
    api.detail.mockResolvedValue(awaitingSignature());
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await waitFor(() =>
      expect(screen.getByText("Ügyfél döntésének rögzítése")).toBeTruthy(),
    );
    expect(screen.queryByText("Kiküldés aláírásra")).toBeNull();
  });

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
    fireEvent.change(screen.getByLabelText("Aláírókód"), {
      target: { value: "0000" },
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
    expect(input.signatureCode).toBe("0000");
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

/**
 * AZ ALAIROKOD A WEBEN.
 *
 * Ugyanaz a szerzodes, mint a telefonon: a kod CSAK a listarol valasztott agon
 * kell, es a mentes gomb addig zarva, amig nincs meg.
 */
describe("WorksheetDetailPage és az aláírókód", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
    api.sign.mockReset();
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.documents.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({
      items: [{ id: "kontakt-1", name: "Vevő Vilmos" }],
      emptyReason: null,
    });
  });

  /**
   * KIALLITOTT **ES KIKULDOTT** LAP.
   *
   * A `sentForSignatureAt` NEM azert all itt, mintha az alairas-urlap tole
   * fuggne -- az a belso feluleten CSAK az allapotot nezi (a kikuldes-kapu a
   * partnerportale). Azert all itt, mert ez a fixtura a KIKULDOTT lapot irja
   * le, es a kikuldes-blokk EZEN tunik el. A ket blokk igy megkulonboztetheto:
   * egy "soha ne mutasd a kikuldest" javitas ettol a fixturatol lesz piros.
   *
   * AZ ELSO ALAKJA MAST ALLITOTT ("a felulet ugyanazt a kettot nezi"), es egy
   * piros CI cafolta meg (2026-09-21): a tul szeles kapu a SZEMELYES alairast
   * zarta volna el.
   */
  function awaitingSignature() {
    const alap = detail(null);
    return {
      ...alap,
      currentVersion: {
        ...alap.currentVersion,
        status: "AWAITING_SIGNATURE",
        sentForSignatureAt: "2026-09-21T16:00:00.000Z",
        sentForSignatureToName: "Vevő Vilmos",
      },
    };
  }

  it("a kód mezője CSAK a választott ágon jön elő", async () => {
    /*
      Az "egyik sem" agon NINCS kod, es ez nem kiskapu: ott a lap maga mondja
      ki, hogy nem a partner nyilvantartott munkatarsa irta ala.

      MI PIROSIT: ha a mezo feltetel nelkul ott allna -- akkor a szabad
      szoveges agon olyat kernenk, amit a szerver nem is varna.
    */
    api.detail.mockResolvedValue(awaitingSignature());
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByLabelText("Aláíró");
    expect(screen.queryByLabelText("Aláírókód")).toBeNull();
    fireEvent.change(screen.getByLabelText("Aláíró"), {
      target: { value: "kontakt-1" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Aláírókód")).toBeTruthy(),
    );
  });

  it("HIÁNYOS kóddal a rögzítés gomb ZÁRVA marad", async () => {
    /*
      A szerver ugyanezt elutasitja; ez a kapu azert all itt, hogy a hiba NE egy
      korut utan derüljön ki. Negy szamjegy: harom nem "majdnem jo".

      MI PIROSIT: a hossz-feltetel elhagyasa a gomb tiltasabol.
    */
    api.detail.mockResolvedValue(awaitingSignature());
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByLabelText("Aláíró");
    fireEvent.change(screen.getByLabelText("Aláíró"), {
      target: { value: "kontakt-1" },
    });
    fireEvent.change(await screen.findByLabelText("Aláírókód"), {
      target: { value: "12" },
    });
    const gomb = screen.getByRole("button", { name: "Döntés rögzítése" });
    expect((gomb as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * AZ ADATLAP UJ SZERKEZETE, Balazs 2026-09-15-i designjabol.
 *
 * Ket dolgot merunk, es mind a ketto olyan, aminek az elromlasa NEMA lenne: az
 * osszegek egy MASIK helyre kerultek (a tablazat lababol a jobb hasabba), es a
 * fejlecben megcserelodott a sorszam es a targy.
 */
describe("WorksheetDetailPage adatlap-szerkezet", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset().mockResolvedValue(detail(null));
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.documents.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({ items: [], emptyReason: null });
  });

  /**
   * AZ ÖSSZEGEK 2026-09-17 ÓTA NEM JELENNEK MEG -- ÉS EZ BALÁZS DÖNTÉSE.
   *
   * Itt korábban az állt, hogy a nettó, az áfa és a bruttó a SAJÁT sorában áll,
   * címkéhez kötve (a csere semmilyen hibát nem okozna, és egy pillantásra
   * helyesnek látszana). Az az állítás tárgytalan lett: az "Összesítés" panel
   * kikerült, mert mind a három sora ár volt.
   *
   * MIÉRT NEM TÖRÖLTEM, HANEM MEGFORDÍTOTTAM: egy törölt teszt után semmi nem
   * mondaná meg, hogy a viselkedés MEGVÁLTOZOTT, és nem elfelejtettük.
   *
   * ÉS A PANEL HELYE NEM MARAD ÜRESEN: a #806-tal megjött az összesített
   * munkaóra, és Balázs ugyanabban a kérésében azt kérte a lap végére. Az a
   * következő szelet, külön PR-ben -- ez a teszt akkor ismét megfordul, és a
   * MUNKAÓRÁT fogja a címkéjéhez kötni.
   */
  it("az árak és az Összesítés panel NEM jelenik meg a lapon", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    /*
      ISMERT POZITÍV KONTROLL ELŐSZÖR, ÉS EZ NÉLKÜLÖZHETETLEN: a lap
      ASZINKRON töltődik. Ha csak a hiányt állítanám, a teszt akkor is zöld
      lenne, ha a lap MÉG SEMMIT nem rajzolt ki -- és akkor nem az elrejtést
      mérném, hanem a betöltés lassúságát.
    */
    await screen.findByText("Kompresszor bevizsgálás");

    /*
      AZ "ÖSSZESÍTÉS" PANEL 2026-09-17 ESTE VISSZATÉRT -- MÁS TARTALOMMAL.

      Itt korábban az állt, hogy a panel SEHOL nem jelenik meg. Az akkor igaz
      volt: mind a három sora ár volt. Ugyanaznap este ugyanabba a helyre került
      az ÖSSZES MUNKAÓRA (Balázs ugyanannak a kérésnek a másik fele).

      Ezért a panel LÉTE már nem mérce; a mérce az, hogy ÁR nem áll benne. A
      három ár-sor állítása változatlanul itt van, név szerint.
    */
    expect(screen.queryByText("Nettó összeg")).toBeNull();
    expect(screen.queryByText("Bruttó összeg")).toBeNull();
    expect(screen.queryByText("Egységár")).toBeNull();
  });

  /**
   * A MUNKAÓRA A LAP VÉGÉN ÉS TÉTELENKÉNT (2026-09-17, Balázs kérése).
   *
   * Szó szerint: "a végén legyen egy össz munkaóra ami automatikusan számol
   * tételenként és az összes tétel esetben is".
   */
  it("az összes munkaóra a lap végén áll", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByText("Kompresszor bevizsgálás");

    expect(screen.getByText("Összesítés")).toBeTruthy();
    expect(screen.getByText("Összes munkaóra")).toBeTruthy();
    expect(screen.getByText("2 óra")).toBeTruthy();
  });

  it("a tétel sorában is ott a saját munkaórája", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    const sor = (await screen.findByText("Kompresszor bevizsgálás")).closest(
      "tr",
    );

    /*
      AZ ÁLLÍTÁS A CELLÁRA MEGY, NEM A SOR SZÖVEGÉRE -- ÉS EZT A KALIBRÁCIÓ
      TANÍTOTTA MEG.

      Az első változatom `sor.textContent` tartalmazza-e a "2" karaktert
      alakban állt. Az ZÖLD MARADT akkor is, amikor a munkaóra-cellát ÜRESRE
      rontottam: a sorban a MENNYISÉG is "2". Az állítás neve a munkaóráról
      szólt, a mérés pedig a mennyiséget találta meg.
    */
    const cellak = Array.from(sor?.querySelectorAll("td") ?? []);

    // ISMERT POZITÍV KONTROLL: a sor egyáltalán felépült, öt cellával.
    expect(cellak.length).toBe(5);
    expect(cellak[1]?.textContent).toContain("Kompresszor bevizsgálás");

    // A fejléc NEVEZI el az oszlopot, a cella HORDOZZA az értéket. Külön-külön
    // egyik sem elég: egy fejléc üres oszlop fölött is állhat.
    expect(screen.getByText("Munkaóra")).toBeTruthy();
    expect(cellak[4]?.textContent).toBe("2");
  });

  /**
   * A FEJLECBEN A TARGY A CIM, A SORSZAM A FOLOTTE ALLO KIS SOR.
   *
   * Forditva volt, es a prototipus forditja meg: a kollega a munka TARGYARA
   * emlekszik. Az allitas a SZEREPRE megy (`heading`), nem arra, hogy a szoveg
   * valahol megjelenik a lapon -- a sorszam ugyanis tovabbra is ott all, csak
   * nem cimkent.
   */
  it("a lap címe a munka tárgya, nem a munkalapszám", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    const cim = await screen.findByRole("heading", { level: 1 });
    expect(cim.textContent).toBe("Kompresszorok bevizsgálása");
    expect(screen.getByText("BIO-2026-001/1")).toBeTruthy();
  });

  /**
   * A BETOLTESI HIBA AGA MEGMONDJA, HOGY NINCS HALOZAT -- ES EDDIG NEM MONDTA.
   *
   * Ez az az ag, ami HIDEG betoltesnel, kapcsolat nelkul lefut. A savot eddig
   * csak a FO visszateres hordozta, ide viszont sosem jutunk el: a `state`
   * ternary `empty` fele HOLT ag volt. A felhasznalo annyit latott, hogy
   * "nem tolthetó be / Ismeretlen hiba", es semmit arrol, hogy MIERT.
   *
   * ES EZ AZ ALLITAS EDDIG MEG CSAK NEM IS LETEZHETETT: nem azert hianyzott,
   * mert elfelejtettuk, hanem mert az allapot nem allt elo. Nautilus nevezte
   * meg ezt kulon okkent (20188): a rontas utani zold NEGYEDIK oka az, hogy
   * az allapot nem all elo -- es azt a legkonnyebb osszekeverni a halott
   * allitassal.
   */
  /**
   * ES A PAR MASIK FELE: A BETOLTOTT LAP NEM MONDHATJA, HOGY NEM TOLTOTT BE.
   *
   * A ket allitas EGYUTT kulonboztet, kulon egyik sem. Ezt merve tanultam meg
   * ezen a lapon: a fenti allitas ZOLD MARAD akkor is, ha a FO visszateres
   * allandoan `empty`-t ad -- vagyis ha egy betoltott munkalap folott az all,
   * hogy "nem tudtuk betolteni". Egyedul a fenti nem fogja meg.
   *
   * A lap KET allapotba tud kerulni, KET kulon kodutonn (a korai hiba-ag es a
   * fo visszateres), ezert kell ide ketto. Ahol csak egy allapot all elo, ott
   * egy a helyes szam -- a masodik allitas ott nem szigor, hanem disz.
   * (nautilus, 20188.)
   */
  it("betöltött lapon nem állítja, hogy nem sikerült betölteni", async () => {
    setOnLine(false);
    api.detail.mockResolvedValue(detail(null));

    render(<WorksheetDetailPage worksheetId="ml-1" />);

    expect(await savotMond("loaded")).toBeTruthy();
  });

  /**
   * A MASODIK ALLITAS VARJA MEG A SAVOT -- ES EZ EGY MERT BILLEGES JAVITASA.
   *
   * A korabbi alak egy MASIK elemet vart be (a hibauzenetet), majd SZINKRON
   * `getByText`-tel kereste a savot. A sav viszont a sajat effektjeben all elo
   * (`navigator.onLine` olvasasa a felallas UTAN), tehat egy utemmel kesobb is
   * landolhat -- es akkor a szinkron kereses ures kepernyore nez.
   *
   * MERVE 2026-09-15, a FO AGON, tehat nem ebben a korben keletkezett:
   * 2 bukas 36 futasbol (kb. 5 szazalek). A CI-ben a #709-en sult el eloszor.
   * A `savotMond` var, ezert a billeges megszunik -- de az allitas NEM gyengul:
   * ha a sav soha nem jelenik meg, ugyanugy elbukik, csak nem veletlenszeruen.
   */
  it("betöltési hibánál kimondja, hogy nincs hálózat", async () => {
    setOnLine(false);
    api.detail.mockRejectedValue(new Error("hálózati hiba"));

    render(<WorksheetDetailPage worksheetId="ml-1" />);

    // A HIBA ES AZ OKA EGYUTT: a hibauzenet onmagaban nem mondja meg, miert.
    expect(await screen.findByText("A munkalap nem tölthető be")).toBeTruthy();
    expect(await savotMond("empty")).toBeTruthy();
  });
});

afterEach(() => setOnLine(true));

/**
 * AZ ALEGYSEG TELJES UTJA AZ ADATLAPON.
 *
 * Balazs merte vissza 2026-09-16-an: itt `NMD — Nagymedence` allt, es abbol nem
 * derul ki, MELYIK medencerol van szo. A kod es a nev csak TESTVEREK kozott
 * egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodóm (BIO)" megengedett.
 *
 * KET ALLITAS, ES A MASODIK A FONTOSABB: az elso azt meri, hogy az utat KIIRJA,
 * a masodik azt, hogy a mezo HIANYABAN a regi alak marad -- a mezo elhagyhato,
 * es egy regebbi valasz nem hordozza.
 */
describe("WorksheetDetailPage alegység-útja", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
  });

  it("a teljes utat írja ki, ha a szerver küldi", async () => {
    const alap = detail(null);
    api.detail.mockResolvedValue({
      ...alap,
      department: {
        ...alap.department,
        path: ["Biodóm", "Fókamedence", "Fóka nagymedence"],
      },
    });

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(
      await screen.findByText("Biodóm / Fókamedence / Fóka nagymedence"),
    ).toBeTruthy();
  });

  /**
   * A VISSZAESES NEM URES SOR. Ha az allitas csak a fenti esetet merne, egy
   * elrontott visszaeses (ures cella) eszrevetlen maradna -- es epp az a
   * helyzet, ami a REGI valaszoknal all elo.
   */
  it("a mező hiánya nem üríti ki a sort", async () => {
    api.detail.mockResolvedValue(detail(null));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText(/BIO —/)).toBeTruthy();
  });
});

describe("WorksheetDetailPage és a csatolmányok", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset();
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.documents.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({ items: [], emptyReason: null });
  });

  /**
   * A SZAKASZ BE VAN KÖTVE A LAPBA -- ÉS EZT AZ ÁLLÍTÁST EGY KALIBRÁCIÓ KÉRTE.
   *
   * A komponens saját tesztje IZOLÁLTAN mér: ha valaki a lapból kiveszi a
   * hívást, az a készlet ZÖLD MARAD. Mérve 2026-09-17: a szakaszt kivéve
   * mind a 762 teszt átment.
   *
   * Ez pontosan az a hibafajta, amit ez a kártya javít: a képesség megvan, és
   * senki nem hívja. Egy izolált teszt azt méri, hogy a doboz MŰKÖDIK, nem
   * azt, hogy OTT VAN.
   *
   * MI PIROSÍT: a `<WorksheetDocuments ... />` eltávolítása a lapból.
   */
  it("a lap lekéri és kiírja a csatolmány-szakaszt", async () => {
    api.detail.mockResolvedValue(detail("LEL-1"));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText("Csatolmányok")).toBeTruthy();
    await waitFor(() =>
      expect(api.documents).toHaveBeenCalledWith(
        "token-1",
        "worksheet-1",
        expect.anything(),
      ),
    );
  });
  /**
   * AZ ALAIROK LISTAJA A HARMADIK, NEMA HELY.
   *
   * A masik ketto (a naplo listaja es az egy bejegyzes lapja) URES LISTAT ad,
   * ami legalabb latszik. Ez a lekerdezes viszont a valasztot az "egyik sem"
   * agra allitja, es a komponens sajat kommentje szerint AZ AG SZANDEKOS --
   * vagyis ugy nez ki, mintha a partnernek nem lenne alairo munkatarsa,
   * holott a hivas el sem indult. Egy hianyt allit egy elmaradt keresbol.
   *
   * MI PIROSIT: ha a kapu visszakerul a `!token` alakra.
   */
  it("az ALAIROK lekerdezese URES TOKENU munkamenettel is elindul", async () => {
    auth.session = { ...session, token: undefined };
    /*
      A MOCKOT ITT KELL NULLAZNI, ES EZ NEM FORMASAG. A `beforeEach` csak a
      visszateresi erteket allitja be, a hivas-listat nem -- vagyis a
      `mock.calls` a KORABBI tesztek hivasait is tartalmazza. Enelkul a lenti
      ket allitas AKKOR IS ZOLD, ha ez a rendereles egyaltalan nem hiv semmit:
      egy allitas, ami nem tud elbukni.
    */
    api.signers.mockClear();
    api.detail.mockResolvedValue(detail(null));

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    await waitFor(() => expect(api.signers).toHaveBeenCalled());
    // A token URESEN, de ATADVA: az apiRequest donti el, Bearer vagy suti.
    expect(api.signers.mock.lastCall?.[0]).toBe("");
  });
});

/**
 * A KIALLITO GOMB ES A HELYETTE ALLO MONDAT.
 *
 * Balazs, 2026-09-18 18:09:59 UTC: "Nem tudok lezarni munkalapot. Nincs olyan
 * gomb." A gomb a #87 ota itt all -- csak a lapja nem volt piszkozat. A nema
 * elrejtes es a hianyzo funkcio a kepernyon megkulonboztethetetlen, es ebbol
 * szuletett egy kartya, ami egy nem letezo hianyt javitott volna.
 */
describe("a kiállítás a munkalap adatlapján", () => {
  beforeEach(() => {
    auth.session = session;
    api.signers.mockResolvedValue({ items: [], emptyReason: null });
  });

  /**
   * A FELIRAT MEGMONDJA, MIT CSINAL (Balazs dontese, 2026-09-21 12:10:42 UTC).
   * A puszta "Lezaras" nem mondta meg, hogy ez a lepes osztja ki a SZAMOT es
   * allitja elo a DOKUMENTUMOT -- es a sorrend emiatt maradt kitalalhato.
   */
  it("piszkozaton a gomb megnevezi a KIÁLLÍTÁST, nem csak a lezárást", async () => {
    /*
      A FIXTURA IS MERES: a kozos `detail()` alapbol SIGNED lapot ad, tehat egy
      "piszkozaton" nevu allitas ott NEM piszkozatot merne. Az elso valtozatom
      pontosan ezen bukott el -- a teszt NEVE mast igert, mint a bemenete.
    */
    const alap = detail(null);
    api.detail.mockResolvedValue({
      ...alap,
      currentVersion: { ...alap.currentVersion, status: "DRAFT" },
    });

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    const gomb = await screen.findByRole("button", {
      name: /Kiállítás és lezárás/,
    });
    expect(gomb).toBeTruthy();
    /* ES A HELYETTE ALLO MONDAT ILYENKOR NEM LATSZIK: ket allapot, ket kimenet. */
    expect(screen.queryByText(/Kiállítani csak piszkozatot lehet/)).toBeNull();
  });

  /**
   * A LENYEGI ALLITAS: nem-piszkozat lapon a lap KIMONDJA az ALLAPOTOT.
   *
   * acrobot kikotese: az allapotot nevezze meg, ne azt, hogy "nem lehet" --
   * egy "nem erheto el" alaku mondat ugyanazt a nemasagot irna korul.
   */
  it("nem-piszkozat lapon az ÁLLAPOT áll a gomb helyén", async () => {
    /* A NEM-PISZKOZAT ALLAPOT ITT EPUL, nem egy masik describe segedjebol: a
       blokkok kozott nincs lathatosag, es egy masolt seged csendben elcsuszna
       a sajatjatol. */
    const alap = detail(null);
    api.detail.mockResolvedValue({
      ...alap,
      currentVersion: { ...alap.currentVersion, status: "AWAITING_SIGNATURE" },
    });

    render(<WorksheetDetailPage worksheetId="worksheet-1" />);

    expect(await screen.findByText(/Ez a lap már ki van állítva/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Kiállítás és lezárás/ }),
    ).toBeNull();
  });
});

/**
 * AZ ATADAS A MUNKALAP ADATLAPJAN (Balazs dontese, 2026-09-21).
 *
 * A mezo 2026-09-02 ota all a semaban, es 2026-09-21-ig SEMMI nem irta. A
 * lap 2026-09-07-ig azt allitotta MINDEN munkalapra, hogy "Meg nalunk van" --
 * a mondat akkor kikerult, mert iro nelkul hamis allitas volt. Mostantol van
 * iroja, tehat a mondat visszater, es itt mind a KET aga merve van.
 */
describe("WorksheetDetailPage és az eszköz átadása", () => {
  beforeEach(() => {
    auth.session = session;
    api.detail.mockReset().mockResolvedValue(detail(null));
    api.assignableUsers.mockResolvedValue({ items: [] });
    api.documents.mockResolvedValue({ items: [] });
    api.signers.mockResolvedValue({ items: [], emptyReason: null });
    api.setHandedOver.mockReset().mockResolvedValue(detail(null));
  });

  afterEach(() => {
    setOnLine(true);
  });

  it("átadás nélkül kimondja, hogy az eszköz még nálunk van", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    // ISMERT POZITIV KONTROLL: a lap egyaltalan felepult. Enelkul a felirat
    // hianya a betoltes lassusagat merne, nem az allapotot.
    await screen.findByText("Kompresszor bevizsgálás");

    expect(screen.getByTestId("munkalap-atadas").textContent).toBe(
      "Még nálunk van",
    );
  });

  it("átadás után a DÁTUM és az ÁTADÓ NEVE áll ott", async () => {
    api.detail.mockResolvedValue({
      ...detail(null),
      handedOverAt: "2026-09-21T10:00:00.000Z",
      handedOverByName: "Szerelő Sándor",
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByText("Kompresszor bevizsgálás");

    const szoveg = screen.getByTestId("munkalap-atadas").textContent ?? "";
    expect(szoveg).toContain("Szerelő Sándor");
    /*
      A DATUMOT A SAJAT FORMAZOJA ADJA, ezert nem betu szerint allitok ra:
      az EV eleg ahhoz, hogy a datum ott van, es nem kot meg egy
      megjelenitesi dontest, ami holnap valtozhat.
    */
    expect(szoveg).toContain("2026");
    // ES A REGI, HAMIS MONDAT NINCS OTT. Ez kulon allitas: egy rosszul irt
    // felteteles ag mind a kettot kirajzolhatna.
    expect(szoveg).not.toContain("Még nálunk van");
  });

  /*
    A NEV HIANYA NEM VONJA VISSZA AZ ATADAST. A semaban a kapcsolat
    `onDelete: SetNull`, tehat egy azota torolt kollega neve eltunik -- az
    atadas tenye nem. Ha a lap a NEVRE agazna, a visszaadott eszkoz
    ujra "nalunk levonek" latszana.
  */
  it("a dátum egymagában is átadást jelent, név nélkül", async () => {
    api.detail.mockResolvedValue({
      ...detail(null),
      handedOverAt: "2026-09-21T10:00:00.000Z",
      handedOverByName: null,
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    await screen.findByText("Kompresszor bevizsgálás");

    expect(screen.getByTestId("munkalap-atadas").textContent).not.toContain(
      "Még nálunk van",
    );
  });

  it("a gomb az ELLENKEZŐ irányt küldi el, nem fordít vakon", async () => {
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    const gomb = await screen.findByTestId("munkalap-atadas-gomb");
    expect(gomb.textContent).toBe("Átadás rögzítése");

    fireEvent.click(gomb);

    await waitFor(() => {
      expect(api.setHandedOver).toHaveBeenCalledWith(
        "token-1",
        "worksheet-1",
        true,
      );
    });
  });

  it("már átadott lapon a VISSZAVONÁST kínálja fel", async () => {
    api.detail.mockResolvedValue({
      ...detail(null),
      handedOverAt: "2026-09-21T10:00:00.000Z",
      handedOverByName: "Szerelő Sándor",
    });
    render(<WorksheetDetailPage worksheetId="worksheet-1" />);
    const gomb = await screen.findByTestId("munkalap-atadas-gomb");
    expect(gomb.textContent).toBe("Átadás visszavonása");

    fireEvent.click(gomb);

    await waitFor(() => {
      expect(api.setHandedOver).toHaveBeenCalledWith(
        "token-1",
        "worksheet-1",
        false,
      );
    });
  });
});
