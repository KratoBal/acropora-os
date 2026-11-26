import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PILOT_BACK_LINK_CLASSES,
  PILOT_BACK_LINK_FLUSH_CLASSES,
  PilotBackButton,
  PilotBackLink,
  backLinkLabel,
} from "./pilot-back-link";

/*
  A VISSZALÉPÉS EGY ALAKJA (Picasso R12, acrobot 62415). MI PIROSÍT: ha a visszalépés gomb lesz link helyett (egy útvonal nem művelet); ha a nyíl vagy
  a felirat hiányzik; ha az osztályok elmozdulnak a bal felső kis nyíltól (a többi lap ugyanezt a közös komponenst kapja); ha a felirat az előző lapról
  jövőnek nem „Vissza", az egyenesen érkezőnek nem a lista neve.
*/
describe("PilotBackLink", () => {
  it("link a megadott címre, nyíllal és felirattal, a közös osztályokkal", () => {
    render(<PilotBackLink href="/admin/brands">Márkák</PilotBackLink>);
    const link = screen.getByRole("link", { name: "Márkák" });
    expect(link.getAttribute("href")).toBe("/admin/brands");
    expect(link.className).toBe(PILOT_BACK_LINK_CLASSES);
    expect(link.className).toContain("text-xs");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("PilotBackLink flush", () => {
  // a számla-lapok gyökere `space-y-6`: ott a szülő adja a távolságot a fejlécig, a link alsó margója kettőzné
  it("alsó margó nélküli változat, a többi osztály azonos", () => {
    render(
      <PilotBackLink href="/penzugy/szamlazas" flush>
        Számlák
      </PilotBackLink>,
    );
    const link = screen.getByRole("link", { name: "Számlák" });
    expect(link.className).toBe(PILOT_BACK_LINK_FLUSH_CLASSES);
    expect(link.className).not.toContain("mb-3");
    expect(link.className).toBe(PILOT_BACK_LINK_CLASSES.replace("mb-3 ", ""));
    expect(link.className).toContain("text-pilot-grey-400");
  });
});

describe("backLinkLabel", () => {
  it("az előző lapról jövőnek Vissza, különben a lista neve", () => {
    expect(backLinkLabel({ fromWithinApp: true }, "Márkák")).toBe("Vissza");
    expect(backLinkLabel({ fromWithinApp: false }, "Márkák")).toBe("Márkák");
  });
});

/*
  A NYÍL GOMB-VÁLTOZATA: ugyanaz a megjelenés, mint a linké, de művelet (egy ugyanazon az URL-en élő nézetből lép ki). MI PIROSÍT: ha link lesz belőle
  (útvonalat kapna); ha a kattintás nem hívja az onClick-et; ha az osztályok elmozdulnak a link megjelenésétől (egy alak a cél); ha a gomb elküldene egy űrlapot.
*/
describe("PilotBackButton", () => {
  it("gomb, a link osztályaival és nyíllal, a kattintás az onClick-et hívja", () => {
    const onClick = vi.fn();
    render(<PilotBackButton onClick={onClick}>Elszámolások</PilotBackButton>);
    const button = screen.getByRole("button", { name: "Elszámolások" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain(PILOT_BACK_LINK_CLASSES);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("flush: alsó margó nélkül, a többi osztály azonos", () => {
    render(
      <PilotBackButton onClick={() => undefined} flush>
        Elszámolások
      </PilotBackButton>,
    );
    const button = screen.getByRole("button", { name: "Elszámolások" });
    expect(button.className).toContain(PILOT_BACK_LINK_FLUSH_CLASSES);
    expect(button.className).not.toContain("mb-3");
  });
});
