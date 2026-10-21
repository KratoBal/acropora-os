import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ReefClubAquarium,
  ReefClubDoseItem,
  ReefClubRecommendationItem,
} from "@/lib/types";
import { mockApi, reply } from "@/test/mock-api";

import { RecommendationPanel } from "./recommendation-panel";

afterEach(() => undefined);

/**
 * THE RECOMMENDATION PANEL (ReefClub slice 9, the screen). Made-up data. What
 * the page must do: ask only on a click (a POST reserves the daily limit),
 * show the server's sentence as it is, say a stale dose list in so many words,
 * answer an open recommendation in the three ways, never send a recommendation
 * id with a free dose, and mark what another linked account recorded.
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

const NOW = new Date("2026-10-21T12:00:00.000Z");

const recommendation = (
  over: Partial<ReefClubRecommendationItem> = {},
): ReefClubRecommendationItem => ({
  id: "rec-1",
  parameter: "KH",
  text: "A KH alacsony; javasolt adag: 8 ml Minta KH+ naponta, 1 napon át. Forrás: Gyártói címke (teszt). Mérj újra 12 óra elteltével, mielőtt újra adagolsz.",
  amount: 8,
  unit: "ML",
  durationDays: 1,
  product: { id: "p-kh", name: "Minta KH+" },
  source: "Gyártói címke (teszt)",
  status: "OPEN",
  createdAt: "2026-10-21T11:00:00.000Z",
  effectEndsAt: "2026-10-21T23:00:00.000Z",
  byOtherAccount: false,
  ...over,
});

const dose = (over: Partial<ReefClubDoseItem> = {}): ReefClubDoseItem => ({
  id: "d-1",
  parameter: "KH",
  product: { id: "p-kh", name: "Minta KH+" },
  amount: 4,
  unit: "ML",
  administeredAt: "2026-10-21T10:00:00.000Z",
  recommendationId: null,
  byOtherAccount: false,
  ...over,
});

function view(routes: Parameters<typeof mockApi>[0]) {
  const api = mockApi(routes);
  render(<RecommendationPanel aquarium={AQUARIUM} now={() => NOW} />);
  return api;
}

const lists = (
  items: ReefClubRecommendationItem[] = [],
  doses: ReefClubDoseItem[] = [],
) => ({
  "GET /aquariums/a1/recommendations": () => reply(200, { items }),
  "GET /aquariums/a1/doses": () => reply(200, { items: doses }),
});

describe("a javaslat kérése", () => {
  it("betöltéskor csak olvas: POST nem megy el (egy POST foglalja a napi keretet)", async () => {
    const { calls } = view(lists());
    await screen.findByText("Még nincs javaslat ehhez az akváriumhoz.");
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(
      screen.getAllByRole("button", { name: /Javaslat kérése:/ }),
    ).toHaveLength(5);
  });

  it("a kattintás az adott paraméterre kér, és a szerver mondatát mutatja szó szerint", async () => {
    const user = userEvent.setup();
    const sentence = recommendation().text;
    const { calls } = view({
      ...lists(),
      "POST /aquariums/a1/recommendations": () =>
        reply(201, {
          outcome: "DOSE",
          parameter: "KH",
          text: sentence,
          recommendationId: "rec-1",
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Javaslat kérése: KH" }),
    );
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.body).toEqual({ parameter: "KH" });
  });

  it("elavult termék-adag lista: kimondja, nem üres hely", async () => {
    const user = userEvent.setup();
    view({
      ...lists(),
      "POST /aquariums/a1/recommendations": () =>
        reply(201, {
          outcome: "NO_DOSE",
          parameter: "KH",
          reason: "DOSE_LIST_STALE",
          text: "Az adagoláshoz szükséges termék-adag lista most nem friss; adagot nem javaslunk, kérdezd a boltot.",
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Javaslat kérése: KH" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A termék-adag lista most nem friss");
    expect(alert).toHaveTextContent("kérdezd a boltot");
  });

  it("más elutasítás (nincs adag) a szerver mondata, hibaként nem jelenik meg", async () => {
    const user = userEvent.setup();
    view({
      ...lists(),
      "POST /aquariums/a1/recommendations": () =>
        reply(201, {
          outcome: "NO_DOSE",
          parameter: "KALCIUM",
          reason: "MEASUREMENT_TOO_OLD",
          text: "A mérés régebbi 3 napnál; mérj újra, mielőtt adagolsz.",
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: /Javaslat kérése: kalcium/i }),
    );
    expect(
      await screen.findByText(
        "A mérés régebbi 3 napnál; mérj újra, mielőtt adagolsz.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("egy másik fiók nyitott javaslata: megmondja, és nem küld választ helyette", async () => {
    const user = userEvent.setup();
    view({
      ...lists(),
      "POST /aquariums/a1/recommendations": () =>
        reply(201, {
          outcome: "ACTIVE",
          parameter: "KH",
          text: "A KH alacsony; javasolt adag: 8 ml Minta KH+.",
          recommendationId: "rec-9",
          byOtherAccount: true,
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Javaslat kérése: KH" }),
    );
    expect(
      await screen.findByText(/amit másik fiók kapott/),
    ).toBeInTheDocument();
    expect(screen.getByText(/amelyik kapta/)).toBeInTheDocument();
  });

  it("a szerver hibája látszik", async () => {
    const user = userEvent.setup();
    view({
      ...lists(),
      "POST /aquariums/a1/recommendations": () =>
        reply(429, { message: "Túl sok kérés. Próbáld újra egy perc múlva." }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Javaslat kérése: KH" }),
    );
    expect(
      await screen.findByText("Túl sok kérés. Próbáld újra egy perc múlva."),
    ).toBeInTheDocument();
  });
});

describe("a javaslat megválaszolása", () => {
  const answerRoute = "POST /aquariums/a1/recommendations/rec-1/answer";

  it("Beadtam: GIVEN, művelet-azonosítóval, mennyiség nélkül (az ajánlott mennyiséget a szerver tudja)", async () => {
    const user = userEvent.setup();
    const { calls } = view({
      ...lists([recommendation()]),
      [answerRoute]: () => reply(201, { doseId: "d-1", warnings: [] }),
    });
    await user.click(await screen.findByRole("button", { name: "Beadtam" }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    const body = calls.find((call) => call.method === "POST")!.body as Record<
      string,
      unknown
    >;
    expect(body.answer).toBe("GIVEN");
    expect(body).not.toHaveProperty("amount");
    expect(typeof body.clientOperationId).toBe("string");
  });

  it("Nem adtam be: NOT_GIVEN, adag és azonosító nélkül", async () => {
    const user = userEvent.setup();
    const { calls } = view({
      ...lists([recommendation()]),
      [answerRoute]: () => reply(201, { doseId: null, warnings: [] }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Nem adtam be" }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    expect(calls.find((call) => call.method === "POST")!.body).toEqual({
      answer: "NOT_GIVEN",
    });
  });

  it("Részben: a mennyiség kell; a szerver megerősítést kér (409), és csak a megerősítés küldi confirmed-del", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = view({
      ...lists([recommendation()]),
      [answerRoute]: () => {
        attempts += 1;
        return attempts === 1
          ? reply(409, {
              message:
                "A beadott mennyiség eltér az ajánlottól; erősítsd meg, hogy ezt adtad be.",
              code: "NEEDS_CONFIRMATION",
              recommendedAmount: 8,
            })
          : reply(201, { doseId: "d-2", warnings: [] });
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Részben adtam be" }),
    );
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText(/Add meg, mennyit adtál be/),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);

    await user.type(screen.getByLabelText(/Beadott mennyiség/), "3");
    await user.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText(/erősítsd meg, hogy ezt adtad be/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Igen, ennyit adtam be" }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(2),
    );
    const [first, second] = calls.filter((call) => call.method === "POST");
    expect(first!.body).toMatchObject({ answer: "PARTIAL", amount: 3 });
    expect(first!.body).not.toHaveProperty("confirmed");
    expect(second!.body).toMatchObject({
      answer: "PARTIAL",
      amount: 3,
      confirmed: true,
    });
    // the same attempt keeps its key, so a lost answer is not a second dose
    expect((first!.body as Record<string, unknown>).clientOperationId).toBe(
      (second!.body as Record<string, unknown>).clientOperationId,
    );
  });

  it("másik fiók javaslatán nincs válasz-gomb, de látszik, hogy az övé; megválaszolt és lejárt javaslaton sincs", async () => {
    view(
      lists([
        recommendation({ id: "rec-2", byOtherAccount: true }),
        recommendation({ id: "rec-3", status: "GIVEN" }),
        recommendation({ id: "rec-4", status: "EXPIRED" }),
      ]),
    );
    expect(await screen.findAllByText("Másik fiók rögzítette")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Beadtam" })).toBeNull();
    expect(screen.getByText("Beadtad")).toBeInTheDocument();
    expect(screen.getByText("Lejárt, nincs visszajelzés")).toBeInTheDocument();
    expect(
      screen.getByText(/Ezt másik fiók kapta; a beadást az a fiók jelezheti/),
    ).toBeInTheDocument();
  });

  it("a kártya a terméket, a forrást és a mondatot mutatja", async () => {
    view(lists([recommendation()]));
    const card = (await screen.findByText("Termék:")).closest("article")!;
    expect(within(card).getByText("Minta KH+")).toBeInTheDocument();
    expect(within(card).getByText("Gyártói címke (teszt)")).toBeInTheDocument();
    expect(
      within(card).getByText(/javasolt adag: 8 ml Minta KH\+/),
    ).toBeInTheDocument();
  });
});

describe("a beadott adag rögzítése", () => {
  it("más termék, mennyiség nélkül: null termék, null mennyiség és egység, azonosítóval, ajánlás-azonosító nélkül", async () => {
    const user = userEvent.setup();
    const { calls } = view({
      ...lists(),
      "POST /aquariums/a1/doses": () =>
        reply(201, { doseId: "d-1", warnings: [] }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Adag rögzítése" }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    const body = calls.find((call) => call.method === "POST")!.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      parameter: "KH",
      productId: null,
      amount: null,
      unit: null,
    });
    expect(typeof body.clientOperationId).toBe("string");
    expect(body).not.toHaveProperty("recommendationId");
    expect(await screen.findByText("Az adag mentve")).toBeInTheDocument();
  });

  it("listán szereplő termékhez a mennyiség kell, és a nulla nem adag", async () => {
    const user = userEvent.setup();
    view(lists([recommendation()]));
    await user.selectOptions(await screen.findByLabelText("Termék"), "p-kh");
    expect(
      screen.getByText("Listán szereplő termékhez add meg a mennyiséget."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adag rögzítése" }),
    ).toBeDisabled();
    await user.type(screen.getByLabelText("Mennyiség"), "0");
    expect(
      screen.getByText("A mennyiség nullánál nagyobb szám legyen."),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Mennyiség"));
    await user.type(screen.getByLabelText("Mennyiség"), "2,5");
    expect(
      screen.getByRole("button", { name: "Adag rögzítése" }),
    ).toBeEnabled();
  });

  it("listás terméknél a mértékegység a termék javaslatáé és nem állítható (barracuda, #1760)", async () => {
    const user = userEvent.setup();
    const { calls } = view({
      ...lists([
        recommendation({
          product: { id: "p-g", name: "Minta por" },
          unit: "G",
        }),
      ]),
      "POST /aquariums/a1/doses": () =>
        reply(201, { doseId: "d-4", warnings: [] }),
    });
    const unit = await screen.findByLabelText("Mértékegység");
    expect(unit).toHaveValue("ML");
    expect(unit).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Termék"), "p-g");
    expect(screen.getByLabelText("Mértékegység")).toHaveValue("G");
    expect(screen.getByLabelText("Mértékegység")).toBeDisabled();
    await user.type(screen.getByLabelText("Mennyiség"), "3");
    await user.click(screen.getByRole("button", { name: "Adag rögzítése" }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    expect(calls.find((call) => call.method === "POST")!.body).toMatchObject({
      productId: "p-g",
      amount: 3,
      unit: "G",
    });
  });

  it("a mentés a mennyiséget tizedesvesszővel is érti, és a figyelmeztetést kiírja", async () => {
    const user = userEvent.setup();
    const { calls } = view({
      ...lists([recommendation()]),
      "POST /aquariums/a1/doses": () =>
        reply(201, {
          doseId: "d-3",
          warnings: [
            {
              code: "ABOVE_DAILY_LIMIT",
              message:
                "Ez a napi korlátnál nagyobb változást adna; rögzítettük, de erre a paraméterre most nem ajánlunk többet.",
            },
          ],
        }),
    });
    await user.selectOptions(await screen.findByLabelText("Termék"), "p-kh");
    await user.type(screen.getByLabelText("Mennyiség"), "12,5");
    await user.click(screen.getByRole("button", { name: "Adag rögzítése" }));
    expect(
      await screen.findByText(/most nem ajánlunk többet/),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")!.body).toMatchObject({
      productId: "p-kh",
      amount: 12.5,
      unit: "ML",
    });
  });

  it("a jövőbeli időpontot a lap kimondja, és nem küld", async () => {
    const user = userEvent.setup();
    const { calls } = view(lists());
    const moment = await screen.findByLabelText("Beadás időpontja");
    await user.clear(moment);
    await user.type(moment, "2026-10-22T12:00");
    expect(
      screen.getByText("A beadás időpontja nem lehet a jövőben."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Adag rögzítése" }),
    ).toBeDisabled();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("a szerver elutasítása a saját szavaival látszik", async () => {
    const user = userEvent.setup();
    view({
      ...lists(),
      "POST /aquariums/a1/doses": () =>
        reply(400, {
          message: "Ehhez a paraméterhez nem rögzíthető adag.",
          code: "INVALID_PARAMETER",
        }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Adag rögzítése" }),
    );
    expect(
      await screen.findByText("Ehhez a paraméterhez nem rögzíthető adag."),
    ).toBeInTheDocument();
  });
});

describe("a rögzített adagok listája", () => {
  it("a más termék és az ismeretlen mennyiség nevén nevezve; a másik fiókét jelzi", async () => {
    view(
      lists(
        [],
        [
          dose(),
          dose({ id: "d-2", product: null, amount: null, unit: null }),
          dose({ id: "d-3", byOtherAccount: true }),
        ],
      ),
    );
    expect(await screen.findAllByText("Minta KH+: 4 ml")).toHaveLength(2);
    expect(
      screen.getByText("Más termék, a mennyiség nem ismert"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Másik fiók rögzítette")).toHaveLength(1);
  });
});
