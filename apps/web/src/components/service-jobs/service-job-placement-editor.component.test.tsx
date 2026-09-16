import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServiceJobAssetLink } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobPlacementEditor } from "./service-job-placement-editor";

const jobs = vi.hoisted(() => ({ setPlacement: vi.fn() }));
const sheets = vi.hoisted(() => ({ departments: vi.fn() }));

vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: jobs }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));

/**
 * A VALASZTO DUPLAJA, ES AMIERT ITT EZ A HELYES.
 *
 * A `JobAssetPicker`-nek SAJAT keszlete van (a matricakod, a szaz soros
 * levagas, a negy valasz mind ott merve). Ez a fajl a DOBOZT meri: hogy a
 * valasztobol jovo halmaz hogyan lesz mentesse, es mi tortenik a leeso
 * eszkozokkel.
 *
 * A DUPLA A VARRAT TELJES SZERZODESET VISZI: mind a harom bemenetet
 * (`departmentId`, `selected`, `onChange`) latszova teszi, tehat ha a doboz
 * elfelejtene atadni a helyszint, az ITT pirosodik -- nem csak a valodi
 * komponens tesztjeben.
 */
vi.mock("./job-asset-picker", () => ({
  JobAssetPicker: ({
    departmentId,
    selected,
    onChange,
  }: {
    departmentId: string;
    selected: readonly string[];
    onChange: (ids: string[]) => void;
  }) => (
    <div>
      <span data-testid="valaszto-helyszin">{departmentId}</span>
      <span data-testid="valaszto-kijeloles">{selected.join(",")}</span>
      <button type="button" onClick={() => onChange([])}>
        MIND LE
      </button>
      {/*
        HOZZAAD, NEM CSEREL -- ugyanaz, amit a valodi valaszto tesz egy
        jelolonegyzet bekapcsolasakor. Egy cserelo dupla itt csendben LEESO
        eszkozt gyartana, es a lenti allitas mast merne, mint a neve.
      */}
      <button type="button" onClick={() => onChange([...selected, "esz-9"])}>
        UJAT VALASZT
      </button>
    </div>
  ),
}));

function egyseg(id: string, code: string, name: string, parentId = null) {
  return { id, code, name, parentId, isActive: true };
}

function eszkoz(assetId: string, name: string, num: string) {
  return {
    id: `link-${assetId}`,
    assetId,
    assetNumber: num,
    assetName: name,
    attachedAt: "2026-09-15T08:00:00.000Z",
  } satisfies ServiceJobAssetLink;
}

function alap(over: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    token: "token-1",
    customerId: "vevo-1",
    departmentId: "unit-9",
    departmentPath: ["Biodóm", "Nagy medence"],
    assets: [eszkoz("esz-1", "Szivattyú", "ESZ-0007")],
    canManage: true,
    onSaved: () => {},
    ...over,
  } as React.ComponentProps<typeof ServiceJobPlacementEditor>;
}

describe("ServiceJobPlacementEditor", () => {
  beforeEach(() => {
    jobs.setPlacement.mockReset();
    sheets.departments.mockReset().mockResolvedValue({
      items: [
        egyseg("unit-9", "NMD", "Nagy medence"),
        egyseg("unit-5", "KMD", "Kis medence"),
      ],
    });
  });

  /**
   * A MAI ALLAPOT AKKOR IS LATSZIK, HA A HIVO NEM SZERKESZTHET.
   *
   * Ez a doboz mutatja meg eloszor a jegy eszkozeit EGYBEN: eddig azok csak a
   * naploban jelentek meg, esemenykent. Es a ket jog ugyanaz, amit a szerver
   * kulonboztet: `service.view` olvas, `service.manage` ir.
   */
  it("olvasó hívónál kiírja a helyszínt és az eszközöket, de nem ad szerkesztőt", async () => {
    render(<ServiceJobPlacementEditor {...alap({ canManage: false })} />);

    expect(screen.getByText(/Biodóm \/ Nagy medence/)).toBeTruthy();
    expect(screen.getByText("Szivattyú")).toBeTruthy();
    expect(screen.queryByLabelText("Helyszín")).toBeNull();
    // ES A HELYSZIN-LISTAT LE SEM KERI: olvasonak nincs mibol valasztania.
    expect(sheets.departments).not.toHaveBeenCalled();
  });

  /**
   * PARTNER NELKUL KULON MONDAT, MERT MAS A TEENDO: nem "ismeretlen egyseg",
   * hanem ertelmetlen keres -- helyszine csak partnernek van.
   */
  it("partner nélküli jegyen megmondja, hogy előbb partner kell", async () => {
    render(<ServiceJobPlacementEditor {...alap({ customerId: null })} />);

    expect(
      await screen.findByText(/még nincs partner, ezért helyszínt sem/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Helyszín")).toBeNull();
  });

  /**
   * A HELYSZIN NEM URITHETO -- ES EZ A VALASZTOBAN IS LATSZIK.
   *
   * Egy "Nincs megadva" opcio, amit a szerver 400-zal utasit el, rosszabb a
   * hianyanal: a felhasznalo azt hiszi, elromlott valami.
   */
  it("meglévő helyszínnél nincs üres opció a választóban", async () => {
    render(<ServiceJobPlacementEditor {...alap()} />);

    const valaszto = (await screen.findByLabelText(
      "Helyszín",
    )) as HTMLSelectElement;
    const ertekek = [...valaszto.options].map((option) => option.value);
    // A SORRENDRE NEM ALLITUNK: azt a `buildSiteOptions` adja (nev szerint), es
    // ez az allitas nem arrol szol. Amit merunk: NINCS ures ertek.
    expect(ertekek).not.toContain("");
    expect([...ertekek].sort()).toEqual(["unit-5", "unit-9"]);
  });

  /**
   * ES A TESTVER-KONTROLL: helyszin NELKULI jegyen VAN ures opcio.
   *
   * Enelkul az elozo allitas akkor is zold lenne, ha a valaszto SOHA nem
   * kinalna ures erteket -- es akkor egy helyszin nelkuli jegyen a mezo
   * azonnal egy talalomra valasztott egyseget mutatna.
   */
  it("helyszín nélküli jegyen van üres opció", async () => {
    render(
      <ServiceJobPlacementEditor
        {...alap({ departmentId: null, departmentPath: null, assets: [] })}
      />,
    );

    const valaszto = (await screen.findByLabelText(
      "Helyszín",
    )) as HTMLSelectElement;
    expect(valaszto.options[0]?.value).toEqual("");
  });

  /**
   * EZ A LENYEG: A LEESO ESZKOZT MEGNEVEZZUK, ES MEGEROSITES NELKUL NEM KULDUNK.
   *
   * A szerver ugyanezt utasitana el, csak egy korrel kesobb es egy olyan
   * hibaval, amit a kepernyon semmi nem magyaraz. A kerdes ITT dol el, es ami
   * belole kijon, az utazik a keresben -- a szerver tehat soha nem szed le
   * olyat, amit a felhasznalo nem latott.
   */
  it("leeső eszköznél kérdez, megnevezi, és addig nem ment", async () => {
    render(<ServiceJobPlacementEditor {...alap()} />);
    await screen.findByLabelText("Helyszín");

    fireEvent.click(screen.getByText("MIND LE"));
    fireEvent.click(screen.getByText(/Helyszín és eszközök mentése/));

    const kerdes = await screen.findByText(/Az új helyszínen nem áll/);
    expect(kerdes.textContent).toContain("Szivattyú");
    expect(kerdes.textContent).toContain("ESZ-0007");
    expect(jobs.setPlacement).not.toHaveBeenCalled();
  });

  /**
   * ES A MEGEROSITES UTAN LEMEGY, AZ UJ HELYSZINNEL ES A MARADEK LISTAVAL.
   *
   * Egy allitas, ami csak a kerdes MEGJELENESET meri, akkor is zold lenne, ha a
   * megerosites gombja semmit nem csinalna.
   */
  it("megerősítés után elküldi az új helyszínt és a maradék listát", async () => {
    jobs.setPlacement.mockResolvedValue({ id: "job-1" });
    const mentett: unknown[] = [];
    render(
      <ServiceJobPlacementEditor
        {...alap({ onSaved: (detail: unknown) => mentett.push(detail) })}
      />,
    );
    await screen.findByLabelText("Helyszín");

    fireEvent.change(screen.getByLabelText("Helyszín"), {
      target: { value: "unit-5" },
    });
    fireEvent.click(screen.getByText("MIND LE"));
    fireEvent.click(screen.getByText(/Helyszín és eszközök mentése/));
    fireEvent.click(await screen.findByText("Mentés"));

    await waitFor(() => expect(jobs.setPlacement).toHaveBeenCalledTimes(1));
    expect(jobs.setPlacement.mock.calls[0]?.[2]).toEqual({
      departmentId: "unit-5",
      assetIds: [],
    });
    // A VALASZ A TELJES RESZLETLAP: nem toltunk ujra, a hivo ezt teszi be.
    await waitFor(() => expect(mentett).toEqual([{ id: "job-1" }]));
  });

  /**
   * ES A TESTVER-KONTROLL: HA NINCS LEESO ESZKOZ, NINCS KERDES.
   *
   * Egy megerosito ablak, ami minden mentesnel felugrik, harom nap alatt
   * lathatatlanna valik -- es akkor azt sem olvassa el senki, amikor
   * tenylegesen leesik valami.
   */
  it("leeső eszköz nélkül nem kérdez, hanem azonnal ment", async () => {
    jobs.setPlacement.mockResolvedValue({ id: "job-1" });
    render(<ServiceJobPlacementEditor {...alap()} />);
    await screen.findByLabelText("Helyszín");

    fireEvent.click(screen.getByText("UJAT VALASZT"));
    fireEvent.click(screen.getByText(/Helyszín és eszközök mentése/));

    await waitFor(() => expect(jobs.setPlacement).toHaveBeenCalledTimes(1));
    expect(jobs.setPlacement.mock.calls[0]?.[2]).toEqual({
      departmentId: "unit-9",
      assetIds: ["esz-1", "esz-9"],
    });
    expect(screen.queryByText(/Az új helyszínen nem áll/)).toBeNull();
  });

  /**
   * A VALASZTO A KIVALASZTOTT HELYSZINT KAPJA, NEM A JEGYET.
   *
   * Enelkul a helyszin atallitasa utan a valaszto MEG MINDIG a regi helyszin
   * eszkozeit kinalna -- es amit a felhasznalo ott valaszt, azt a szerver
   * utasitana el.
   */
  it("a választó a frissen kiválasztott helyszínt kapja meg", async () => {
    render(<ServiceJobPlacementEditor {...alap()} />);
    await screen.findByLabelText("Helyszín");
    expect(screen.getByTestId("valaszto-helyszin").textContent).toEqual(
      "unit-9",
    );

    fireEvent.change(screen.getByLabelText("Helyszín"), {
      target: { value: "unit-5" },
    });

    expect(screen.getByTestId("valaszto-helyszin").textContent).toEqual(
      "unit-5",
    );
  });
});
