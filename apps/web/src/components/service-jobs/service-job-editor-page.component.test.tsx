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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { ServiceJobEditorPage } from "./service-job-editor-page";

const api = vi.hoisted(() => ({ create: vi.fn(), uploadDocument: vi.fn() }));
/**
 * AZ ESZKOZ-VEGPONT IS MOCKOT KAP, ES EZ NEM TELJESSEG-KEDVEERT VAN.
 *
 * A lap az eszkoz-valasztot a `JobAssetPicker`-en at rajzolja, az pedig a
 * `@/lib/api/assets`-et hivja -- egy MASIK modult, mint amit a lap maga
 * importal. Mock nelkul a hivas VALODI `fetch` lett, a relativ `/api` elotag
 * pedig a futtato dokumentum-cimehez oldodik fel.
 *
 * MERVE 2026-09-15: `document.location.href` = `http://localhost:3000/`, tehat
 * a keres cime `http://localhost:3000/api/assets` -- A NEXT DEV SZERVER PORTJA.
 *
 * Ket kovetkezmenye volt, es a masodik a rosszabb:
 *   - ahol semmi nem figyel (CI, es a legtobb gep), a hivas ECONNREFUSED-del
 *     elhal, a valaszto a HIBA-agara esik, es minden ilyen futas egy
 *     elromlott valasztot rajzol -- csendben, mert egyik allitas sem nezi;
 *   - ahol viszont EPP FUT a `pnpm dev`, ott VALODI keres megy a fejleszto
 *     sajat szerverere. A teszt viselkedese igy nem a kodtol fugg, hanem
 *     attol, mi fut meg a gepen.
 */
const assets = vi.hoisted(() => ({ list: vi.fn() }));

const sheets = vi.hoisted(() => ({
  selectablePartners: vi.fn(),
  departments: vi.fn(),
  assignableUsers: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));
vi.mock("@/lib/api/assets", () => ({ assetsApi: assets }));

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
    /*
      AZ ESZKOZ-LISTA ALAPBOL URES, DE LETEZIK. A valaszto csak helyszin
      valasztasa utan hiv; ha a dupla nem adna valaszt, a `response.items`
      dobna, es a valaszto ugyanugy a HIBA-agara esne, mint mock nelkul --
      csak akkor mar csendben, halozati zaj nelkul. Az az allapot rosszabb
      lenne a mainal, mert semmi nem arulna el.
    */
    assets.list.mockReset().mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    });
    /*
      A VALASZTHATO KOLLEGAK MOCKJA MINDIG ALL, akkor is, ha az adott allitas
      nem delegal. A `useAssignableUsers` a `canManage` agon AZONNAL hiv, es
      egy hianyzo dupla nem "ures listat" adna, hanem a komponens indulasat
      vinne el.
    */
    sheets.assignableUsers.mockReset().mockResolvedValue({
      items: [
        { id: "user-sanyi", name: "Sanyi" },
        { id: "user-eva", name: "Éva" },
      ],
    });
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
   * A KÉT KIÚT KÜLÖN ÁLL, ÉS NEM HELYETTESÍTIK EGYMÁST.
   *
   * A láblécben álló „Mégsem" akkor kell, ha valaki végigolvasta az űrlapot; a
   * cím fölötti hivatkozás akkor, ha rossz lapra jött, és nem akar végiggörgetni
   * a mezők mellett. Egy állítás, ami csak az egyiket méri, zöld maradna akkor
   * is, ha a másik eltűnik - és a hiányt épp az venné észre, akinek kellett
   * volna.
   */
  it("a cím fölött és a láblécben is van kiút, és nem ugyanaz", async () => {
    render(<ServiceJobEditorPage />);
    await screen.findByText("Partner és helyszín");

    const fentre = screen.getByRole("link", { name: "Hibajegyek" });
    const megsem = screen.getByRole("link", { name: "Mégsem" });

    expect(fentre.getAttribute("href")).toBe("/szerviz/hibajegyek");
    expect(megsem.getAttribute("href")).toBe("/szerviz/hibajegyek");
    // KÉT KÜLÖN ELEM: ugyanoda visznek, de nem egy elem kétszer megtalálva.
    expect(fentre).not.toBe(megsem);
  });

  /**
   * A PARTNER ÉS A HELYSZÍN KÖTELEZŐ (Balázs döntése, 2026-09-23): a gomb
   * TILTOTT marad, amíg mindkettő hiányzik, és a felvitel nem hívódik meg.
   * Ez a TESZTVER-KONTROLLJA a lenti "a kiválasztott partner azonosítóját
   * küldi el" esetnek: a kettő együtt mondja ki, hogy a gomb TÉNYLEG a
   * kiválasztástól függ, nem mindig engedi át.
   */
  it("partner és helyszín nélkül a gomb tiltva marad, és nem hív felvitelt", async () => {
    render(<ServiceJobEditorPage />);

    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    const gomb = screen.getByRole("button", { name: "Hibajegy megnyitása" });
    expect((gomb as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(gomb);
    expect(api.create).not.toHaveBeenCalled();
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
   * A testver-kontroll a fenti "gomb tiltva marad" allitas: az egyik SEMMIT
   * nem kuld, mert a gomb tiltva van; ez a masik a valodi ertekeket kuldi,
   * miutan partner ES helyszin is meg van adva. A ketto egyutt mondja ki,
   * hogy a mezo TENYLEG a valasztastol fugg, nem mindig ugyanazt kuldi.
   */
  it("a kiválasztott partner azonosítóját küldi el", async () => {
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
    await waitFor(() =>
      expect(sheets.selectablePartners).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.change(await screen.findByLabelText("Helyszín"), {
      target: { value: "unit-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toEqual({
      title: "A hármas medence szivattyúja nem indul",
      description: null,
      customerId: "vevo-1",
      departmentId: "unit-1",
      assetIds: [],
      // AZ UJ MEZO URESEN IS ELMEGY, es ez szandekos: a szerver DTO-ja
      // elhagyhatonak veszi, de egy ures tomb KIMONDJA, hogy a felvivo nem
      // delegalt -- egy hianyzo mezo ugyanugy nezne ki, mint egy elveszett.
      assigneeIds: [],
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
    /*
      AZ UTOLSO KET ELEM NEM MEZO-FELIRAT, HANEM A DELEGALAS SORAI. A
      jelolonegyzeteket a `WorksheetAssigneePicker` rajzolja, es mindegyik a
      SAJAT feliratat viszi -- a csoport felirata ("Delegált kollégák") `span`,
      ugyanugy, mint az "Érintett eszközök"-e.

      ES EPP EZERT MER EZ TOBBET: a ket nev jelenlete a lista VEGEN azt
      bizonyitja, hogy a delegalas tenyleg a sorrend vegen all -- Balazs
      2026-09-14-i listaja szerint.
    */
    expect(feliratok).toEqual([
      "Partner",
      "Helyszín",
      "Mi a baj?",
      "Részletek",
      "Fényképek és fájlok",
      "Sanyi",
      "Éva",
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
  it("helyszin nelkuli partnernel kimondja, hogy egyelore nem nyithato jegy ra", async () => {
    render(<ServiceJobEditorPage />);
    // A CIM MEG VAN ADVA, hogy a gomb tiltasat KIZAROLAG a hianyzo helyszin
    // okozza -- kulonben a tiltas a cim hianyat is bizonyithatna.
    fireEvent.change(screen.getByLabelText("Mi a baj?"), {
      target: { value: "A hármas medence szivattyúja nem indul" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });

    expect(
      await screen.findByText(/Ehhez a partnerhez nincs felvéve helyszín/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Hibajegy megnyitása",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  /**
   * A KIVALASZTOTT HELYSZIN ELMEGY, TELJES UTTAL A LISTABAN.
   *
   * Az ut azert szamit, mert a kod es a nev csak TESTVEREK kozott egyedi: ket
   * kulonbozo ag alatt ugyanaz a "Biodom" megengedett, es a kezelo a rosszat
   * valasztana.
   */
  /**
   * A POZITIV KONTROLL A MOCKRA -- ES NEM DISZ.
   *
   * A tobbi allitas ures eszkoz-listaval fut, es egy URES lista UGYANUGY NEZ
   * KI, mint egy elhalt hivas: mindket esetben nincs jelolonegyzet a lapon.
   * Vagyis ha a dupla holnap csendben megszunne (atnevezes, elirt modulnev),
   * egyetlen meglevo allitas sem venne eszre.
   *
   * Ez az egy allitas koveteli meg, hogy a valaszto TENYLEG BETOLTSON: kiirja
   * a helyszin egy eszkozet, nev es leltari szam szerint. Ha a hivas elhal, a
   * lap a "nem tolthetok be" mondatra esik, es ez pirosodik ki.
   */
  it("helyszín választása után kiírja a helyszín eszközeit", async () => {
    sheets.departments.mockResolvedValue({
      items: [
        {
          id: "unit-1",
          parentId: null,
          code: "BIO",
          name: "Biodóm",
          isActive: true,
        },
      ],
    });
    assets.list.mockResolvedValue({
      items: [
        {
          id: "asset-1",
          assetNumber: "ESZK-000123",
          name: "Cápasuli kompresszor",
        },
      ],
      pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
    });

    render(<ServiceJobEditorPage />);
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.change(await screen.findByLabelText("Helyszín"), {
      target: { value: "unit-1" },
    });

    expect(await screen.findByText("Cápasuli kompresszor")).toBeTruthy();
    expect(screen.getByText("ESZK-000123")).toBeTruthy();
    // ES NEM A HIBA-AGON ALL: a ket mondat kozul pontosan az egyik igaz.
    expect(screen.queryByText(/nem tölthetők be/)).toBeNull();
  });

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
    // PARTNER ES HELYSZIN IS KELL, MERT MOSTANTOL KOTELEZO: enelkul a gomb
    // tiltva maradna, es ez a segedfuggveny minden felviteli tesztet aluliroana.
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
    fireEvent.change(await screen.findByLabelText("Mi a baj?"), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.change(await screen.findByLabelText("Helyszín"), {
      target: { value: "unit-1" },
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
  /**
   * A DELEGALAS A FELVITEL RESZE, EGY TRANZAKCIOBAN.
   *
   * Kulon lepesre bizva a felvivo azt hinne, kiadta a munkat, kozben a jegy
   * senki listajan nem jelenne meg -- es errol semmi nem szolna, mert a
   * delegalatlan jegy NEM hibas allapot.
   */
  it("a kiválasztott kollégákat a felvitellel együtt küldi", async () => {
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
    fireEvent.change(await screen.findByLabelText("Mi a baj?"), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.change(await screen.findByLabelText("Helyszín"), {
      target: { value: "unit-1" },
    });
    fireEvent.click(await screen.findByLabelText("Éva"));
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]).toMatchObject({
      assigneeIds: ["user-eva"],
    });
  });

  /**
   * A DELEGALAS EGYETLEN SZAKASZ AZ URLAPON, AMI A KIVALASZTAS PILLANATABAN
   * PARTNER NELKUL IS MUKODIK -- meg akkor is, ha a VEGSO felvitelhez ma mar
   * partner es helyszin is kell (Balazs dontese, 2026-09-23).
   *
   * A helyszin es az eszkoz a partnertol fugg; a kollega-jeloloneget viszont
   * meg lehet pipalni, mielott a tobbi mezot kitoltenenk -- ez a UI-sorrend
   * szabadsaga, nem a KULDES szabalya. A fenti "a kivalasztott kollegakat a
   * felvitellel egyutt kuldi" eset ma mar partnerrel es helyszinnel egyutt
   * fut (a gomb kulonben tiltva lenne), ez az allitas pedig kulon mondja ki,
   * hogy a jeloloneget MAR partner elott is el lehet erni.
   */
  it("partner nélkül is lehet kollégát választani, mielőtt a partnert kiválasztanánk", async () => {
    render(<ServiceJobEditorPage />);

    expect(await screen.findByText(/Előbb válassz partnert/)).toBeTruthy();

    const eva = await screen.findByLabelText("Éva");
    fireEvent.click(eva);
    expect((eva as HTMLInputElement).checked).toBe(true);
  });

  it("fájl nélkül nem hív feltöltést", async () => {
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
    fireEvent.change(await screen.findByLabelText("Mi a baj?"), {
      target: { value: "Nem indul a szivattyú" },
    });
    fireEvent.change(await screen.findByLabelText("Partner"), {
      target: { value: "vevo-1" },
    });
    fireEvent.change(await screen.findByLabelText("Helyszín"), {
      target: { value: "unit-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hibajegy megnyitása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  /**
   * AZ URLAPON A TET NEM A FRISSITES, HANEM A MENTES.
   *
   * Itt nincs "betoltott adat", amit a felhasznalo nezhetne: egy ures urlap
   * all. A ket megjelenito lap mondata (hogy a legutobb betoltott adatokat
   * latod) ezen a lapon MINDIG hamis lenne, kapcsolattal is. Ez az allitas
   * pontosan azt a tevesztest fogja meg.
   */
  it("kapcsolat nélkül az űrlapon a mentésről beszél, nem a frissítésről", async () => {
    setOnLine(false);
    render(<ServiceJobEditorPage />);

    expect(await savotMond("form")).toBeTruthy();
  });
});

/**
 * A KAPCSOLATOT VISSZA KELL ADNI, PEDIG A FAJL UTOLSO TESZTJEI OFFLINE FUTNAK.
 *
 * MERVE 2026-09-15: amikor ez a sor egy atalakitas kozben kiesett, a keszlet
 * ZOLD MARADT -- mert az offline tesztek eppen a fajl vegen allnak, tehat nem
 * fut utanuk semmi. A lyuk nem ma latszana, hanem annak, aki ide egy uj
 * tesztet ir: az halozat nelkuli vilagban indulna, es a pirosa nem arrol
 * szolna, amit megirt.
 */
afterEach(() => setOnLine(true));
