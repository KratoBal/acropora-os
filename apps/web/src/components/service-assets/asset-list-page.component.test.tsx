import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { AssetListPage } from "./asset-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const suppliers = vi.hoisted(() => ({ units: vi.fn() }));
const categories = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
/*
  A KATEGORIA-LEKERDEZES MOCKJA NEM KENYELEM: nelkule a lap a VALODI
  klienst hivja, az pedig a `127.0.0.1:3000` cimre megy. A spec ettol nem
  bukik el (a lap elnyeli a hibat), csak CSENDBEN halozatot hasznal -- es egy
  futo fejlesztoi szerver mellett mar nem is elnyelne, hanem az OTT allo
  adatot hozna be a teszt-futasba.
*/
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: categories,
}));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

function response(page: number): AssetListResponse {
  return {
    items: [
      {
        id: "asset-1",
        assetNumber: "ESZ-0001",
        name: "Cápasuli kompresszor",
        kind: "EQUIPMENT",
        status: "ACTIVE",
        criticality: "NORMAL",
        qrToken: "qr-token-1",
        childCount: 0,
        updatedAt: "2026-08-19T10:00:00.000Z",
        owner: {
          type: "CUSTOMER",
          id: "customer-1",
          code: "VEVO-1",
          displayName: "Fővárosi Állat- És Növénykert",
        },
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
    // MINDEN ALLAPOT SZEREPEL, A NULLAS IS: a szerver igy adja vissza.
    counts: {
      ACTIVE: 40,
      WARM_STANDBY: 4,
      COLD_STANDBY: 2,
      IN_REPAIR: 12,
      RETIRED: 3,
    },
  };
}

function lastTarget() {
  const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(target.split("?")[1]);
}

function partnerResponse(unit?: {
  id: string;
  code: string;
  name: string;
  path: string[];
}): AssetListResponse {
  const base = response(1);
  return {
    ...base,
    items: [
      {
        ...base.items[0]!,
        owner: {
          type: "SUPPLIER",
          id: "supplier-1",
          code: "SZALL-1",
          displayName: "Fankó Kft.",
        },
        address: {
          id: "supplier:supplier-1",
          formatted: "1146 Budapest, Állatkerti krt. 6-12.",
        },
        unit,
      },
    ],
  };
}

describe("AssetListPage location cell", () => {
  beforeEach(() => {
    auth.session = session;
    api.list.mockReset();
    categories.list.mockReset();
    categories.list.mockResolvedValue({ items: [] });
  });

  /**
   * AMIT EZ AZ ALLITAS OR IZ: hogy a listaban a VALASZTOTT hely latszik, nem a
   * visszaeses. Ha a cella a cimet irna ki (ahogy a javitas elott tette),
   * ugyanaz a sor keletkezne egy pontositott es egy nem pontositott eszkozre --
   * es a kettot kivulrol semmi nem kulonboztetne meg.
   */
  it("shows the unit for a partner-owned asset", async () => {
    api.list.mockResolvedValue(
      partnerResponse({
        id: "unit-1",
        code: "BIO",
        name: "Biodóm",
        path: ["Fankó", "Biodóm"],
      }),
    );

    render(<AssetListPage />);

    // A TELJES UT latszik, nem a level neve: ket tavoli ag „Biodóm (BIO)"
    // egysege kulonben ugyanazt a kepet adna.
    expect(await screen.findByText("Fankó / Biodóm (BIO)")).toBeTruthy();
    expect(screen.queryByText(/Nincs pontosítva/)).toBeNull();
  });

  /** A masik fele: alegyseg nelkul a cim latszik, DE megjelolve, hogy ez nem
   * valasztas eredmenye. Enelkul a ket eset egyforma lenne. */
  it("marks the partner address as a fallback when no unit is set", async () => {
    api.list.mockResolvedValue(partnerResponse(undefined));

    render(<AssetListPage />);

    expect(
      await screen.findByText(/Nincs pontosítva\. 1146 Budapest/),
    ).toBeTruthy();
  });
});

describe("AssetListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2&status=ACTIVE");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
  });

  // A lapozás nem mehet a szűrő-ágon: az mindig page=1-et ír a végén, tehát
  // a "Következő" gomb csendben az első oldalra vitt vissza, és az első
  // oldalon túl semmi nem volt elérhető erről a képernyőről.
  it("moves forward instead of bouncing back to the first page", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("3");
  });

  it("steps back one page, not all the way to the start", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Előző" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
  });

  it("keeps the active filters while paging", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("ACTIVE");
  });

  // A szűrő viszont HELYESEN ugrik vissza az elsőre: egy másik szűrő
  // negyedik oldala jellemzően nem is létezik.
  //
  // A STÁTUSZ-VÁLASZTÓBÓL FÜL LETT (Balázs 2026-09-15-i designja), az állítás
  // viszont változatlan: nem a vezérlő fajtájáról szól, hanem arról, hogy a
  // státusz váltása visszaviszi a lapozást az elsőre.
  it("still returns to the first page when a filter changes", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("tab", { name: "Kivezetett" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
    expect(lastTarget().get("status")).toBe("RETIRED");
  });
});

describe("AssetListPage es az ugyfel sajat kodja", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset();
  });

  /**
   * A KERESES EDDIG IS NEZTE, A SOR VISZONT NEM MUTATTA. Az ugyfel felolvassa a
   * sajat kodjat, a talalat feljon, es semmi nem arulja el, MIRE illeszkedett --
   * a felhasznalo ilyenkor ugyanazt kerdezi meg megegyszer.
   */
  it("shows the customer's own code on the row when there is one", async () => {
    const withCode = response(1);
    withCode.items[0]!.inventoryNumber = "LT-4711";
    api.list.mockResolvedValue(withCode);

    render(<AssetListPage />);

    expect(await screen.findByText("LT-4711")).toBeTruthy();
    expect(screen.getByText(/Leltári szám/)).toBeTruthy();
  });

  /**
   * ES AMI NINCS, AZ NEM LESZ URES FELIRAT: egy "Leltári szám:" cimke ertek
   * nelkul azt allitana, hogy tudunk rola valamit.
   */
  it("writes no label at all when the asset has no such code", async () => {
    api.list.mockResolvedValue(response(1));

    render(<AssetListPage />);

    expect(await screen.findByText("ESZ-0001")).toBeTruthy();
    expect(screen.queryByText(/Leltári szám/)).toBeNull();
  });

  /**
   * A MATRICAKOD IS A SOROn, FELIRATTAL (Balazs kerese, 2026-09-18).
   *
   * MIERT KELL A FELIRAT, ES MIERT NEM DISZ: enelkul HAROM szam-alaku sor allna
   * egymas alatt (eszkozszam, leltari szam, matricakod), es a kezelo nem tudna,
   * melyik melyik. Ugyanaz az indok, ami a leltari szamnal all felette.
   *
   * ES A KOD MAGA IS ALLITAS: a lista valasza sokaig NEM hordozta a mezot (az
   * `AssetDetail`-en allt, az `AssetListItem`-en nem). Ez az allitas tehat nem
   * csak a megjelenitest meri, hanem azt is, hogy a sor egyaltalan MEGKAPJA.
   */
  it("shows the printed label code on the row when there is one", async () => {
    const withLabel = response(1);
    withLabel.items[0]!.labelCode = "V2196";
    api.list.mockResolvedValue(withLabel);

    render(<AssetListPage />);

    expect(await screen.findByText("V2196")).toBeTruthy();
    expect(screen.getByText(/Matricakód/)).toBeTruthy();
  });

  /**
   * ES MATRICA NELKUL NINCS FELIRAT SEM -- testver-kontroll a fentihez.
   *
   * Egy "Matricakód:" cimke ertek nelkul azt allitana, hogy all matrica az
   * eszkozon, csak nem tudjuk, melyik.
   */
  it("writes no label-code row when the asset has no sticker", async () => {
    api.list.mockResolvedValue(response(1));

    render(<AssetListPage />);

    expect(await screen.findByText("ESZ-0001")).toBeTruthy();
    expect(screen.queryByText(/Matricakód/)).toBeNull();
  });
});

/**
 * AZ "OSSZES" CSEMPE VISSZAKAPCSOLASA, es ez a lap legcsendesebb csapdaja.
 *
 * A szerveren a `status` ALAPERTELMEZESE `ACTIVE` (`AssetListQueryDto`), nem az
 * "osszes". Egy kikapcsolt csempe tehat NEM hagyhatja el a parametert: aki
 * masodszor is ranyom az "Összes"-re, csendben az aktiv eszkozok listajat
 * kapna vissza -- ugyanaz a kepernyo, keszebb lista, semmi jelzes.
 */
describe("AssetListPage állapot-csempék", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
  });

  it("a kiválasztott csempe második kattintásra ALL-t ír, nem üreset", async () => {
    navigation.params = new URLSearchParams("status=ALL");
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(
      screen.getByRole("button", { name: /Nyilvántartott eszköz/ }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("ALL");
  });

  it("a csempe kattintásra a saját állapotára szűr", async () => {
    navigation.params = new URLSearchParams();
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: /Javítás alatt/ }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("IN_REPAIR");
  });
});

/**
 * A CSEMPEK SZAMAI A SZERVER VALASZABOL JONNEK, NEM A LAPBOL.
 *
 * Korabban harom kulon lista-hivas adta oket; mostantol a lista sajat valasza
 * hozza (`counts`). Az allitas azt meri, hogy tenyleg ONNAN, es nem valamelyik
 * kezreeso masik szambol.
 *
 * A FIXTURE SZANDEKOSAN UGY ALL, hogy a negy allapot osszege (61) NE egyezzen a
 * `pagination.totalItems`-szel (60). Egyezo szamokkal az allitas akkor is zold
 * lenne, ha a csempe a lapozas osszdarabszamat mutatna -- vagyis nem
 * kulonboztetne meg a ket forrast, es pont azt nem merne, amiert megirtam.
 */
describe("AssetListPage csempe-számok", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
  });

  it("a csempék a válasz counts mezőjéből olvasnak", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    // Javítás alatt: 12, Aktívan üzemel: 40 -- kozvetlenul a valaszbol.
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
  });

  /**
   * AZ "OSSZES" A NEGY ALLAPOT OSSZEGE. Igy egy jovobeli uj allapot magatol
   * beleszamit, es nem marad ki egy elfelejtett szerver-mezobol.
   */
  it("az Összes csempe a négy állapot összegét mutatja, nem a lapozás számát", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    expect(screen.getByText("61")).toBeTruthy();
    expect(screen.queryByText("60")).toBeNull();
  });
});

/**
 * A SAV A LAP ALLAPOTAROL BESZEL, NEM A KAPCSOLATROL -- ES A HELYES SZAM NEM
 * EGY, HANEM ANNYI, AHANY ALLAPOTBA A LAP BE TUD KERULNI.
 *
 * Ez a lap kettobe: `data ? loaded : empty`. A ket allitas EGYUTT fogja meg a
 * rogzult valasztast; kulon-kulon egyik sem. Egy lap, ami mindig `loaded`-ot
 * ad, a tipusellenorzesen ES az elso allitason is atmegy, es hideg
 * betolteskor azt mondana, hogy "a legutobb betoltott adatokat latod",
 * miközben a kepernyo ures.
 */
describe("AssetListPage kapcsolat nélkül", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
    setOnLine(false);
  });

  afterEach(() => setOnLine(true));

  it("betöltött listánál a frissítésről beszél", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    // SOHA NEM TELJESULO valasz: a lap a "meg semmi nem toltodott be"
    // allapotban marad, vagyis pont abban, amirol a masodik mondat szol.
    api.list.mockReset().mockReturnValue(new Promise(() => {}));
    render(<AssetListPage />);

    expect(await savotMond("empty")).toBeTruthy();
  });
});

/**
 * AZ OSZLOPOK SZERINTI RENDEZES (Balazs kerese, 2026-09-16).
 *
 * === MIT MER EZ A FAJL, ES MIT NEM ===
 *
 * Azt meri, hogy a KATTINTAS a CIMBE ir, es hogy mit ir. Hogy a szerver ettol
 * tenyleg maskepp rendez, az az `asset-list-order.spec.ts` es az adatbazis
 * dolga. A ketto kozott az a kapocs, hogy a lap a `params` tartalmat ADJA
 * TOVABB a lekerdezesnek -- ezt egy kulon allitas meri lent.
 *
 * === MIERT A CIMBE, ES NEM KOMPONENS-ALLAPOTBA ===
 *
 * Mert a lista LAPOZVA jon. Egy komponens-allapotban tartott rendezes az epp
 * betoltott huszonot sort rendezne, es ugy nezne ki, mintha az egeszet tenne.
 */
describe("AssetListPage rendezés", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset();
    api.list.mockResolvedValue(response(1));
  });

  it("első kattintásra növekvő sorrendet kér, és az első lapra ugrik", async () => {
    render(<AssetListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Eszköz/ }));

    const cim = lastTarget();
    expect(cim.get("sort")).toBe("name");
    expect(cim.get("direction")).toBe("asc");
    // MAS RENDEZES MAS SOROKAT TESZ A HARMADIK LAPRA: a regi lapszamot
    // megtartva a felhasznalo a lista kozepere esne, latszolag veletlen
    // tartalomra.
    expect(cim.get("page")).toBe("1");
  });

  it("másodszorra megfordítja az irányt", async () => {
    navigation.params = new URLSearchParams("sort=name&direction=asc");
    render(<AssetListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Eszköz/ }));

    expect(lastTarget().get("direction")).toBe("desc");
  });

  /**
   * A HARMADIK KATTINTAS VISSZAAD AZ ALAPERTELMEZESRE, es ez nem kenyelmi
   * reszlet: enelkul NINCS UT VISSZA. Aki egyszer rendezett, annak a lap
   * onnantol csak a ket sajat iranya kozott valtana, es az eredeti sorrend
   * csak kezi cim-szerkesztessel lenne elerheto.
   */
  it("harmadszorra elengedi a rendezést", async () => {
    navigation.params = new URLSearchParams("sort=name&direction=desc");
    render(<AssetListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Eszköz/ }));

    const cim = lastTarget();
    expect(cim.has("sort")).toBe(false);
    expect(cim.has("direction")).toBe(false);
  });

  /**
   * A KAPOCS A SZERVER FELE. Ez az allitas koti ossze a cimet a lekerdezessel:
   * enelkul mind a harom fenti allitas zold lenne akkor is, ha a rendezes
   * SOHA nem jutna el a szerverig -- a cim szepen valtozna, a lista nem.
   */
  it("a címben álló rendezést továbbadja a szervernek", async () => {
    navigation.params = new URLSearchParams("sort=status&direction=desc");
    render(<AssetListPage />);

    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const kuldott = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(kuldott.get("sort")).toBe("status");
    expect(kuldott.get("direction")).toBe("desc");
  });

  /**
   * A KET OSSZETETT OSZLOP SZANDEKOSAN NEM KATTINTHATO.
   *
   * Egyik sem EGY adat (a "Hierarchia" a szulo neve vagy a reszegysegek szama,
   * a "Muszaki azonosito" harom mezo osszefuzve), tehat eloszb el kell donteni,
   * MIT jelent a rendezes. Egy kattinthato fejlec addig olyan sorrendet adna,
   * ami mukodonek latszik, de olvashatatlan.
   *
   * ES EZ AZ ALLITAS ORZI, hogy valaki "teljesseg kedveert" fel ne tegye oket
   * dontes nelkul.
   */
  it("az összetett oszlopok nem kattinthatók", async () => {
    render(<AssetListPage />);

    await screen.findByRole("button", { name: /Eszköz/ });
    expect(screen.queryByRole("button", { name: /Hierarchia/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Műszaki azonosító/ }),
    ).toBeNull();
  });

  /**
   * AZ ALLAPOT LATSZIK IS, NEM CSAK MUKODIK. Egy nyil nelkuli kattinthato
   * fejlec ugyanugy nez ki rendezes elott es utan.
   */
  it("a rendezett oszlop megjelöli magát", async () => {
    navigation.params = new URLSearchParams("sort=placement&direction=desc");
    render(<AssetListPage />);

    const fejlec = (await screen.findByText("Elhelyezés")).closest("th");
    expect(fejlec?.getAttribute("aria-sort")).toBe("descending");
    // TESTVER-KONTROLL: a TOBBI oszlop NEM jeloli magat. Enelkul az allitas
    // akkor is zold lenne, ha minden fejlec ugyanazt mondana.
    expect(
      (await screen.findByText("Eszköz"))
        .closest("th")
        ?.getAttribute("aria-sort"),
    ).toBe("none");
  });
});

/**
 * A BEEPITETT FUL: minden, KIVEVE a kivezetetteket.
 *
 * Balazs kerese, 2026-09-16: "ide szeretnek egy Beepitett opciot meg amiben
 * minden benne van kiveve a kivezetett eszkozok".
 *
 * AMIT EZ MER, ES AMIT NEM: hogy a ful letezik es a HELYES erteket teszi a
 * cimbe. Hogy a szerver ettol tenyleg a kivezetetteket hagyja ki, azt az
 * `asset-status-filter.spec.ts` meri -- ott all a tagadas alakja is.
 */
describe("AssetListPage Beépített szűrő", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset();
    api.list.mockResolvedValue(response(1));
  });

  /*
    A KIINDULOALLAPOT 2026-09-18-TOL `ACTIVE`, ES EZ NEM A TESZT GYENGITESE.

    Az allitas UGYANAZT mondja, mint eddig: a ful az `IN_PLACE` erteket teszi a
    cimbe. Ami megvaltozott, az a FELULET ALAPERTELMEZESE: Balazs kerese ota
    ures cim mellett MAR a "Beepitett" a kivalasztott ful -- es egy MAR
    kivalasztott fulre kattintva a kapcsolo-viselkedes `ALL`-t ir, nem `IN_PLACE`-t.

    Ures cimbol indulva tehat ez az allitas azt merne, hogy a ful ki tud-e
    KAPCSOLNI, nem azt, hogy be tud-e. Egy masik fulrol indulva ugyanazt meri,
    amit eddig.
  */
  it("a fül az IN_PLACE értéket teszi a címbe", async () => {
    navigation.params = new URLSearchParams("status=ACTIVE");
    render(<AssetListPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Beépített" }));

    expect(lastTarget().get("status")).toBe("IN_PLACE");
  });

  /**
   * TESTVER-KONTROLL: a szuro ELJUT a szerverig. Az elso allitas akkor is zold
   * lenne, ha a cimbe irt ertek sehova nem menne tovabb.
   */
  it("a címben álló szűrőt továbbadja a szervernek", async () => {
    navigation.params = new URLSearchParams("status=IN_PLACE");
    render(<AssetListPage />);

    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const kuldott = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(kuldott.get("status")).toBe("IN_PLACE");
  });

  /**
   * ES A MEGLEVO FULEK NEM MOZDULTAK. Egy uj ful beszurasa a legkonnyebben ugy
   * ront el valamit, hogy egy masikat kiszorit vagy atnevez -- ezt semmi nem
   * jelezné, mert mindegyik ugyanugy nez ki.
   *
   * 2026-09-16: a "Nem uzemel" ful HELYERE ket ful lepett ("Meleg tartalek",
   * "Hideg tartalek"), Balazs kerese szerint. Ez az allitas pirosra fordult, es
   * ez a HELYES viselkedes: a regi felirat eltunese pontosan az a valtozas,
   * amit ennek az allitasnak eszre kell vennie.
   */
  it("a többi fül változatlanul ott van", async () => {
    render(<AssetListPage />);

    for (const nev of [
      "Összes",
      "Beépített",
      "Aktív",
      "Javítás alatt",
      "Meleg tartalék",
      "Hideg tartalék",
      "Kivezetett",
    ])
      expect(await screen.findByRole("tab", { name: nev })).toBeTruthy();
  });

  /**
   * ES A REGI FELIRAT TENYLEG ELTUNT -- TESTVER-KONTROLL A FENTIHEZ.
   *
   * A fenti allitas csak azt meri, hogy a het felirat OTT VAN. Egy nyolcadik,
   * ottfelejtett "Nem uzemel" ful mellett is zold maradna -- es a felhasznalo
   * ket olyan fulet latna, amik kozul az egyik egy mar nem letezo allapotra
   * szurne, ures listat adva.
   */
  it("a régi „Nem üzemel\u201d fül NINCS többé", () => {
    render(<AssetListPage />);

    expect(screen.queryByRole("tab", { name: "Nem üzemel" })).toBeNull();
  });
});

describe("AssetListPage oldalmeret es alapertelmezett szuro", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
  });

  /**
   * A VALASZTAS VISSZAVISZ AZ ELSO OLDALRA -- EZ A LENYEG, NEM A MERET.
   *
   * Ez a funkcio leggyakoribb nema hibaja: aki a 7. oldalon all 25-osevel es
   * 100-ra valt, olyan oldalszamon maradna, ami MAR NEM LETEZIK. A lista
   * uresen jonne vissza, es az ugy nez ki, mintha nem lenne eszkoze -- nem
   * hibazik, csak hazudik.
   *
   * MI PIROSIT: ha a valaszto megkerulné a `filter()` segedet (az allitja
   * vissza a lapot), es kozvetlenul irna a cimbe.
   */
  it("a lapmeret valtasa az ELSO oldalra visz vissza", async () => {
    navigation.params = new URLSearchParams("page=7&pageSize=25");
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.change(screen.getByLabelText("Hány eszköz egy oldalon"), {
      target: { value: "100" },
    });

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("pageSize")).toBe("100");
    expect(lastTarget().get("page")).toBe("1");
  });

  /**
   * ES AZ ERTEK EL IS JUT A LEKERDEZESIG, nem csak a cimbe.
   *
   * KULON ALLITAS, MERT KULON ROMLIK EL: a cim attol meg helyes lehet, hogy a
   * keres a regi merettel megy ki -- a felhasznalo 100-at valaszt, es 25 sort
   * kap. A fenti allitas ezt nem latja, mert az csak a cimet nezi.
   */
  it("a valasztott lapmeret a LEKERDEZESBE is bekerul", async () => {
    navigation.params = new URLSearchParams("pageSize=100");
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    const query = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(query.get("pageSize")).toBe("100");
  });

  /**
   * A HAROM ERTEK KOTOTT, es ez a szerver felso hatarabol kovetkezik: a vegpont
   * `@Max(100)`-at ker. Egy szabadon beirt 200 nem tobb sort adna, hanem
   * validacios hibat -- a kezelo pedig nem ertene, miert.
   */
  it("pontosan harom lapmeret valaszthato: 25, 50, 100", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    const valaszto = screen.getByLabelText(
      "Hány eszköz egy oldalon",
    ) as HTMLSelectElement;
    expect([...valaszto.options].map((option) => option.value)).toEqual([
      "25",
      "50",
      "100",
    ]);
  });

  /**
   * AZ ALAPERTELMEZETT SZURO A "BEEPITETT", NEM AZ "AKTIV".
   *
   * Balazs kerese (2026-09-18): "ha betoltom az eszkozok listat akkor a
   * beepitett legyen alapbol kivalasztva".
   *
   * ES A LEKERDEZESEN ALLITJUK, NEM A CIMEN: a cim attol meg tartalmazhat
   * `IN_PLACE`-t, hogy a keres mast visz ki. A felhasznalo azt latja, ami a
   * VALASZBAN jon.
   */
  it("elso betoltesnel a BEEPITETT szuro megy ki, nem az Aktiv", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    const query = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(query.get("status")).toBe("IN_PLACE");
  });

  /**
   * ES A MELLEKHATAS, KIMONDVA: a MAR AKTIV szurore kattintva ALL lesz.
   *
   * Ez a csempe- es ful-viselkedes kapcsolo alaku, es az uj alapertelmezessel
   * azt jelenti, hogy a "Beepitett" fulre kattintva az OSSZES lista jon. Nem en
   * dontottem el, hogy igy legyen -- a viselkedes a valtozas ELOTT is ez volt,
   * csak masik kulcsra. Az allitas azert all itt, hogy ha valaha megvaltozik,
   * az DONTES legyen, ne mellekhatas.
   */
  it("a mar kivalasztott Beepitett fulre kattintva ALL lesz", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("tab", { name: "Beépített" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("ALL");
  });

  /**
   * A HIBA ES AZ URES EREDMENY NEM UGYANAZ -- ES EDDIG UGYANUGY NEZETT KI.
   *
   * A helyszin-szuro panelje `unitRows.length > 0` mellett rajzolodik, tehat egy
   * sikertelen lekerdezes utan EGYSZERUEN ELTUNIK. A kezelo abbol azt olvassa
   * ki, hogy a partnernek nincs helyszine -- nem azt, hogy most nem tudtuk
   * lekerdezni. Offline ez lenne az ALAPHELYZET, nem a kivetel.
   *
   * A KET ALLITAS EGYUTT ER VALAMIT: az elso azt meri, hogy a hiba LATSZIK, a
   * masodik azt, hogy az URES eredmeny NEM ad hamis riasztast. Egyik nelkul a
   * masik egy olyan komponensen is teljesulne, ami MINDIG (vagy soha) kiirja.
   */
  describe("a helyszín-szűrő hibája megkülönböztethető az ürestől", () => {
    const UZENET = /A helyszín-szűrő most nem tölthető be/;

    beforeEach(() => {
      navigation.params = new URLSearchParams({
        ownerType: "SUPPLIER",
        ownerId: "supplier-1",
      });
    });

    it("HIBÁNÁL kiírja, hogy nem tölthető be", async () => {
      suppliers.units.mockRejectedValue(new Error("hálózati hiba"));

      render(<AssetListPage />);
      await screen.findByText("Cápasuli kompresszor");

      expect(await screen.findByText(UZENET)).toBeTruthy();
    });

    it("ÜRES eredménynél NEM ír ki semmit", async () => {
      suppliers.units.mockResolvedValue({ items: [] });

      render(<AssetListPage />);
      await screen.findByText("Cápasuli kompresszor");

      expect(screen.queryByText(UZENET)).toBeNull();
    });

    it("a saját LEMONDÁSUNK nem hiba", async () => {
      /*
        Az `AbortError` akkor keletkezik, amikor a hatas ujrafut es lemondjuk az
        elozo kerest. Ha azt is hibanak vennenk, a mondat egy SZOKASOS
        allapotban jelenne meg -- es egy figyelmeztetes, ami mindig ott van,
        ugyanaz, mint ami soha.
      */
      suppliers.units.mockRejectedValue(
        new DOMException("megszakítva", "AbortError"),
      );

      render(<AssetListPage />);
      await screen.findByText("Cápasuli kompresszor");

      expect(screen.queryByText(UZENET)).toBeNull();
    });
  });
});
