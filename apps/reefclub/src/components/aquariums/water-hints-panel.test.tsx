import { render, screen, within } from "@testing-library/react";
import type { ReefClubWaterHintRow, ReefClubWaterHints } from "@acropora/types";
import { describe, expect, it } from "vitest";

import type { ReefClubAquarium } from "@/lib/types";
import { mockApi, reply } from "@/test/mock-api";

import { WaterHintsPanel } from "./water-hints-panel";

/**
 * A "MI LÓG KI" PANEL (card ce6c5cc9, V3.4 S3). MI PIROSÍT: kikapcsolt kapcsolónál (OFF) vagy betöltési hibánál látszik valami; a mondatot,
 * a sávot vagy a nyilatkozatot a lap maga írja át; egy eltérésnél a termék hivatkozása nem a gyártóé, vagy nincs `noopener`; az üres lista
 * ajánlásnak látszik; a régi termékajánló termeket nevez; a mellékhatás-sor kimarad; a rendben lévő érték mellett termék jelenik meg.
 */
const AQUARIUM: ReefClubAquarium = {
  id: "a1",
  origin: "OWN",
  name: "Nappali nano",
  waterBodyType: "AKVARIUM",
  waterType: "TENGERI",
  systemVolumeLiters: 200,
  sharedWithShopAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
};

const row = (
  over: Partial<ReefClubWaterHintRow> = {},
): ReefClubWaterHintRow => ({
  parameterCode: "KH",
  label: "KH",
  unit: "dKH",
  value: 6.5,
  measuredAt: "2026-11-11T10:00:00.000Z",
  status: "ALATTA",
  range: { min: 7, max: 9 },
  text: "A(z) KH mért értéke 6,5 dKH, az ajánlott tartomány (7 és 9 dKH) alatt van.",
  products: [],
  ...over,
});

const hints = (over: Partial<ReefClubWaterHints> = {}): ReefClubWaterHints => ({
  state: "OK",
  registerVersion: "vevoi-savok-2026-11-11-v1",
  disclaimer: "Tájékoztató jellegű, nem helyettesíti a szakértő véleményét.",
  productsState: "NONE",
  rows: [row()],
  ...over,
});

const product = {
  productId: "p1",
  name: "Minta KH+",
  category: "Adalékok",
  shopUrl: "https://shop.example/p1",
  manufacturerUrl: "https://gyarto.example/p1",
  sideEffectsText: null,
};

function view(answer: () => Response) {
  const api = mockApi({ "GET /aquariums/a1/water-hints": answer });
  const result = render(<WaterHintsPanel aquarium={AQUARIUM} />);
  return { api, ...result };
}

describe("a kapcsoló és a betöltés", () => {
  it("OFF: semmi nem látszik (a kikapcsolt funkció nem üres doboz)", async () => {
    const { api, container } = view(() =>
      reply(200, hints({ state: "OFF", rows: [], disclaimer: null })),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
    expect(api.calls).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/aquariums/a1/water-hints",
      }),
    ]);
  });

  it("betöltés közben és hibánál sem látszik semmi (egy olvashatatlan tipp nem tipp); csak olvas", async () => {
    const { api, container } = view(() => reply(500, { message: "hiba" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
    expect(api.calls.every((call) => call.method === "GET")).toBe(true);
  });
});

describe("az állapotok", () => {
  it("nem tengeri víz: nincs tanács, egy mondat mondja meg miért", async () => {
    view(() =>
      reply(
        200,
        hints({
          state: "NOT_AVAILABLE",
          reason: "WATER_TYPE",
          rows: [],
          disclaimer: null,
        }),
      ),
    );
    expect(
      await screen.findByText(/csak tengeri vízre tudjuk megmondani/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("water-hint")).toBeNull();
  });

  it("nincs mérés: egy mondat, sor nincs", async () => {
    view(() =>
      reply(
        200,
        hints({ state: "NO_MEASUREMENT", rows: [], disclaimer: null }),
      ),
    );
    expect(
      await screen.findByText(/Még nincs mérésed KH-ra/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("water-hint")).toBeNull();
  });
});

describe("a sorok", () => {
  it("a szerver mondata, a jelvény, a mérés ideje és a nyilatkozat szó szerint; a lap nem ír hozzá", async () => {
    view(() => reply(200, hints()));
    const item = await screen.findByTestId("water-hint");
    expect(within(item).getByText("KH")).toBeInTheDocument();
    expect(within(item).getByText("Alatta")).toBeInTheDocument();
    expect(
      within(item).getByText(
        "A(z) KH mért értéke 6,5 dKH, az ajánlott tartomány (7 és 9 dKH) alatt van.",
      ),
    ).toBeInTheDocument();
    expect(within(item).getByText(/Mérve:/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tájékoztató jellegű, nem helyettesíti a szakértő véleményét.",
      ),
    ).toBeInTheDocument();
  });

  it("a jelvények: alatta, felette, rendben, régi mérés", async () => {
    view(() =>
      reply(
        200,
        hints({
          rows: [
            row({ parameterCode: "KH", status: "ALATTA" }),
            row({
              parameterCode: "KALCIUM",
              label: "Kalcium",
              status: "FELETTE",
            }),
            row({
              parameterCode: "MAGNEZIUM",
              label: "Magnézium",
              status: "TARTOMANYBAN",
            }),
            row({
              parameterCode: "NITRAT",
              label: "Nitrát",
              status: "TUL_REGI",
              range: null,
            }),
          ],
        }),
      ),
    );
    const items = await screen.findAllByTestId("water-hint");
    expect(
      items.map(
        (item) =>
          within(item).getByText(/^(Alatta|Felette|Rendben|Régi mérés)$/)
            .textContent,
      ),
    ).toEqual(["Alatta", "Felette", "Rendben", "Régi mérés"]);
  });
});

describe("a termékek", () => {
  it("eltérésnél: a termék neve a bolti lapra, a gyártói leírás a gyártó hivatkozására mutat, mindkettő új lapon, noopener noreferrer", async () => {
    view(() =>
      reply(
        200,
        hints({ productsState: "OK", rows: [row({ products: [product] })] }),
      ),
    );
    const name = await screen.findByRole("link", { name: "Minta KH+" });
    expect(name).toHaveAttribute("href", "https://shop.example/p1");
    const maker = screen.getByRole("link", { name: "Gyártói leírás" });
    expect(maker).toHaveAttribute("href", "https://gyarto.example/p1");
    for (const link of [name, maker]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("bolti lap nélkül a név nem link, a gyártói leírás marad", async () => {
    view(() =>
      reply(
        200,
        hints({
          productsState: "OK",
          rows: [row({ products: [{ ...product, shopUrl: null }] })],
        }),
      ),
    );
    expect(await screen.findByText("Minta KH+")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Minta KH+" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Gyártói leírás" }),
    ).toBeInTheDocument();
  });

  it("a mellékhatás sora (tanács és sáv nélkül) kiíródik, ha van; ha nincs, nincs sor", async () => {
    view(() =>
      reply(
        200,
        hints({
          productsState: "OK",
          rows: [
            row({
              status: "FELETTE",
              parameterCode: "NITRAT",
              label: "Nitrát",
              products: [
                {
                  ...product,
                  productId: "a",
                  name: "Nitrát-csökkentő",
                  sideEffectsText: "Emellett hat: foszfát (csökkenti).",
                },
                {
                  ...product,
                  productId: "b",
                  name: "Másik szer",
                  sideEffectsText: null,
                },
              ],
            }),
          ],
        }),
      ),
    );
    expect(
      await screen.findByText("Emellett hat: foszfát (csökkenti)."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Emellett hat/)).toHaveLength(1);
  });

  it("eltérés termék nélkül: kimondja, hogy most nincs ajánlott termék (az üres lista nem ajánlás)", async () => {
    view(() => reply(200, hints()));
    expect(
      await screen.findByText(/most nincs ajánlott termék a listánkban/),
    ).toBeInTheDocument();
  });

  it("a rendben lévő érték mellett nincs termék és nincs 'nincs termék' sor sem; a régi mérés mellett sem", async () => {
    view(() =>
      reply(
        200,
        hints({
          rows: [
            row({ status: "TARTOMANYBAN", products: [product] }),
            row({ parameterCode: "NITRAT", status: "TUL_REGI", range: null }),
          ],
        }),
      ),
    );
    await screen.findAllByTestId("water-hint");
    expect(screen.queryByRole("link", { name: "Minta KH+" })).toBeNull();
    expect(screen.queryByText(/most nincs ajánlott termék/)).toBeNull();
  });

  it("régi termékajánló: az Alert szól, termék nem jelenik meg, és a 'nincs termék' sor nem tévesztheti meg", async () => {
    view(() => reply(200, hints({ productsState: "STALE" })));
    expect(
      await screen.findByText("A termékajánló most nem elérhető"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/most nincs ajánlott termék/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Gyártói leírás" })).toBeNull();
  });
});
