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
});
