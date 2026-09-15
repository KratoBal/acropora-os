import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ServiceOfflineNotice, SZOVEG } from "./service-offline-notice";
import {
  MINDEN_KIND,
  osztallyalRejtve,
  savSzovege,
  savotMond,
  setOnLine,
} from "./service-offline-notice.testing";

/**
 * AZ ALLVANY SAJAT KALIBRACIOJA.
 *
 * A `savotMond` harom dolgot allit egyszerre, es MIND A HAROMNAK EL KELL TUDNI
 * SULNIE. Egy allitas, ami soha nem tud pirosra valtani, rosszabb a semminel:
 * ugy nez ki, mintha ellenoriztunk volna.
 *
 * Ezert itt nem a lapokat merem, hanem a MERoESZKOZT: megepitem mind a harom
 * bukast, es allitom, hogy elsul. A lapok tesztjei ezutan tamaszkodhatnak ra.
 */

afterEach(() => setOnLine(true));

describe("a szerviz-sav allvanya", () => {
  it("minden állapotot a forrásból vesz, nem kézzel felsorolva", () => {
    expect([...MINDEN_KIND].sort()).toEqual(Object.keys(SZOVEG).sort());
    // POZITIV KONTROLL a listára: ha a SZOVEG üres lenne, a fenti egyenlőség
    // két üres tömböt hasonlítana össze, és zöld maradna.
    expect(MINDEN_KIND.length).toBeGreaterThan(1);
  });

  it("a várt mondatot a komponenstől kérdezi meg", () => {
    for (const kind of MINDEN_KIND)
      expect(savSzovege(kind)).toContain(SZOVEG[kind]);
  });

  it("átmegy, ha a lap egyetlen, látható mondatot mutat", async () => {
    setOnLine(false);
    render(<ServiceOfflineNotice state={{ kind: "loaded" }} />);

    await expect(savotMond("loaded")).resolves.toBeTruthy();
  });

  /**
   * A MEGEPITETT NEMA BUKAS. A savot egy `hidden` osztalyu doboz rejti el: a
   * szoveg OTT VAN a faban, tehat minden szoveg-allitas zold maradna, es a
   * felhasznalo megsem lat semmit. A futtato nem tolt be stiluslapot, ezert
   * ezt sem a `findByText`, sem a `toBeVisible` nem venne eszre.
   */
  it("elbukik, ha egy osztály elrejti a sávot", async () => {
    setOnLine(false);
    render(
      <div className="hidden">
        <ServiceOfflineNotice state={{ kind: "loaded" }} />
      </div>,
    );

    // A szoveg-alapu allitas ITT MEG ZOLD -- ez a bukas nemasaga.
    expect(screen.queryByText(savSzovege("loaded"))).not.toBeNull();
    // Az allvany viszont elsul.
    await expect(savotMond("loaded")).rejects.toThrow(/elrejti/);
  });

  it("a reszponzív rejtő osztályt is elkapja", async () => {
    setOnLine(false);
    render(
      <div className="sm:hidden">
        <ServiceOfflineNotice state={{ kind: "empty" }} />
      </div>,
    );

    await expect(savotMond("empty")).rejects.toThrow(/sm:hidden/);
  });

  it("elbukik, ha két mondat áll egyszerre", async () => {
    setOnLine(false);
    render(
      <>
        <ServiceOfflineNotice state={{ kind: "loaded" }} />
        <ServiceOfflineNotice state={{ kind: "empty" }} />
      </>,
    );

    await expect(savotMond("loaded")).rejects.toThrow(/hazudik/);
  });

  it("a rejtő keresés a látható sávra nem üt ki", () => {
    setOnLine(false);
    const { container } = render(
      <div className="mb-4 flex">
        <ServiceOfflineNotice state={{ kind: "form" }} />
      </div>,
    );
    const sav = container.querySelector("[role=status]") as HTMLElement;

    expect(osztallyalRejtve(sav)).toBeNull();
  });
});
