import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PILOT_BACK_LINK_CLASSES,
  PILOT_BACK_LINK_FLUSH_CLASSES,
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
