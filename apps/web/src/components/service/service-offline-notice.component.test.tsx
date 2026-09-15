import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ServiceOfflineNotice } from "./service-offline-notice";

/**
 * A SAV CSAK AZT ALLITHATJA, AMI MOGOTT MECHANIZMUS VAN.
 *
 * A prototipus savja harom dolgot mond; nalunk egy all meg. A masik ketto
 * (a feltoltesre varo modositasok szama es az utolso frissites idopontja)
 * olyan mechanizmust feltetelez, ami a WEBEN nincs: helyi muvelet-sort es
 * betoltesi idobelyeget. Ezert ezek hianyat MERJUK, nem csak elkeruljuk.
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
    const { container } = render(<ServiceOfflineNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("kapcsolat nélkül kiírja, hogy a betöltött adatokat látod", () => {
    setOnLine(false);
    render(<ServiceOfflineNotice />);
    expect(screen.getByText(/legutóbb betöltött adatokat látod/)).toBeTruthy();
  });

  /**
   * A KIINDULAS MINDIG "ONLINE" (kiszolgalon nincs `navigator`), tehat a savnak
   * az ESEMENYRE kell megjelennie, nem csak a beallaskori allapotra. Ha csak az
   * elsot mernenk, egy olyan valtozat is zold lenne, ami a munka kozben
   * megszakado kapcsolatot soha nem veszi eszre -- vagyis a gyakoribb esetet.
   */
  it("a munka közben megszakadó kapcsolatra is megjelenik, és vissza is tűnik", () => {
    setOnLine(true);
    const { container } = render(<ServiceOfflineNotice />);
    expect(container.firstChild).toBeNull();

    setOnLine(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/legutóbb betöltött adatokat látod/)).toBeTruthy();

    setOnLine(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(container.firstChild).toBeNull();
  });

  /**
   * ES A KET ALLITAS, AMIT NEM TESZUNK.
   *
   * A hianyt mero allitast egy URES VILAG is kielegiti: ha a sav nem jelenne
   * meg egyaltalan, a "nem emlit sort" mondat zold maradna. Ezert a POZITIV
   * KONTROLL ugyanebben a tesztben all: eloszor bizonyitjuk, hogy a szoveg
   * MEGTALALHATO, amikor ott van, es csak azutan allitunk hianyt rola.
   */
  it("nem beszél feltöltésre váró módosításról, és nem mutat Szinkronizálás lapra", () => {
    setOnLine(false);
    const { container } = render(<ServiceOfflineNotice />);

    // POZITIV KONTROLL: a sav ott van, es a szovege kiolvashato innen.
    const text = container.textContent ?? "";
    expect(text).toMatch(/legutóbb betöltött adatokat látod/);

    // Csak ezutan ér valamit a hiany merese.
    expect(text).not.toMatch(/feltöltésre vár/);
    expect(text).not.toMatch(/[Ss]zinkroniz/);
    expect(container.querySelectorAll("a")).toHaveLength(0);

    // ES AZ IDOPONT SEM: ma nem tudjuk, mikor toltodott be az adat, tehat
    // barmilyen ora-alaku szam itt talalgatas lenne.
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
