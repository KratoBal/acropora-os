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

const api = vi.hoisted(() => ({ create: vi.fn(), uploadDocument: vi.fn() }));
const sheets = vi.hoisted(() => ({
  selectablePartners: vi.fn(),
  departments: vi.fn(),
}));
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
    api.uploadDocument.mockReset().mockResolvedValue([]);
    api.create.mockReset().mockResolvedValue({
      id: "job-uj",
      jobNumber: "HJ-2026-009",
    });
    sheets.selectablePartners.mockReset().mockResolvedValue(partnerList);
    // A HELYSZIN-LISTA ALAPBOL URES: a legtobb allitas nem rola szol, es egy
    // ures lista ott a mai valosag is. Amelyik allitas a helyszinrol szol, az
    // sajat valaszt ad.
    sheets.departments.mockReset().mockResolvedValue({ items: [] });
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
      // A HELYSZIN KIMONDVA `null`, nem elhagyva: partner nelkul nincs mibol
      // valasztani, es a szerver a partner nelkuli helyszint amugy is
      // elutasitja. Ha a mezo hianyozna a keresbol, a kulonbseg csendben
      // eltunne -- egy elhagyott mezo es egy szandekosan ures mezo a
      // halozati kepen ugyanugy nez ki.
      departmentId: null,
      // AZ ESZKOZ-LISTA KIMONDVA URES, nem elhagyva: helyszin nelkul nincs
      // mibol valasztani, es a szerver a helyszin nelkuli eszkozt amugy is
      // elutasitja.
      assetIds: [],
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
      departmentId: null,
      assetIds: [],
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
  /**
   * A SORREND ALLITASSAL VAN ROGZITVE, mert Balazs KERT egy sorrendet
   * (2026-09-14), es egy sorrend a legkonnyebben visszarendezodo dolog a
   * kepernyon: barmelyik kesobbi bovites a lap aljara vagy a tetejere teszi az
   * uj mezot, es senki nem veszi eszre, hogy a kert alak elveszett.
   *
   * A MERES A DOM SORRENDJEBOL JON, nem a forras szovegebol: az szamit, amit a
   * kezelo lat.
   */
  it("a mezok a kert sorrendben allnak, a csatolmany-valasztoval a vegen", async () => {
    render(<ServiceJobEditorPage />);
    await waitFor(() =>
      expect(sheets.selectablePartners).toHaveBeenCalledTimes(1),
    );

    // CSAK A NEVES FELIRATOK: az `Input` komponens sajat, ures `label` elemet is
    // rajzol, es az nem mezo-felirat. Ha azt is beleszamolnank, az allitas a
    // komponens BELSO alakjahoz kotodne, nem a kert sorrendhez.
    const feliratok = Array.from(document.querySelectorAll("label"))
      .map((elem) => elem.textContent?.trim())
      .filter((szoveg) => Boolean(szoveg));

    /*
      AZ "Érintett eszközök" NINCS A LISTABAN, es ez nem hiany: az a felirat
      `span`, nem `label` -- egy jelolonegyzet-listahoz tartozik, es a sajat
      feliratat minden sor viszi. Egy `htmlFor` nelkuli `label` csendben
      semmire nem mutatna.

      A "Fényképek és fájlok" viszont EGY mezohoz tartozik, tehat `label`, es a
      sorrend vegen all -- Balazs 2026-09-14-i listaja szerint a bizonyitek a
      hiba leirasa es az erintett eszkozok UTAN jon.
    */
    expect(feliratok).toEqual([
      "Partner",
      "Helyszín",
      "Mi a baj?",
      "Részletek",
      "Fényképek és fájlok",
    ]);
  });

  /**
   * PARTNER NELKUL A HELYSZIN NEM URES LEGORDULO, HANEM MONDAT.
   *
   * Ez a mobil oldalon MERT hiba tukre (2026-09-14): ott a valaszto ures
   * maradt, es semmi nem mondta meg, miert. Aki ures listat lat magyarazat
   * nelkul, a rossz helyen kezd keresni.
   */
  it("partner nelkul megmondja, hogy elobb partnert kell valasztani", async () => {
    render(<ServiceJobEditorPage />);

    expect(await screen.findByText(/Előbb válassz partnert/)).toBeTruthy();
    expect(screen.queryByLabelText("Helyszín")).toBeNull();
  });

  /**
   * A HELYSZIN NELKULI PARTNER SAJAT MONDATOT KAP, es ez MAS, mint a fenti.
   * A ket allapot teendoje kulonbozik: az egyiknel partnert kell valasztani, a
   * masiknal helyszint kell felvenni a partner torzsadatahoz.
   */
  it("helyszin nelkuli partnernel kimondja, hogy a jegy enelkul is megnyithato", async () => {
    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });

    expect(
      await screen.findByText(/Ehhez a partnerhez nincs felvéve helyszín/),
    ).toBeTruthy();
  });

  /**
   * A KIVALASZTOTT HELYSZIN ELMEGY, TELJES UTTAL A LISTABAN.
   *
   * Az ut azert szamit, mert a kod es a nev csak TESTVEREK kozott egyedi: ket
   * kulonbozo ag alatt ugyanaz a "Biodom" megengedett, es a kezelo a rosszat
   * valasztana.
   */
  it("a kivalasztott helyszint elkuldi, es teljes uttal kinalja", async () => {
    sheets.departments.mockResolvedValue({
      items: [
        {
          id: "unit-1",
          parentId: null,
          code: "NAG",
          name: "Nagy fókamedence",
          isActive: true,
        },
        {
          id: "unit-2",
          parentId: "unit-1",
          code: "BIO",
          name: "Biodóm",
          isActive: true,
        },
      ],
    });
    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });

    const helyszin = await screen.findByLabelText("Helyszín");
    expect(
      within(helyszin).getByText("Nagy fókamedence / Biodóm (BIO)"),
    ).toBeTruthy();

    fireEvent.change(helyszin, { target: { value: "unit-2" } });
    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toMatchObject({
      customerId: "vevo-1",
      departmentId: "unit-2",
    });
  });

  /**
   * PARTNERVALTASKOR A HELYSZIN ELESIK.
   *
   * Enelkul az elozo partner egysege maradna kivalasztva, a valasztoban
   * viszont mar nem szerepelne: a mezo URESNEK latszana, kozben ertek allna
   * benne, es a szerver utasitana el a felvitelt egy olyan hibaval, amit a
   * kepernyon semmi nem magyaraz.
   */
  it("partnervaltaskor a kivalasztott helyszin elesik", async () => {
    // KET PARTNER KELL HOZZA. Egyetlen partnerrel a masodik valasztas meg sem
    // tortenne, es a mezo azert lenne ures, amiert merni akarjuk -- az allitas
    // zold lenne akkor is, ha a kod semmit nem torolne.
    sheets.selectablePartners.mockResolvedValue({
      items: [
        ...partnerList.items,
        {
          customerId: "vevo-2",
          name: "Másik Partner Kft.",
          partnerCode: "MASI",
        },
      ],
    });
    sheets.departments.mockResolvedValue({
      items: [
        {
          id: "unit-1",
          parentId: null,
          code: "NAG",
          name: "Nagy fókamedence",
          isActive: true,
        },
      ],
    });
    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    const helyszin = await screen.findByLabelText("Helyszín");
    fireEvent.change(helyszin, { target: { value: "unit-1" } });
    expect((helyszin as HTMLSelectElement).value).toEqual("unit-1");

    fireEvent.click(screen.getByRole("button", { name: "Másik partner" }));
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-2" },
    });

    const ujHelyszin = await screen.findByLabelText("Helyszín");
    expect((ujHelyszin as HTMLSelectElement).value).toEqual("");
  });

  /**
   * A CSATOLMANY A JEGY LETREJOTTE UTAN MEGY FEL.
   *
   * A jegy a mentes pillanataban meg NEM LETEZIK, tehat nincs mihez kotni a
   * fajlt. Ez az allitas a SORRENDET meri: a feltoltes az `create` valaszabol
   * kapott azonositora megy, nem valami elore kitalalt ertekre.
   */
  async function urlapKitoltve(fajlok: File[]) {
    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Mi a baj?"), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.change(screen.getByLabelText("Fényképek és fájlok"), {
      target: { files: fajlok },
    });
  }

  it("a fájlokat a LÉTREJÖTT jegy azonosítójára tölti fel", async () => {
    await urlapKitoltve([new File(["a"], "kep.jpg", { type: "image/jpeg" })]);
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).toHaveBeenCalledWith(
      "token-1",
      "job-uj",
      "PHOTO",
      [expect.any(File)],
    );
    // ES CSAK AZUTAN VISZ TOVABB: a lapra, amin a feltoltott kep mar latszik.
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/szerviz/hibajegyek/job-uj",
      ),
    );
  });

  /**
   * A KIVALASZTOTT FAJL NEM CSENDBEN VAR: a lap kimondja, hogy MENNYI van, es
   * hogy MIKOR megy fel. Enelkul egy lassu feltoltes ugy nezne ki, mintha a
   * felvitel akadt volna el.
   */
  it("kimondja, hogy a fájlok a megnyitás után mennek fel", async () => {
    await urlapKitoltve([
      new File(["a"], "kep.jpg", { type: "image/jpeg" }),
      new File(["b"], "szamla.pdf", { type: "application/pdf" }),
    ]);

    expect(
      await screen.findByText(
        "2 fájl feltöltésre vár. A hibajegy megnyitása után töltjük fel.",
      ),
    ).toBeTruthy();
  });

  /**
   * A RESZLEGES SIKER A LEGDRAGABB CSEND.
   *
   * Ha a jegy letrejott es a feltoltes bukott, es a kepernyo csak annyit
   * mondana, hogy "nem sikerult", a kezelo ujra megnyomna a gombot -- es egy
   * MASODIK jegy szuletne ugyanarrol a hibarol. Ez az allitas HARMAT mer
   * egyszerre: hogy a jegy SZAMA elhangzik, hogy NEM viszunk tovabb, es hogy a
   * masodik nyomas mar NEM felvitel.
   */
  it("a feltöltés bukásakor megnevezi a létrejött jegyet, és nem nyit másodikat", async () => {
    api.uploadDocument.mockRejectedValue(new Error("A tároló nem érhető el."));
    await urlapKitoltve([new File(["a"], "kep.jpg", { type: "image/jpeg" })]);
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    expect(
      await screen.findByText(/HJ-2026-009 hibajegy LÉTREJÖTT/),
    ).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledTimes(1);

    // A GOMB MOSTANTOL UJRAPROBALAS, ES EGY MASODIK NYOMAS NEM NYIT JEGYET.
    const ujra = await screen.findByRole("button", {
      name: "Csatolmányok feltöltése újra",
    });
    api.uploadDocument.mockResolvedValue([]);
    fireEvent.click(ujra);

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/szerviz/hibajegyek/job-uj",
      ),
    );
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  /**
   * FAJL NELKUL EGYETLEN FELTOLTO HIVAS SEM MEGY EL. Egy ures keres a
   * szerveren 400-at adna ("A feltöltendő fájl kötelező."), es a kezelo egy
   * hibauzenetet latna egy urlapon, ahol nem is valasztott fajlt.
   */
  it("fájl nélkül nem hív feltöltést", async () => {
    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Mi a baj?"), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });
});
