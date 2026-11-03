import {
  PAGE_HEADER_CLASSES,
  PageHeader,
  PilotPageHeader,
  ServiceDetailHeader,
  ServiceListHeader,
} from "@acropora/ui";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

/*
  EGY OLDALFEJLÉC (UI 2. csomag, 2026-11-03: a stage-söprés négy fejléc-változatot talált). MI PIROSÍT:
  ha a négy komponens bármelyike újra saját címméretet, felülcím-színt vagy leírás-stílust kap, vagy ha a
  gombsor elveszti a tördelést (telefonon kilógna). A mérce a közös osztálykészlet, nem egy-egy szám, mert
  a Figma-érték változása egy helyen történik.
*/
const valtozatok: Array<[string, () => ReactElement]> = [
  [
    "PageHeader",
    () => (
      <PageHeader
        eyebrow="Pénzügy"
        title="Számlázás"
        description="Kiállított számlák"
        actions={<button type="button">Új számla</button>}
      />
    ),
  ],
  [
    "PilotPageHeader",
    () => (
      <PilotPageHeader
        eyebrow="Pénzügy"
        title="Számlázás"
        description="Kiállított számlák"
        actions={<button type="button">Új számla</button>}
      />
    ),
  ],
  [
    "ServiceListHeader",
    () => (
      <ServiceListHeader
        eyebrow="Szerviz"
        title="Számlázás"
        lead="Kiállított számlák"
        action={<button type="button">Új számla</button>}
      />
    ),
  ],
  [
    "ServiceDetailHeader",
    () => (
      <ServiceDetailHeader
        eyebrow="Szerviz"
        title="Számlázás"
        sub="Kiállított számlák"
        actions={<button type="button">Új számla</button>}
      />
    ),
  ],
];

describe("az egyetlen oldalfejléc", () => {
  it.each(valtozatok)(
    "a(z) %s a közös cím-, felülcím- és gombsor-osztályokat viseli",
    (_nev, rajzol) => {
      render(rajzol());
      const cim = screen.getByRole("heading", { level: 1, name: "Számlázás" });
      expect(cim.className).toBe(PAGE_HEADER_CLASSES.title);
      expect(cim.parentElement?.className).toBe(PAGE_HEADER_CLASSES.main);
      expect(cim.previousElementSibling?.className).toBe(
        PAGE_HEADER_CLASSES.eyebrow,
      );
      expect(
        screen.getByRole("button", { name: "Új számla" }).parentElement
          ?.className,
      ).toBe(PAGE_HEADER_CLASSES.actions);
    },
  );

  it("a felülcím a meleg kiemelés, a cím a Figma 28/34-es mérete, a gombsor tördel", () => {
    expect(PAGE_HEADER_CLASSES.eyebrow).toContain(
      "text-pilot-accent-warm-text",
    );
    expect(PAGE_HEADER_CLASSES.title).toContain("text-[28px]");
    expect(PAGE_HEADER_CLASSES.title).toContain("leading-[34px]");
    expect(PAGE_HEADER_CLASSES.actions).toContain("flex-wrap");
  });

  // A GOMBSOR A CÍM ALÁ TÖR, HA NEM FÉR MELLÉ (barracuda, #2073): sortörés nélkül a sok gombos adatlapon a gombsor a saját
  // egysoros szélességét vette fel, és a cím oszloppá szorult. MI PIROSÍT: ha a fejléc nem tördel; ha a címnek nincs
  // alapszélessége (akkor a gombsor mindig mellé fér, és a cím szorul); ha a gombsor újra nem zsugorodhat (a saját sorában
  // akkor kilóg, és a belső tördelése nem működik).
  it("a fejléc tördel, a címnek 16 rem alapja van, a gombsor zsugorodhat", () => {
    expect(PAGE_HEADER_CLASSES.root.split(" ")).toContain("sm:flex-wrap");
    expect(PAGE_HEADER_CLASSES.main.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "sm:grow", "sm:basis-64"]),
    );
    expect(PAGE_HEADER_CLASSES.actions.split(" ")).not.toContain("shrink-0");
    expect(PAGE_HEADER_CLASSES.actions.split(" ")).toContain("min-w-0");
  });

  it("a leírás a PageHeader és a szerviz-lista fejlécén ugyanaz az elem", () => {
    render(
      <>
        <PageHeader title="A" description="Egy" />
        <ServiceListHeader eyebrow="Szerviz" title="B" lead="Kettő" />
      </>,
    );
    expect(screen.getByText("Egy").className).toBe(
      PAGE_HEADER_CLASSES.description,
    );
    expect(screen.getByText("Kettő").className).toBe(
      PAGE_HEADER_CLASSES.description,
    );
  });
});
