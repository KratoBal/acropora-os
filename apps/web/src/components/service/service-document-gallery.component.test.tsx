import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ServiceDocumentGallery,
  type ServiceDocumentGalleryItem,
} from "./service-document-gallery";

function doku(
  overrides: Partial<ServiceDocumentGalleryItem> = {},
): ServiceDocumentGalleryItem {
  return {
    id: "doc-1",
    fileName: "szivattyu.jpg",
    contentType: "image/jpeg",
    sizeBytes: 204800,
    // A FELIRAT ALAPBOL NINCS: a mezo 2026-09-17-en keletkezett, tehat minden
    // korabbi csatolmanyon `null`. Az az ALAPESET, nem a kivetel.
    caption: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("ServiceDocumentGallery", () => {
  /**
   * EZ A LENYEG, ES EZ VOLT A BEJELENTES.
   *
   * Balazs szava (2026-09-17): "a feltoltott fenykepek sehol nem jelnnek meg.
   * marmint nem tudom megnezni se a mobil appban se a weben".
   *
   * MI PIROSIT: a korabbi viselkedes. A lap addig CSAK egy `Letoltes` gombot
   * rajzolt, `<img>` elem sehol nem keletkezett -- ez az allitas azon a kodon
   * elbukik.
   */
  it("a képet megjeleníti, nem csak letölthetővé teszi", async () => {
    const loadBlob = vi.fn().mockResolvedValue(new Blob(["kep"]));
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={loadBlob}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    const kep = await screen.findByAltText("szivattyu.jpg");
    expect(kep.getAttribute("src")).toMatch(/^blob:/);
    expect(loadBlob).toHaveBeenCalledWith("doc-1");
  });

  /**
   * A TELJES MERET A LAPON BELUL NYILIK, nem uj ablakban es nem letoltessel.
   *
   * AMIT KULON ALLITUNK: a nagyitott kep NEM ugyanaz az elem, mint a csempe.
   * Enelkul egy olyan valtozat is atmenne, ami csak nagyobbra allitja a
   * csempet -- a `dialog` szerep az, ami a kettot megkulonbozteti.
   */
  it("a csempére kattintva a teljes méret a lapon nyílik meg", async () => {
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "szivattyu.jpg megnyitása teljes méretben",
      }),
    );

    const ablak = await screen.findByRole("dialog");
    expect(ablak.getAttribute("aria-label")).toBe("szivattyu.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Bezárás" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /**
   * A NEM KEP CSATOLMANY MARAD LETOLTHETO, ES NEM LESZ BELOLE URES CSEMPE.
   *
   * MI PIROSIT: ha a galeria mindenre `<img>`-et rajzolna. Egy PDF-bol keszult
   * objektum-URL nem hibazna -- a bongeszo torott kepet mutatna, ami ugyanugy
   * nez ki, mint egy be nem toltott fenykep.
   */
  it("a PDF letölthető marad, és nem lesz belőle kép", async () => {
    const loadBlob = vi.fn().mockResolvedValue(new Blob(["pdf"]));
    const onDownload = vi.fn();
    render(
      <ServiceDocumentGallery
        items={[
          doku({
            id: "doc-2",
            fileName: "jegyzokonyv.pdf",
            contentType: "application/pdf",
          }),
        ]}
        loadBlob={loadBlob}
        onDownload={onDownload}
        emptyText="nincs"
      />,
    );

    expect(await screen.findByText("jegyzokonyv.pdf")).toBeTruthy();
    expect(screen.queryByAltText("jegyzokonyv.pdf")).toBeNull();
    // ES NEM IS TOLTJUK LE FELESLEGESEN: a PDF-bol nincs mit megjeleniteni.
    expect(loadBlob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Letöltés" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload.mock.calls[0]?.[0]?.id).toBe("doc-2");
  });

  /**
   * EGY ELHASALT KEP A SAJAT CSEMPEJEN ALL MEG, A TOBBIT NEM VISZI EL.
   *
   * ES A HIANYT KIMONDJA: egy ures negyzet ugyanugy nez ki, mint egy meg
   * toltodo -- a kezelo megvarna valamit, ami sosem jon.
   */
  it("az egyik kép hibája nem viszi el a többit, és ki is mondja", async () => {
    const loadBlob = vi
      .fn()
      .mockImplementation((id: string) =>
        id === "doc-1"
          ? Promise.reject(new Error("A tároló nem érhető el."))
          : Promise.resolve(new Blob(["kep"])),
      );
    render(
      <ServiceDocumentGallery
        items={[doku(), doku({ id: "doc-3", fileName: "medence.png" })]}
        loadBlob={loadBlob}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    expect(await screen.findByAltText("medence.png")).toBeTruthy();
    expect(screen.queryByAltText("szivattyu.jpg")).toBeNull();
    expect(screen.getByText(/nem tölthető le/)).toBeTruthy();
  });

  /**
   * A TOROLT JOG HIANYA A FUGGVENY HIANYA: nincs gomb, nem pedig letiltott gomb.
   *
   * POZITIV KONTROLL MELLETTE: a megadott `onDelete` mellett a gomb OTT VAN.
   * Enelkul ez az allitas akkor is teljesulne, ha a gomb sosem rajzolodna ki.
   */
  it("törlés csak akkor látszik, ha van hozzá függvény", async () => {
    const { unmount } = render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    await screen.findByAltText("szivattyu.jpg");
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    unmount();

    const onDelete = vi.fn();
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        onDelete={onDelete}
        emptyText="nincs"
      />,
    );
    await screen.findByAltText("szivattyu.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Törlés" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  /**
   * AZ OBJEKTUM-URL-EKET VISSZA KELL VONNI.
   *
   * MIERT ALLITAS, ES NEM BELSO REszlet: egy vissza nem vont blob a LAP
   * ELETERE a memoriaban marad, es a hiba NEMA -- a kepek jok, a bongeszo
   * lassul. Egy tiz fenykepes jegyen ez tobb tiz megabajt.
   */
  it("kilépéskor visszavonja a készített objektum-URL-eket", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { unmount } = render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    const kep = await screen.findByAltText("szivattyu.jpg");
    const url = kep.getAttribute("src");

    unmount();
    expect(revoke).toHaveBeenCalledWith(url);
  });

  /**
   * A SZULO UJRARAJZOLASA NEM TOLTI UJRA A KEPEKET.
   *
   * MERT A HIVO HELYBEN IRJA MEG a letolto fuggvenyt, tehat minden szulo-
   * ujrarajzolasnal UJ fuggveny-azonossag keletkezik. A hibas valtozat NEM
   * hibazik: a kepek jok, csak minden begepelt betu ujratolti az egeszet -- egy
   * tiz fenykepes jegyen betunkent tobb tiz megabajt.
   *
   * MI PIROSIT: a letolto fuggveny visszatetele az effekt fuggosegi listajaba.
   */
  it("a szülő újrarajzolása nem tölti újra a képeket", async () => {
    const letoltes = vi.fn().mockResolvedValue(new Blob(["kep"]));
    const { rerender } = render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={(id) => letoltes(id)}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    await screen.findByAltText("szivattyu.jpg");
    expect(letoltes).toHaveBeenCalledTimes(1);

    // UJ TOMB ES UJ FUGGVENY-AZONOSSAG, ugyanazzal a tartalommal -- pontosan az,
    // amit a szulo minden ujrarajzolasnal ad.
    rerender(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={(id) => letoltes(id)}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    await screen.findByAltText("szivattyu.jpg");
    expect(letoltes).toHaveBeenCalledTimes(1);
  });

  /**
   * A FELIRAT AZ, AMIT A KEZELO KERES -- ES A FAJLNEV FOLOTT ALL.
   *
   * Balazs kerese (2026-09-17): "jo lenne ... megjegyzest lehessen irni a
   * kephez". A fajlnev csak azt mondja meg, minek nevezte el a telefon.
   */
  it("a feliratot kiírja a csempén, a fájlnév mellett", async () => {
    render(
      <ServiceDocumentGallery
        items={[doku({ caption: "A hármas medence szivattyúja" })]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    expect(
      await screen.findByText("A hármas medence szivattyúja"),
    ).toBeTruthy();
    // A FAJLNEV NEM TUNIK EL: a ketto MAST mond, es a letoltott fajlt a nevén
    // kell megtalalni a gepen.
    expect(screen.getByText("szivattyu.jpg")).toBeTruthy();
  });

  /**
   * A FELIRAT OLVASHATO ANNAK IS, AKI NEM IRHATJA.
   *
   * POZITIV KONTROLL MELLETTE: a `onSaveCaption` megadasaval a gomb OTT VAN.
   * Enelkul ez az allitas akkor is teljesulne, ha a gomb sosem rajzolodna ki.
   */
  it("szerkesztő gomb csak akkor van, ha van hozzá függvény", async () => {
    const { unmount } = render(
      <ServiceDocumentGallery
        items={[doku({ caption: "Szivattyú" })]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    expect(await screen.findByText("Szivattyú")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Felirat/ })).toBeNull();
    unmount();

    render(
      <ServiceDocumentGallery
        items={[doku({ caption: "Szivattyú" })]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        onSaveCaption={vi.fn().mockResolvedValue(undefined)}
        emptyText="nincs"
      />,
    );
    expect(await screen.findByText("Szivattyú")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Felirat átírása" }),
    ).toBeTruthy();
  });

  /**
   * A MENTES A TISZTITOTT SZOVEGET VISZI, es a mezo UTANA zar be.
   */
  it("a felirat mentése a tisztított szöveget adja át", async () => {
    const onSaveCaption = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        onSaveCaption={onSaveCaption}
        emptyText="nincs"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Felirat" }));
    fireEvent.change(screen.getByPlaceholderText("Mit látunk a képen?"), {
      target: { value: "  A kompresszor tömítése  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(onSaveCaption).toHaveBeenCalledTimes(1));
    expect(onSaveCaption.mock.calls[0]?.[0]?.id).toBe("doc-1");
    expect(onSaveCaption.mock.calls[0]?.[1]).toBe("A kompresszor tömítése");
    // A MEZO SIKER UTAN BEZAR.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Mit látunk a képen?")).toBeNull(),
    );
  });

  /**
   * AZ URES MEZO TORLEST JELENT, ES `null`-KENT MEGY LE.
   *
   * MI PIROSIT: ha ures stringet kuldenenk. Akkor a "nincs felirat" es a
   * "szandekosan ures felirat" ket allapota egyformanak tunne, es senki nem
   * tudna megmondani, melyiket jelenti.
   */
  it("a felirat kitörlése null-ként megy le", async () => {
    const onSaveCaption = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceDocumentGallery
        items={[doku({ caption: "Szivattyú" })]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        onSaveCaption={onSaveCaption}
        emptyText="nincs"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Felirat átírása" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Mit látunk a képen?"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(onSaveCaption).toHaveBeenCalledTimes(1));
    expect(onSaveCaption.mock.calls[0]?.[1]).toBeNull();
  });

  /**
   * ELHASALT MENTES UTAN A BEGEPELT SZOVEG OTTMARAD.
   *
   * MI PIROSIT: ha a mezo a hiba utan is bezarna. Akkor a felhasznalo szovege
   * ELVESZNE, es a masodik nekifutas ugyanolyan hosszu lenne, mint az elso --
   * miutan mar egyszer leirta.
   */
  it("elhasalt mentés után a szöveg ottmarad, és kimondja a hibát", async () => {
    const onSaveCaption = vi
      .fn()
      .mockRejectedValue(new Error("A tároló nem érhető el."));
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        onSaveCaption={onSaveCaption}
        emptyText="nincs"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Felirat" }));
    fireEvent.change(screen.getByPlaceholderText("Mit látunk a képen?"), {
      target: { value: "Tömítés" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    expect(await screen.findByText("A tároló nem érhető el.")).toBeTruthy();
    const mezo = screen.getByPlaceholderText("Mit látunk a képen?");
    expect((mezo as HTMLInputElement).value).toBe("Tömítés");
  });

  /**
   * A CSATOLMANY FAJTAJA -- DE CSAK OTT, AHOL VAN MIT MONDANI.
   *
   * MIERT KELL: az eszkoz adatlapjan NEGY fajta all (szamla, garanciajegy,
   * hasznalati utasitas, egyeb), es a fajlnev nem kulonbozteti meg oket. A
   * korabbi, kezzel rajzolt lista kiirta; a galeriara valtas ezt elvette volna.
   *
   * MINDKET LISTAN MERJUK, mert a komponens ket helyen rajzol (kep-csempe es
   * letoltheto sor), es EGY hely atvezetese ugyanugy "mukodne" -- csak a
   * masikon tunne el a fajta, nemán.
   *
   * ES A NEGATIV IRANY IS ALL ITT: cimke-fuggveny nelkul NINCS cimke. Enelkul
   * ez az allitas akkor is zold lenne, ha a komponens minden elemre kiirna
   * valamit -- a hibajegy pedig epp azt nem akarja.
   */
  it("a dokumentum fajtája a galériában is látszik, ha a hívó ad rá címkét", async () => {
    const elemek = [
      doku({ id: "doc-1", fileName: "medence.jpg", contentType: "image/jpeg" }),
      doku({
        id: "doc-2",
        fileName: "szamla-2026-08.pdf",
        contentType: "application/pdf",
      }),
    ];
    const cimke = (item: ServiceDocumentGalleryItem) =>
      item.contentType === "application/pdf" ? "Számla" : "Fénykép";

    const { unmount } = render(
      <ServiceDocumentGallery
        items={elemek}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        itemLabel={cimke}
        emptyText="nincs"
      />,
    );

    await screen.findByAltText("medence.jpg");
    // A KEP-CSEMPEN...
    expect(screen.getByText(/Fénykép ·/)).toBeTruthy();
    // ...ES A LETOLTHETO SORON IS.
    expect(screen.getByText(/Számla ·/)).toBeTruthy();
    unmount();

    render(
      <ServiceDocumentGallery
        items={elemek}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );
    await screen.findByAltText("medence.jpg");
    expect(screen.queryByText(/Számla ·/)).toBeNull();
    expect(screen.queryByText(/Fénykép ·/)).toBeNull();
  });

  /** A HIANY IS ALLITAS: egy ures doboz betoltesi hibanak latszik. */
  it("üres listán kimondja, hogy nincs mire várni", () => {
    render(
      <ServiceDocumentGallery
        items={[]}
        loadBlob={vi.fn()}
        onDownload={vi.fn()}
        emptyText="Ehhez a jegyhez még nincs fénykép vagy fájl csatolva."
      />,
    );
    expect(
      screen.getByText("Ehhez a jegyhez még nincs fénykép vagy fájl csatolva."),
    ).toBeTruthy();
  });

  /**
   * A CSEMPE NEM VAGHATJA LE A SAJAT MUVELETET.
   *
   * === A BEJELENTES (Balazs, 2026-09-18, keppel) ===
   *
   * A munkalap Csatolmanyok szakaszaban a `Letoltes` gomb FELBEVAGVA latszott
   * ("Leto"), a meret-sor pedig HAT sorba tordelve. A csempe szelessege a racs
   * oszlopszelessege (ketto, harom vagy negy oszlop), es a tartalom nem birta el.
   *
   * === MIERT A GOMBSOR A SULYOSABB FELE ===
   *
   * A csempen `overflow-hidden` all. Egy NEM tordelheto gombsor keskeny oszlopban
   * kilog, es az `overflow-hidden` LEVAGJA -- vagyis a muvelet felirata hianyzik,
   * nem csak csunya. Tordelessel a sor a csempe MAGASSAGAT noveli, ami
   * helyreallithato; a levagott felirat nem.
   *
   * === A HATAR, KIMONDVA ===
   *
   * Ez az allitas az OSZTALYT meri, nem a pixeleket: a `happy-dom` nem szamol
   * elrendezest, tehat azt, hogy a gomb TENYLEG befer, itt semmi nem tudja
   * megmondani. Amit ez fog meg: ha valaki a tordelest kiveszi, a levagas
   * visszater -- es az a valtozas ma NEMA lenne.
   */
  it("a művelet-sor TÖRDELHET, tehát nem vágódhat le a csempe szélén", () => {
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    const gomb = screen.getByRole("button", { name: "Letöltés" });
    const sor = gomb.parentElement;
    expect(sor?.className).toContain("flex-wrap");
  });

  /**
   * A MERET-SOR EGY SOR, ES A SUGOJA UGYANAZT MONDJA.
   *
   * A sor `{fajta} · {meret} · {datum}` alaku, es a DATUM FORMATUMA ONMAGABAN
   * NEGY szokozt tartalmaz ("2026. 09. 18. 9:10"). Tordelesi szabaly nelkul
   * keskeny oszlopban SZAVANKENT tort -- igy allt elo hat sor egyetlen fenykep
   * alatt.
   *
   * AMIT KULON ALLITUNK, ES NEM A `truncate` MEGLETET: hogy a `title` PONTOSAN
   * azt mondja, ami a sorban all. A kettot ket kulon kiiras is eloallithatna, es
   * akkor a sugo MAST mondana, mint a lathato szoveg -- egy levagott sornal epp
   * a sugo az egyetlen, amibol az egesz kiderul.
   */
  it("a méret-sor egy sorban marad, és a súgója betűre ugyanaz", () => {
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    const sor = screen
      .getByText(/·/, { selector: "p" })
      .closest("p") as HTMLElement;

    expect(sor.className).toContain("truncate");
    expect(sor.getAttribute("title")).toBe(sor.textContent);
  });

  /**
   * AZ OSZLOPSZÁM A BEFOGLALÓ DOBOZÉ, NEM A KÉPERNYŐÉ.
   *
   * Ez a galéria HÁROM helyen fut, és az egyikük egy 288 pixeles oldalsó hasáb
   * (a munkalap adatlapja). Nézetablak-töréspontokkal ott is négy oszlop állt
   * széles monitoron, tehát ~52 pixeles csempe -- amiben a `Letöltés` gomb
   * (75 pixel, acrobot mérése 2026-09-18 10:0x) fizikailag nem fér el.
   *
   * MI PIROSÍT: a visszatérés `sm:` / `lg:` alakra. Az a változtatás „egyszerűbb"
   * kódnak látszik, és a hibája CSAK széles monitoron, CSAK a szűk hasábban jön
   * elő -- vagyis pontosan ott, ahol senki nem nézi.
   *
   * AMIT EZ AZ ÁLLÍTÁS NEM MÉR, KIMONDVA: a tényleges pixeleket. A happy-dom nem
   * számol elrendezést. A pixel-méréseket acrobot végezte éles stíluslappal; ez
   * az állítás a MECHANIZMUST őrzi, ami azokat érvényre juttatja.
   */
  it("az oszlopszám a BEFOGLALÓ DOBOZHOZ igazodik, nem a nézetablakhoz", () => {
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    const racs = screen.getByRole("list");

    expect(racs.className).toMatch(/@\w+:grid-cols-\d/);
    expect(racs.className).not.toMatch(
      /(?:^|\s)(?:sm|md|lg|xl|2xl):grid-cols-/,
    );
    // A mérethivatkozási pont a galéria SAJÁT doboza: enélkül a `@md:` alakok
    // a legközelebbi külső konténerhez igazodnának, vagy sehová.
    expect(racs.closest("[class~='@container']")).not.toBeNull();
  });

  /**
   * SZŰK DOBOZBAN EGY OSZLOP AZ ALAP.
   *
   * MI PIROSÍT: a `grid-cols-2` visszatérése alapként. A 288 pixeles hasábban
   * (belső kerettel 244 pixel) két oszlop 116 pixeles csempét ad -- a két gomb
   * egymás mellett 213 pixelt kér, tehát tördelne, és a méret-sor három sorba
   * törne. Egy oszlopnál a csempe a teljes 244 pixel.
   */
  it("szűk dobozban EGY oszlop az alap, nem kettő", () => {
    render(
      <ServiceDocumentGallery
        items={[doku()]}
        loadBlob={vi.fn().mockResolvedValue(new Blob(["kep"]))}
        onDownload={vi.fn()}
        emptyText="nincs"
      />,
    );

    const racs = screen.getByRole("list");

    expect(racs.className).toMatch(/(?:^|\s)grid-cols-1(?:\s|$)/);
    expect(racs.className).not.toMatch(/(?:^|\s)grid-cols-[2-9](?:\s|$)/);
  });
});
