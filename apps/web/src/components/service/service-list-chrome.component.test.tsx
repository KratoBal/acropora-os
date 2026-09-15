import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServiceListFooter } from "./service-list-chrome";

/**
 * A LABLEC JOBB OLDALA: LAPOZAS VAGY HATAR.
 *
 * EZEK AZ ALLITASOK NAUTILUSTOL JONNEK, es azert kerultek ide, mert a dolog,
 * amit ORIZNEK, ATKOLTOZOTT. Nala a `listFooterNote` fuggvenyt mertek: az adta
 * a vagott hibajegy-lista mondatat, mert a kozos lablec akkor meg `page` +
 * `totalPages` + elhagyhato `note` alakban allt.
 *
 * A lablec azota megkulonboztetett `tail`-t vesz at, tehat a mondat MAGA a
 * kozos komponensben szuletik -- a helper elfogyott, es vele fogytak volna el
 * ezek a garanciak is. Egy atalakitas, ami egy fuggvennyel egyutt a rola szolo
 * allitasokat is eldobja, NEM viszi at a tudast, csak a kodot.
 */
describe("ServiceListFooter", () => {
  /**
   * A VAGOTT LISTA NEM HALLGATHAT. A "vegere ertel" mondat egy vagott halmaz
   * alatt hazugsag -- es epp ez az egy mondat, amiert valaki a lap aljara nez.
   */
  it("vágott listánál kimondja, hogy van több", () => {
    render(
      <ServiceListFooter
        shown={200}
        totalItems={640}
        tail={{ kind: "capped", truncated: true }}
      />,
    );
    expect(screen.getByText(/van több/)).toBeTruthy();
  });

  /**
   * ES TELJES LISTANAL UGYANAZT MONDJA, MINT A LAPOZO LISTA UTOLSO LAPJA.
   *
   * Nalanak ez ugy hangzott, hogy "nem ir felul semmit" -- akkor ez volt a
   * merheto alak, mert a helper `undefined`-ot adott es a kozos mondat allt be.
   * Most a ket ag EGYUTT all a komponensben, tehat kimondhato az ERŐSEBB alak:
   * a ket helyzet ugyanazt a mondatot adja. Enelkul mind a ket allitas zold
   * maradna egy olyan valtozatnal is, ami a `capped` agon MAS szoveget ir --
   * es akkor a harom szerviz-lista ket kulonbozo mondatot adna ugyanarra.
   */
  it("teljes listánál ugyanazt mondja, mint egy egylapos lapozó lista", () => {
    const { container: teljes } = render(
      <ServiceListFooter
        shown={12}
        totalItems={12}
        tail={{ kind: "capped", truncated: false }}
      />,
    );
    const { container: egylapos } = render(
      <ServiceListFooter
        shown={12}
        totalItems={12}
        tail={{ kind: "paged", page: 1, totalPages: 1 }}
      />,
    );
    expect(teljes.textContent).toBe(egylapos.textContent);
  });

  /**
   * A HATAR SZAMA NEM SZIVAROG A MONDATBA. A ketszazas vagas a szerver
   * lekerdezeseben all; ha a kliens mondataban is ott allna, egyszer elcsuszna
   * tole, es a felulet egy mar nem letezo szamot allitana.
   *
   * AZ ALLITAS A JOBB OLDALRA SZUKUL, ES ELSORE NEM IGY IRTAM MEG: az egesz
   * lablec szovegere mertem, az viszont a BAL oldalon jogosan tartalmaz
   * szamokat ("640 talalat, ebbol 200 ezen a lapon"). Elbukott egy HELYES
   * komponensen. Nautilus eredetije csak a helper sztringjet nezte, tehat ott
   * ez a kerdes fel sem merult -- a hordozassal tagult ki a hatokore.
   *
   * SZAMJEGYRE MER, NEM A KETSZAZRA: igy egy masik hatar bemasolasa is elbukna,
   * nem csak a mai szam.
   */
  it("a jobb oldali mondatban nincs szám", () => {
    const { container } = render(
      <ServiceListFooter
        shown={200}
        totalItems={640}
        tail={{ kind: "capped", truncated: true }}
      />,
    );
    const jobbOldal = container.querySelector("span:last-of-type");
    expect(jobbOldal?.textContent).toBeTruthy();
    expect(jobbOldal?.textContent ?? "").not.toMatch(/\d/);
  });

  /** A lapozo ag tobb lapnal a lapszamot mondja, nem a veget. */
  it("több lapnál a lapszám áll ott, nem a vég", () => {
    render(
      <ServiceListFooter
        shown={25}
        totalItems={90}
        tail={{ kind: "paged", page: 2, totalPages: 4 }}
      />,
    );
    expect(screen.getByText("2 / 4. lap")).toBeTruthy();
  });
});
