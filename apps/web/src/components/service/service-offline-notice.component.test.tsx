import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ServiceOfflineNotice } from "./service-offline-notice";

/**
 * A SAV CSAK AZT ALLITHATJA, AMI MOGOTT MECHANIZMUS VAN -- ES AMIT A LAP
 * TENYLEG MUTAT.
 *
 * Ket kulon hataron bukhat el egy ilyen sav, es MIND A KETTOT merjuk itt:
 *
 *   1. allithat olyat, amihez nincs gepezet (feltoltesre varo modositasok
 *      szama, utolso frissites idopontja) -- a webnek nincs helyi sora es
 *      nincs betoltesi idobelyege;
 *   2. allithat olyat, ami az ADOTT LAPON nem igaz (hogy a korabban betoltott
 *      adatokat latod, miközben meg semmi nem toltodott be).
 *
 * A masodikat nautilus merte vissza, MIUTAN a sav mar beolvadt. Az elso
 * valtozat egyetlen mondatot mondott minden lapon.
 */

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

afterEach(() => setOnLine(true));

describe("ServiceOfflineNotice", () => {
  it("kapcsolat mellett semmit nem rajzol ki", () => {
    setOnLine(true);
    const { container } = render(
      <ServiceOfflineNotice state={{ kind: "loaded" }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  /**
   * A HAROM ALLAPOT HAROM KULONBOZO MONDATOT AD, ES EZ NEM STILUS.
   *
   * Ha kettо ugyanazt mondana, az egyiken HAMIS lenne -- epp az a hiba, ami
   * miatt ez a prop letrejott. Ezert a harom mondat KULONBOZOSEGET is
   * allitjuk, nem csak a tartalmukat: igy egy kesobbi "egyszerusites", ami
   * osszevonja oket, kipirosodik.
   */
  it("mind a három állapot mást mond", () => {
    setOnLine(false);
    const szovegek = (["loaded", "empty", "form"] as const).map((kind) => {
      const { container, unmount } = render(
        <ServiceOfflineNotice state={{ kind }} />,
      );
      const s = container.textContent ?? "";
      unmount();
      return s;
    });
    expect(new Set(szovegek).size).toBe(3);
    szovegek.forEach((s) => expect(s).toMatch(/Nincs internet/));
  });

  it("betöltött tartalomnál megmondja, hogy az nem frissül", () => {
    setOnLine(false);
    render(<ServiceOfflineNotice state={{ kind: "loaded" }} />);
    expect(screen.getByText(/legutóbb betöltött adatokat látod/)).toBeTruthy();
  });

  /**
   * ES URES LAPON EZ A MONDAT NEM ALLHAT OTT. Ez a teszt AZ a hiba, amit
   * nautilus talalt: hideg betoltesnel a lap ures, es a regi sav azt allitotta,
   * hogy a korabbi adatokat nezed.
   */
  it("üres lapon NEM állítja, hogy korábbi adatokat látsz", () => {
    setOnLine(false);
    const { container } = render(
      <ServiceOfflineNotice state={{ kind: "empty" }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/nem tudtuk betölteni/);
    expect(text).not.toMatch(/látod/);
  });

  /**
   * AZ URLAPON A TET A MENTES, NEM A FRISSITES. Ott "betoltott adat" nincs,
   * tehat a `loaded` mondata MINDIG hamis lett volna -- kapcsolattal is.
   */
  it("űrlapon a mentésről beszél, nem a frissítésről", () => {
    setOnLine(false);
    const { container } = render(
      <ServiceOfflineNotice state={{ kind: "form" }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/mentés/);
    expect(text).not.toMatch(/betöltött adatokat látod/);

    // ES NEM IGER VARAKOZO MENTEST. A "csak akkor megy at, ha visszajon" alak
    // ugy olvashato, hogy a mentes var -- a weben nincs mogotte sem sor, sem
    // ujraprobalkozas. A pozitiv kontroll a fenti `mentés` egyezes: ha a sav
    // ures lenne, ez a ket hianyt-mero allitas ures vilagon is zold maradna.
    expect(text).not.toMatch(/megy át/);
    expect(text).not.toMatch(/feltölt/);
  });

  it("a munka közben megszakadó kapcsolatra is megjelenik, és vissza is tűnik", () => {
    setOnLine(true);
    const { container } = render(
      <ServiceOfflineNotice state={{ kind: "loaded" }} />,
    );
    expect(container.firstChild).toBeNull();

    setOnLine(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/legutóbb betöltött adatokat látod/)).toBeTruthy();

    setOnLine(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(container.firstChild).toBeNull();
  });

  /**
   * ES A KET ALLITAS, AMIT EGYIK ALLAPOT SEM TESZ.
   *
   * A hianyt mero allitast egy URES VILAG is kielegiti, ezert a POZITIV
   * KONTROLL ugyanitt all: eloszor bizonyitjuk, hogy a sav szovege
   * kiolvashato, es csak azutan allitunk hianyt rola. Es MIND A HAROM
   * allapotra merunk, nem csak egyre -- egy uj mondat a `form` agon ugyanugy
   * behozhatna a sort vagy az idopontot.
   */
  it("egyik állapot sem beszél feltöltésre váró módosításról, sem időpontról", () => {
    setOnLine(false);
    for (const kind of ["loaded", "empty", "form"] as const) {
      const { container, unmount } = render(
        <ServiceOfflineNotice state={{ kind }} />,
      );
      const text = container.textContent ?? "";

      expect(text).toMatch(/Nincs internet/); // pozitiv kontroll
      expect(text).not.toMatch(/feltöltésre vár/);
      expect(text).not.toMatch(/[Ss]zinkroniz/);
      expect(text).not.toMatch(/\d{1,2}:\d{2}/);
      expect(container.querySelectorAll("a")).toHaveLength(0);
      unmount();
    }
  });
});
