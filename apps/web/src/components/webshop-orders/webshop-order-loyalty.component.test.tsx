import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WebshopOrderLoyalty,
  loyaltyEntryLabel,
  parsePointsInput,
  signedPoints,
  type LoyaltyCardApi,
} from "./webshop-order-loyalty";

/*
  A HŰSÉGPONTOK KÁRTYÁJA (kártya dfb79916). MI PIROSÍT: egy vendég rendelés nullás egyenleget mutat a „nincs főkönyv”
  helyett; az egyenleg és a sorok nem a webshop válaszából jönnek; a pontszám nem egész, nulla vagy mínusz jel nélküli
  levonás átmegy a mentésen; az indok nélküli mozgás elmegy; a gomb jog nélkül is megjelenik; a párbeszédablak kétszeri
  mentése két azonosítóval megy (a webshop kulcsa nem ugyanaz marad); a hiba a kártyán marad a saját mondatával, és a
  mentés után az egyenleg az új válaszból frissül.
*/
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font-pilot" }),
}));

afterEach(cleanup);

const ENTRY = {
  id: "loyent_1",
  kind: "adjustment",
  points: 200,
  orderId: null,
  reason: "Késedelem miatti jóváírás",
  actor: "user_1",
  createdAt: "2026-11-19T00:10:00.000Z",
};

const ready = (over: Partial<LoyaltyCardApi> = {}): LoyaltyCardApi => ({
  load: vi
    .fn()
    .mockResolvedValue({ available: true, balance: 1250, entries: [ENTRY] }),
  adjust: vi.fn(),
  ...over,
});

const show = (api: LoyaltyCardApi, canManage = true) =>
  render(createElement(WebshopOrderLoyalty, { api, canManage }));

describe("the pure helpers", () => {
  it("labels a manual movement by its sign and the others by their kind", () => {
    expect(loyaltyEntryLabel({ kind: "adjustment", points: 5 })).toBe(
      "Kézi jóírás",
    );
    expect(loyaltyEntryLabel({ kind: "adjustment", points: -5 })).toBe(
      "Kézi levonás",
    );
    expect(loyaltyEntryLabel({ kind: "accrual", points: 5 })).toBe("Gyűjtés");
    expect(loyaltyEntryLabel({ kind: "redemption", points: -5 })).toBe(
      "Beváltás",
    );
    expect(loyaltyEntryLabel({ kind: "reversal", points: -5 })).toBe(
      "Visszavonás",
    );
  });

  it("writes the sign out, with a real minus", () => {
    expect(signedPoints(200)).toBe("+200");
    expect(signedPoints(-50)).toBe("−50");
  });

  it("reads a whole, non-zero number, with an optional plus or minus, and nothing else", () => {
    expect(parsePointsInput("200")).toBe(200);
    expect(parsePointsInput(" +200 ")).toBe(200);
    expect(parsePointsInput("-50")).toBe(-50);
    expect(parsePointsInput("−50")).toBe(-50);
    for (const bad of [
      "",
      "0",
      "-0",
      "1.5",
      "1,5",
      "12a",
      "--5",
      "10000001",
      "+-5",
    ])
      expect(parsePointsInput(bad), bad).toBeNull();
  });
});

describe("the card", () => {
  it("says a guest order has no ledger, and shows no balance and no button", async () => {
    show(ready({ load: vi.fn().mockResolvedValue({ available: false }) }));
    expect(
      await screen.findByText(/Vendég rendeléshez nincs hűségpont-főkönyv/),
    ).toBeTruthy();
    expect(screen.queryByTestId("loyalty-balance")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pont jóváírása/ })).toBeNull();
  });

  it("shows the balance and the rows from the shop's answer", async () => {
    show(ready());
    expect(
      (await screen.findByTestId("loyalty-balance")).textContent,
    ).toContain("pont");
    expect(screen.getByTestId("loyalty-balance").textContent).toMatch(
      /^1\s?250 pont$/,
    );
    expect(
      screen.getByText(/Kézi jóírás · Késedelem miatti jóváírás/),
    ).toBeTruthy();
    expect(screen.getByText("+200")).toBeTruthy();
  });

  it("offers the movement only with the right to manage", async () => {
    show(ready(), false);
    await screen.findByTestId("loyalty-balance");
    expect(screen.queryByRole("button", { name: /Pont jóváírása/ })).toBeNull();
  });

  it("keeps the shop's failure on the card in its own words", async () => {
    show(
      ready({
        load: vi
          .fn()
          .mockRejectedValue(new Error("A webshop nem érhető el (HTTP 503).")),
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "HTTP 503",
    );
  });
});

describe("the dialog", () => {
  const open = async (api: LoyaltyCardApi) => {
    show(api);
    await screen.findByTestId("loyalty-balance");
    fireEvent.click(screen.getByRole("button", { name: /Pont jóváírása/ }));
    return {
      points: screen.getByLabelText("Pont") as HTMLInputElement,
      reason: screen.getByLabelText("Indok") as HTMLInputElement,
      save: screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement,
    };
  };

  it("saves only a valid, explained movement", async () => {
    const { points, reason, save } = await open(ready());
    expect(save.disabled).toBe(true);
    fireEvent.change(points, { target: { value: "0" } });
    fireEvent.change(reason, { target: { value: "x" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(points, { target: { value: "1.5" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(points, { target: { value: "-50" } });
    fireEvent.change(reason, { target: { value: "   " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "Téves jóváírás javítása" } });
    expect(save.disabled).toBe(false);
  });

  it("sends the points, the trimmed reason and a request id, then shows the balance of the answer", async () => {
    const adjust = vi.fn().mockResolvedValue({
      balance: 1200,
      created: true,
      loyalty: {
        available: true,
        balance: 1200,
        entries: [{ ...ENTRY, id: "loyent_2", points: -50 }],
      },
    });
    const { points, reason, save } = await open(ready({ adjust }));
    fireEvent.change(points, { target: { value: "-50" } });
    fireEvent.change(reason, {
      target: { value: "  Téves jóváírás javítása " },
    });
    fireEvent.click(save);
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1));
    expect(adjust.mock.calls[0]![0]).toMatchObject({
      points: -50,
      reason: "Téves jóváírás javítása",
    });
    expect(String(adjust.mock.calls[0]![0].requestId).length).toBeGreaterThan(
      7,
    );
    await waitFor(() => expect(screen.getByText("−50")).toBeTruthy());
    expect(screen.getByTestId("loyalty-balance").textContent).toMatch(
      /^1\s?200 pont$/,
    );
  });

  it("keeps the dialog open with the shop's sentence when it refuses, and reuses the request id on a retry", async () => {
    const adjust = vi
      .fn()
      .mockRejectedValueOnce(new Error("A levonás a vevő egyenlege alá menne."))
      .mockRejectedValueOnce(
        new Error("A levonás a vevő egyenlege alá menne."),
      );
    const { points, reason, save } = await open(ready({ adjust }));
    fireEvent.change(points, { target: { value: "-5000" } });
    fireEvent.change(reason, { target: { value: "Teszt" } });
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "egyenlege alá menne",
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2));
    expect(adjust.mock.calls[1]![0].requestId).toBe(
      adjust.mock.calls[0]![0].requestId,
    );
  });

  /*
    A SIKERES JOVAIRAS UTAN AZ URLAP LEZAR, A KOVETKEZO UJ AZONOSITOT KAP (nautilus, 57033). A requestId a shop idempotencia-kulcsa
    (`reference`): ugyanaz a kulcs ugyanazzal a ponttal es indokkal "replayed", semmi nem tarolodik; mas ponttal 409. Ezert a masodik,
    KULON jovairas nem kuldhet az elso azonositojat. MI PIROSIT: ha a sikeres mentes utan a parbeszed nyitva marad (ugyanaz az
    azonosito), vagy az azonosito a megnyitasoktol fuggetlen (modul-szintu).
  */
  it("closes after a saved movement, and the next movement gets a new request id (the shop would otherwise replay the first)", async () => {
    const adjust = vi.fn().mockResolvedValue({
      balance: 1200,
      created: true,
      loyalty: {
        available: true,
        balance: 1200,
        entries: [{ ...ENTRY, id: "loyent_2", points: 100 }],
      },
    });
    const first = await open(ready({ adjust }));
    fireEvent.change(first.points, { target: { value: "100" } });
    fireEvent.change(first.reason, { target: { value: "Első jóírás" } });
    fireEvent.click(first.save);
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1));
    // the dialog is gone after the save: no second movement can be sent from it
    await waitFor(() => expect(screen.queryByLabelText("Pont")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Pont jóváírása/ }));
    fireEvent.change(screen.getByLabelText("Pont"), {
      target: { value: "200" },
    });
    fireEvent.change(screen.getByLabelText("Indok"), {
      target: { value: "Második jóírás" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(2));
    expect(adjust.mock.calls[1]![0].requestId).not.toBe(
      adjust.mock.calls[0]![0].requestId,
    );
    expect(adjust.mock.calls[1]![0]).toMatchObject({
      points: 200,
      reason: "Második jóírás",
    });
  });
});
