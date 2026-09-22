import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetStatus, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { JobAssetPicker } from "./job-asset-picker";

const assets = vi.hoisted(() => ({ list: vi.fn(), scanLabel: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/lib/api/assets", () => ({ assetsApi: assets }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function session(): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "szerelo@acropora.hu",
      displayName: "Szerelő Sándor",
      nickname: "Sanyi",
      role: "SERVICE",
      customerId: null,
      supplierId: null,
    },
  };
}

function asset(id: string, name: string, assetNumber: string) {
  return {
    id,
    assetNumber,
    name,
    kind: "EQUIPMENT" as const,
    /*
      AZ ALLAPOT A TIPUS SZERINT SZELES, NEM `as const`. A kivezetett eszkoz
      sajat aga van a kodrol valo hozzaadasnal, tehat a duplanak tudnia kell
      MAS allapotot is felvenni -- egy szukebb literal itt a TESZTET vagna el,
      nem a kodot.
    */
    status: "ACTIVE" as AssetStatus,
    criticality: "NORMAL" as const,
    /*
      A TULAJDONOS A VALODI MEZONEVEKET VISZI (`AssetOwnerSummary`): a
      matricakodrol talalt, MAS helyszinen allo eszkoz uzenete a
      `displayName` mezobol epul. Egy `name` nevu mezo itt zolden atmenne, es
      a kepernyon `undefined` latszana -- a dupla akkor hibas, ha a HIVO
      hasznal olyan erteket, amit a teszt nem allit.
    */
    owner: {
      type: "SUPPLIER" as const,
      id: "sup-1",
      code: "P-001",
      displayName: "Partner Kft.",
    },
  };
}

function valasz(items: ReturnType<typeof asset>[]) {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 100,
      totalItems: items.length,
      totalPages: 1,
    },
  };
}

describe("JobAssetPicker", () => {
  beforeEach(() => {
    auth.session = session();
    assets.list.mockReset().mockResolvedValue(valasz([]));
    assets.scanLabel.mockReset();
  });

  /**
   * HELYSZIN NELKUL NEM LISTAZUNK, ES EZT KI IS MONDJUK.
   *
   * Nem technikai korlat: a partner OSSZES eszkoze egy kivalaszthatatlan lista
   * lenne. A mondat megnevezi a teendot, ahelyett hogy egy ures valaszto allna
   * ott magyarazat nelkul -- pontosan az a hiba, amit a telefonos urlapon ma
   * mertunk (PR 636).
   */
  it("helyszin nelkul megmondja, hogy elobb helyszint kell valasztani", () => {
    render(
      <JobAssetPicker departmentId="" selected={[]} onChange={() => {}} />,
    );

    expect(screen.getByText(/Előbb válassz helyszínt/)).toBeTruthy();
    expect(assets.list).not.toHaveBeenCalled();
  });

  /**
   * A RESZFA SZUROJE A HIVASBAN. Az eszkoz a fa BARMELYIK csomopontjahoz
   * kotheto, tehat a pontos egyezes nema hibat adna: a "Biodom" alatti medencen
   * logo eszkoz kimaradna a listabol, es a lista attol meg szabalyosnak
   * latszana.
   */
  it("a valasztott helyszinre szurve ker listat", async () => {
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));
    const query = assets.list.mock.calls[0]?.[1] as URLSearchParams;
    expect(query.get("departmentId")).toEqual("unit-9");
    // A LAPMERET KIMONDVA: alapbol 25 sor jonne, es egy csendben levagott lista
    // itt a legrosszabb fajta hiba.
    expect(query.get("pageSize")).toEqual("100");
    /**
     * AZ ALLAPOT IS KIMONDVA, ES EZ EGY MERT HIBA ORZOJE.
     *
     * A parameter NELKUL a vegpont `ACTIVE`-ra szur, tehat a valaszto CSAK a
     * mukodo eszkozoket kinalta: a javitas alatt allo es a nem uzemelo
     * hianyzott, ES UGY, MINTHA NEM IS LETEZNE -- se ures lista, se hibauzenet.
     * Balazs merte vissza 2026-09-16-an.
     *
     * A NEGATIV FELE IS ALLITAS: ha valaki `ALL`-ra allitana, a KIVEZETETT
     * eszkozok is bejonnenek, es azokra uj hibajegyet nyitni ertelmetlen.
     */
    expect(query.get("status")).toEqual("IN_PLACE");
  });

  it("ures helyszinnel megmondja, hogy nincs nyilvantartott eszkoz", async () => {
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/Ezen a helyszínen nincs nyilvántartott eszköz/),
    ).toBeTruthy();
  });

  /**
   * TOBB ESZKOZ VALASZTHATO, es a valasztas FELFELE megy. A komponens nem
   * tarolja a halmazt: igy az urlap egyetlen helyen tudja, mit kuld el.
   */
  it("tobb eszkozt is fel lehet venni, egyesevel", async () => {
    assets.list.mockResolvedValue(
      valasz([
        asset("esz-1", "Szivattyú", "ESZ-0007"),
        asset("esz-2", "Fehérjelefölöző", "ESZ-0008"),
      ]),
    );
    const valasztas: string[][] = [];
    const { rerender } = render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );

    fireEvent.click(await screen.findByLabelText(/Szivattyú/));
    expect(valasztas[0]).toEqual(["esz-1"]);

    rerender(
      <JobAssetPicker
        departmentId="unit-9"
        selected={["esz-1"]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );
    fireEvent.click(await screen.findByLabelText(/Fehérjelefölöző/));
    expect(valasztas[1]).toEqual(["esz-1", "esz-2"]);
  });

  /**
   * A KALIBRACIO MASIK IRANYA: a felvetel allitasa akkor is zold lenne, ha a
   * kapcsolo csak hozzaadni tudna. Ez meri, hogy le is lehet venni.
   */
  it("a mar kivalasztott eszkozt le lehet venni", async () => {
    assets.list.mockResolvedValue(
      valasz([asset("esz-1", "Szivattyú", "ESZ-0007")]),
    );
    const valasztas: string[][] = [];
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={["esz-1"]}
        onChange={(ids) => valasztas.push(ids)}
      />,
    );

    fireEvent.click(await screen.findByLabelText(/Szivattyú/));
    expect(valasztas[0]).toEqual([]);
  });

  /**
   * A LELTARI SZAM A NEV MELLETT ALL. Ket azonos nevu szivattyu egy helyszinen
   * teljesen normalis, es a nev onmagaban akkor sem megkulonbozteto, ha ma
   * veletlenul az.
   */
  it("a leltari szamot is kiirja a nev melle", async () => {
    assets.list.mockResolvedValue(
      valasz([asset("esz-1", "Szivattyú", "ESZ-0007")]),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(await screen.findByText("ESZ-0007")).toBeTruthy();
  });

  /**
   * A LEVAGAS KIMONDVA. A vegpont felso hatara szaz sor: ha egy helyszinen
   * ennyi eszkoz all, a lista MAR hianyos lehet. Egy csendben levagott lista
   * rosszabb a hibanal -- a hianyzo eszkoz ugy nez ki, mintha nem letezne.
   */
  it("szaz sornal szol, hogy a lista hianyos lehet", async () => {
    assets.list.mockResolvedValue(
      valasz(
        Array.from({ length: 100 }, (_, index) =>
          asset(`esz-${index}`, `Eszköz ${index}`, `ESZ-${index}`),
        ),
      ),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/Száz eszköznél megáll a lista/),
    ).toBeTruthy();
  });

  /**
   * ES A TESTVER-KONTROLL: kilencvenkilenc sornal NEM szol. Enelkul az elozo
   * allitas akkor is zold lenne, ha a figyelmeztetes MINDIG ott allna.
   */
  it("szaz alatt nem figyelmeztet", async () => {
    assets.list.mockResolvedValue(
      valasz(
        Array.from({ length: 99 }, (_, index) =>
          asset(`esz-${index}`, `Eszköz ${index}`, `ESZ-${index}`),
        ),
      ),
    );
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    await screen.findByText("Eszköz 0");
    expect(screen.queryByText(/Száz eszköznél megáll a lista/)).toBeNull();
  });

  /**
   * A BETOLTESI HIBA SAJAT MONDATOT KAP, nem ures listat. Az "ures" es a "nem
   * sikerult lekerni" ket kulonbozo allapot, es a masodikbol a felhasznalonak
   * azt kell latnia, hogy ujra kell probalnia.
   */
  it("betoltesi hibanal kimondja, hogy nem tolthetok be", async () => {
    assets.list.mockRejectedValue(new Error("halozat"));
    render(
      <JobAssetPicker
        departmentId="unit-9"
        selected={[]}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByText(/A helyszín eszközei nem tölthetők be/),
    ).toBeTruthy();
  });

  /**
   * === A MATRICAKOD BEIRASA (Balazs kerese, 2026-09-16) ===
   *
   * Szo szerint: "a lista felett jo lenne ha a qr kod szamanak beirasara is
   * lehetoseg. termeszetesen valahogy ugy, hogy tobb eszkozt is be lehessen
   * vonni mint a checkboxos megoldasnal."
   */
  describe("matricakod", () => {
    async function beir(kod: string) {
      fireEvent.change(await screen.findByLabelText("Matricakód"), {
        target: { value: kod },
      });
      fireEvent.click(screen.getByText("Hozzáadás"));
    }

    function reszletek(
      over: Partial<ReturnType<typeof asset>> & Record<string, unknown> = {},
    ) {
      return {
        ...asset("esz-77", "Adagolószivattyú", "ESZ-0077"),
        unit: {
          id: "unit-4",
          code: "MED3",
          name: "Medence 3",
          path: ["Biodóm", "Medence 3"],
        },
        ...over,
      };
    }

    /**
     * A LISTAT KERDEZI, NEM A `scan-label` VEGPONTOT, ES A SZURO A HELYSZINRE
     * IS SZOL.
     *
     * Ez a lenyeg, es merven dolt el: a `scan-label` a kod -> eszkoz
     * lekepezest oldja fel, a RESZFA-TAGSAGOT nem (a valaszaban allo
     * `unit.path` NEVEKET hordoz, nem azonositokat). Ha a komponens csak azt
     * hivna, egy MASIK helyszin eszkozet is hozzaadna a jegyhez, es a mentes
     * bukna el -- akkor, amikor a felvivo mar keszen hiszi magat.
     */
    it("a kodot a helyszinre szurve, tarolhato alakban kerdezi le", async () => {
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={() => {}}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("v2196");

      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(2));
      const query = assets.list.mock.calls[1]?.[1] as URLSearchParams;
      // A KISBETUS ALAK FELFELE NORMALIZALVA MEGY KI. A leolvaso es a
      // billentyuzet mast adhat; a tarolt alak egyfele.
      expect(query.get("labelCode")).toEqual("V2196");
      expect(query.get("departmentId")).toEqual("unit-9");
      expect(query.get("status")).toEqual("IN_PLACE");
      // A VEGPONT ALSO HATARA TIZ (`@Min(10)`): egy `pageSize=1` hivas 400-zal
      // szallna el, es a felhasznalo egy ertelmetlen hibauzenetet latna.
      expect(Number(query.get("pageSize"))).toBeGreaterThanOrEqual(10);
    });

    /**
     * A KODROL TALALT ESZKOZ LATSZIK IS, NEM CSAK BEKERUL.
     *
     * EZ A LEGFONTOSABB ALLITAS EBBEN A KESZLETBEN. A lista SZAZ sornal
     * megall, es a kod-mezo EPP AZERT letezik, mert egy helyszinen ennel tobb
     * eszkoz allhat. Ha a talalat csak a kivalasztottak koze kerulne, a
     * jelolonegyzetes lista NEM mutatna meg -- a felvivo egy lathatatlan
     * valasztast vinne a jegyre, es semmi nem mondana meg neki, mit ad be.
     */
    it("a kodrol talalt eszkozt hozzaadja ES ki is irja, ha a lapon nincs rajta", async () => {
      assets.list
        .mockResolvedValueOnce(
          valasz([asset("esz-1", "Szivattyú", "ESZ-0007")]),
        )
        .mockResolvedValueOnce(valasz([reszletek()]));
      const valasztas: string[][] = [];
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={(ids) => valasztas.push(ids)}
        />,
      );
      await screen.findByLabelText(/Szivattyú/);

      await beir("V2196");

      expect(await screen.findByLabelText(/Adagolószivattyú/)).toBeTruthy();
      await waitFor(() => expect(valasztas[0]).toEqual(["esz-77"]));
      // A KORABBI SOR A HELYEN MARAD: a kod HOZZAAD, nem cserel.
      expect(screen.getByLabelText(/Szivattyú/)).toBeTruthy();
    });

    /**
     * AZ ENTER UGYANAZT TESZI, MINT A GOMB.
     *
     * Aki egy kodot begepel, Entert fog utni. Enelkul a billentyuzet nema
     * marad, es egy kesobbi urlapba helyezve az Enter CSENDBEN a felvitelt
     * inditana el -- fel jeggyel, egyetlen beirt kod utan.
     */
    it("az Enter is hozzaad", async () => {
      assets.list
        .mockResolvedValueOnce(valasz([]))
        .mockResolvedValueOnce(valasz([reszletek()]));
      const valasztas: string[][] = [];
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={(ids) => valasztas.push(ids)}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      const mezo = await screen.findByLabelText("Matricakód");
      fireEvent.change(mezo, { target: { value: "V2196" } });
      fireEvent.keyDown(mezo, { key: "Enter" });

      await waitFor(() => expect(valasztas[0]).toEqual(["esz-77"]));
    });

    /**
     * A ROSSZ ALAKU KOD MEG SEM INDUL EL A HALOZATON.
     *
     * A szerver ugyanezt mondana (`ASSET_LABEL_CODE_SHAPE_MESSAGE`, kozos
     * konstans), csak egy korrel kesobb. A mondat ugyanaz -- ket kulon leirt
     * szoveg pontosan ott csuszna el, ahol senki nem nezi.
     */
    it("rossz alaku kodnal meg sem kerdez, es megnevezi az alakot", async () => {
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={() => {}}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("V219");

      expect(await screen.findByText(/egy betű és négy szám/)).toBeTruthy();
      // A HALOZAT NEM MOZDULT: a lista-hivas szama valtozatlan.
      expect(assets.list).toHaveBeenCalledTimes(1);
      expect(assets.scanLabel).not.toHaveBeenCalled();
    });

    /**
     * A MAS HELYSZINEN ALLO ESZKOZ: NEM ADJUK HOZZA, ES KIMONDJUK, HOL ALL.
     *
     * A "nem talaltam" mondat itt HAZUGSAG lenne: az eszkoz letezik, es latjuk
     * is. A TELJES UT megy ki, nem az egyseg neve: a nev csak TESTVEREK kozott
     * egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodom" megengedett -- a
     * puszta nev azt a kepet adna, hogy a szerelo jo helyen jar.
     */
    it("mas helyszinen allo eszkozt nem ad hozza, es megnevezi a helyet", async () => {
      assets.list.mockResolvedValue(valasz([]));
      // A VALASZ 2026-09-22 OTA UNIO. A dupla ezt KOVETI, nem kerüli meg: egy
      // nyers `AssetDetail` mellett a hivo `eredmeny.asset` aga `undefined`-ot
      // olvasna, es a spec ROSSZ alakra allitana valamit.
      assets.scanLabel.mockResolvedValue({
        kind: "ASSET",
        asset: reszletek(),
      });
      const valasztas: string[][] = [];
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={(ids) => valasztas.push(ids)}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("V2196");

      const uzenet = await screen.findByText(/MÁS helyszínen áll/);
      expect(uzenet.textContent).toContain("Partner Kft.");
      expect(uzenet.textContent).toContain("Biodóm / Medence 3");
      expect(valasztas).toEqual([]);
      expect(screen.queryByLabelText(/Adagolószivattyú/)).toBeNull();
    });

    /**
     * A KIVEZETETT ESZKOZ SAJAT MONDATOT KAP.
     *
     * KULON AG, es nem szorszalhasogatas: a teendo MAS. A kivezetett eszkoz
     * mar fizikailag sincs a helyszinen, tehat uj hibajegyet nem kaphat -- a
     * masik helyszinen allora viszont OTT kell jegyet nyitni. Egy kozos mondat
     * a ket esetet osszemosna, es a helyszin-uzenet raadasul HAMIS lenne, ha az
     * eszkoz epp ITT all, csak kivezetve.
     */
    it("kivezetett eszkozre azt mondja, hogy kivezetett", async () => {
      assets.list.mockResolvedValue(valasz([]));
      assets.scanLabel.mockResolvedValue({
        kind: "ASSET",
        asset: reszletek({ status: "RETIRED" }),
      });
      const valasztas: string[][] = [];
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={(ids) => valasztas.push(ids)}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("V2196");

      expect(await screen.findByText(/ki van vezetve/)).toBeTruthy();
      // ES NEM ALLITJA, HOGY MASHOL ALLNA: a ket ag kulonbozik.
      expect(screen.queryByText(/MÁS helyszínen áll/)).toBeNull();
      expect(valasztas).toEqual([]);
    });

    /**
     * A SZABAD MATRICA SAJAT MONDATOT KAP -- ES EZ AZ, AMIT EDDIG NEM LEHETETT
     * MEGTUDNI.
     *
     * 2026-09-22-ig a vegpont a szabad kodra UGYANAZT a 404-et adta, mint egy
     * ismeretlen kodra. A kezelo tehat azt latta, hogy „nem talaltam", es a
     * MATRICAT hitte rossznak -- holott az ep, csak meg nincs eszkozhoz
     * ragasztva. A teendo is MAS: nem ujra beolvasni, hanem felvinni az
     * eszkozt ezzel a koddal.
     *
     * MI PIROSIT: ha a hivo a `FREE` tagot ugyanabba az agba ejti, mint a
     * talalatot vagy a hibat.
     */
    it("szabad matricara azt mondja, hogy meg nincs eszkozhoz rendelve", async () => {
      assets.list.mockResolvedValue(valasz([]));
      assets.scanLabel.mockResolvedValue({ kind: "FREE", code: "V2196" });
      const valasztas: string[][] = [];
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={(ids) => valasztas.push(ids)}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("V2196");

      expect(await screen.findByText(/még szabad/)).toBeTruthy();
      // ES NEM A MASIK KET MONDAT: a harom ag kulonbozik, es a teendo is.
      expect(screen.queryByText(/ki van vezetve/)).toBeNull();
      expect(screen.queryByText(/MÁS helyszínen áll/)).toBeNull();
      expect(valasztas).toEqual([]);
    });

    /**
     * A NEM LETEZO ES A NEM LATHATO KOD EGY MONDATOT KAP.
     *
     * A szerver sem kulonbozteti meg oket (`detailByLabelCode`): ha a ket
     * valasz eltérne, a valaszokbol felterkepezheto lenne, mely kodok vannak
     * kiadva es kihez tartoznak. Az olvasonak amugy is ugyanaz a teendoje.
     */
    it("ismeretlen kodra egy mondatot ad, es nem talalgat helyet", async () => {
      assets.list.mockResolvedValue(valasz([]));
      assets.scanLabel.mockRejectedValue(
        new ApiError(
          "Ehhez a matricakódhoz nem tartozik elérhető eszköz.",
          404,
        ),
      );
      render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={() => {}}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));

      await beir("V2196");

      expect(
        await screen.findByText(/nem tartozik elérhető eszköz/),
      ).toBeTruthy();
      expect(screen.queryByText(/MÁS helyszínen áll/)).toBeNull();
    });

    /**
     * A HELYSZIN VALTASA ELVISZI A KODROL HOZZAADOTT SORT.
     *
     * Enelkul egy masik helyszin listaja folott allna egy eszkoz, ami ott nincs
     * -- es a felvivo azt hinne, hogy ott is valaszthato.
     */
    it("helyszin valtasakor a kodrol hozzaadott sor eltunik", async () => {
      assets.list
        .mockResolvedValueOnce(valasz([]))
        .mockResolvedValueOnce(valasz([reszletek()]))
        .mockResolvedValue(valasz([]));
      const { rerender } = render(
        <JobAssetPicker
          departmentId="unit-9"
          selected={[]}
          onChange={() => {}}
        />,
      );
      await waitFor(() => expect(assets.list).toHaveBeenCalledTimes(1));
      await beir("V2196");
      await screen.findByLabelText(/Adagolószivattyú/);

      rerender(
        <JobAssetPicker
          departmentId="unit-5"
          selected={[]}
          onChange={() => {}}
        />,
      );

      await waitFor(() =>
        expect(screen.queryByLabelText(/Adagolószivattyú/)).toBeNull(),
      );
    });
  });
});
