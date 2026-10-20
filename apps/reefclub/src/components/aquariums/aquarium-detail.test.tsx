import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, reply } from "@/test/mock-api";

import { AquariumDetail } from "./aquarium-detail";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const OWN = {
  id: "a1",
  origin: "OWN",
  name: "Nappali nano",
  waterBodyType: "AKVARIUM",
  waterType: "TENGERI",
  systemVolumeLiters: 120,
  sharedWithShopAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
};
const SHOP = {
  ...OWN,
  id: "s1",
  origin: "SHOP",
  name: "Bolti medence",
  waterType: null,
  systemVolumeLiters: null,
};

const value = (
  parameterCode: string,
  v: number,
  extra: Record<string, unknown> = {},
) => ({
  parameterCode,
  value: v,
  unit: parameterCode === "PH" ? "pH" : "mg/l",
  target: parameterCode === "PH" ? { min: 8, max: 8.4 } : null,
  status: "OK",
  direction: null,
  trend: "STABLE",
  ...extra,
});
const NEW_OCCASION = {
  id: "2026-10-03T10:00:00.000Z",
  measuredAt: "2026-10-03T10:00:00.000Z",
  source: "MANUAL",
  values: [
    value("PH", 8.7, {
      status: "ALERT",
      direction: "HIGH",
      trend: "WORSENING",
    }),
    value("NITRAT", 4),
  ],
};
const OLD_OCCASION = {
  id: "2026-10-01T10:00:00.000Z",
  measuredAt: "2026-10-01T10:00:00.000Z",
  source: "SHOP",
  values: [value("PH", 8.1)],
};

function routes(
  aquarium: Record<string, unknown>,
  occasions: unknown[],
  extra: Parameters<typeof mockApi>[0] = {},
) {
  const id = String(aquarium.id);
  return mockApi({
    [`GET /aquariums/${id}`]: () => reply(200, aquarium),
    [`GET /aquariums/${id}/measurements`]: () => reply(200, { occasions }),
    [`GET /aquariums/${id}/targets`]: () =>
      reply(200, { targets: [{ parameterCode: "PH", min: 8, max: 8.4 }] }),
    ...extra,
  });
}

describe("AquariumDetail: an own aquarium", () => {
  it("shows its data, its own target range and the measurements with the server's words for each value", async () => {
    routes(OWN, [NEW_OCCASION, OLD_OCCASION]);
    render(<AquariumDetail id="a1" />);

    expect(
      await screen.findByRole("heading", { name: /Nappali nano/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tengeri/)).toBeInTheDocument();
    const targets = screen.getByRole("region", { name: "Célsávok" });
    expect(within(targets).getByText("pH")).toBeInTheDocument();
    expect(within(targets).getByText("8 – 8,4")).toBeInTheDocument();

    const first = (await screen.findByText(/Saját mérés/)).closest("li")!;
    expect(within(first).getByText("Riasztás")).toBeInTheDocument();
    expect(within(first).getByText("magas")).toBeInTheDocument();
    expect(within(first).getByText("romlik")).toBeInTheDocument();
    expect(within(first).getByText(/8,7 pH/)).toBeInTheDocument();
    const shopOne = screen.getByText(/Bolti mérés/).closest("li")!;
    expect(within(shopOne).getByText("Rendben")).toBeInTheDocument();
    // a shop occasion of an own aquarium is not the account's to delete
    expect(
      within(shopOne).queryByRole("button", { name: "Törlés" }),
    ).toBeNull();
    expect(
      within(first).getByRole("button", { name: "Törlés" }),
    ).toBeInTheDocument();
  });

  it("offers the chart for the measured parameters only, and says when one value is not enough", async () => {
    routes(OWN, [NEW_OCCASION, OLD_OCCASION]);
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    const select = await screen.findByLabelText("Grafikon paramétere");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["pH", "Nitrát"]);
    // pH has two values: a chart with a text description
    expect(
      screen.getByRole("img", { name: "pH alakulása: 2 mérés" }),
    ).toBeInTheDocument();
    await user.selectOptions(select, "NITRAT");
    expect(screen.getByText(/legalább két mérés kell/)).toBeInTheDocument();
  });

  it("records a manual measurement: the filled parameters only, a decimal comma read right, one operation id, then the list reloads", async () => {
    let saved = false;
    const { calls } = routes(OWN, [], {});
    // the occasions answer changes after the save
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input).replace(/^\/rc\/v1/, "");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        method,
        path: url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: {},
      });
      if (method === "POST" && url === "/aquariums/a1/measurements") {
        saved = true;
        return reply(201, NEW_OCCASION);
      }
      if (url === "/aquariums/a1") return reply(200, OWN);
      if (url === "/aquariums/a1/targets") return reply(200, { targets: [] });
      if (url === "/aquariums/a1/measurements")
        return reply(200, { occasions: saved ? [NEW_OCCASION] : [] });
      return reply(599, {});
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    expect(
      await screen.findByText("Még nincs mérés ennél az akváriumnál."),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^pH \(/), "8,7");
    await user.type(screen.getByLabelText(/^Nitrát \(/), "4");
    await user.click(screen.getByRole("button", { name: "Mérés mentése" }));

    expect(await screen.findByText("A mérés mentve")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      values: [
        { parameterCode: "PH", value: 8.7 },
        { parameterCode: "NITRAT", value: 4 },
      ],
    });
    expect(
      (post.body as { clientOperationId: string }).clientOperationId,
    ).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(
      Date.parse((post.body as { measuredAt: string }).measuredAt),
    ).not.toBeNaN();
    expect(await screen.findByText(/Saját mérés/)).toBeInTheDocument();
    // the typed values are gone after a save
    expect(screen.getByLabelText(/^pH \(/)).toHaveValue("");
  });

  it("keeps the same operation id when a save fails, so a retry cannot make a second occasion", async () => {
    let attempts = 0;
    const { calls } = routes(OWN, [], {
      "POST /aquariums/a1/measurements": () => {
        attempts += 1;
        return attempts === 1 ? reply(502, {}) : reply(201, NEW_OCCASION);
      },
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    await user.type(await screen.findByLabelText(/^pH \(/), "8,2");
    await user.click(screen.getByRole("button", { name: "Mérés mentése" }));
    expect(
      await screen.findByText("A mérés nem mentődött"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mérés mentése" }));
    await waitFor(() => expect(attempts).toBe(2));
    const ids = calls
      .filter((c) => c.method === "POST")
      .map((c) => (c.body as { clientOperationId: string }).clientOperationId);
    expect(ids[0]).toBe(ids[1]);
  });

  it("refuses a moment in the future and a value that is not a number, before sending anything", async () => {
    const { calls } = routes(OWN, []);
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    const moment = await screen.findByLabelText("Mérés időpontja");
    await user.type(screen.getByLabelText(/^pH \(/), "8,2");
    expect(screen.getByRole("button", { name: "Mérés mentése" })).toBeEnabled();

    await user.clear(moment);
    await user.type(moment, "2999-01-01T10:00");
    expect(
      screen.getByText("A mérés időpontja nem lehet a jövőben."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mérés mentése" }),
    ).toBeDisabled();

    await user.clear(moment);
    await user.type(moment, "2026-10-01T10:00");
    await user.clear(screen.getByLabelText(/^pH \(/));
    await user.type(screen.getByLabelText(/^pH \(/), "sok");
    expect(screen.getByText("Számot írj, például 8,2.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mérés mentése" }),
    ).toBeDisabled();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("deletes an occasion only after a second question, naming it by its encoded id", async () => {
    let gone = false;
    const { calls } = routes(OWN, [NEW_OCCASION]);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input).replace(/^\/rc\/v1/, "");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path: url, body: undefined, headers: {} });
      if (method === "DELETE") {
        gone = true;
        return reply(204);
      }
      if (url === "/aquariums/a1") return reply(200, OWN);
      if (url === "/aquariums/a1/targets") return reply(200, { targets: [] });
      if (url === "/aquariums/a1/measurements")
        return reply(200, { occasions: gone ? [] : [NEW_OCCASION] });
      return reply(599, {});
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    const card = (await screen.findByText(/Saját mérés/)).closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Törlés" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Igen, törlöm" }));

    expect(
      await screen.findByText("Még nincs mérés ennél az akváriumnál."),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe(
      "/aquariums/a1/measurements/2026-10-03T10%3A00%3A00.000Z",
    );
  });

  it("edits the aquarium: a cleared volume and water go as null, not as a missing key", async () => {
    const { calls } = routes(OWN, [], {
      "PATCH /aquariums/a1": () =>
        reply(200, {
          ...OWN,
          name: "Átnevezve",
          waterType: null,
          systemVolumeLiters: null,
        }),
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    await user.click(
      await screen.findByRole("button", { name: "Szerkesztés" }),
    );
    await user.clear(screen.getByLabelText("Név"));
    await user.type(screen.getByLabelText("Név"), "Átnevezve");
    await user.selectOptions(screen.getByLabelText("Víz"), "");
    await user.clear(screen.getByLabelText(/Nettó térfogat/));
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
      name: "Átnevezve",
      waterBodyType: "AKVARIUM",
      waterType: null,
      systemVolumeLiters: null,
    });
  });

  it("deletes the aquarium only after a second question, then goes back to the list", async () => {
    const { calls } = routes(OWN, [], {
      "DELETE /aquariums/a1": () => reply(204),
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    await user.click(
      (await screen.findAllByRole("button", { name: "Törlés" }))[0]!,
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Igen, törlöm" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/akvariumok"),
    );
  });
});

describe("AquariumDetail: a shop aquarium and a missing one", () => {
  it("is read only: no form, no edit, no delete, and it says the measurements are the released ones", async () => {
    routes(SHOP, [OLD_OCCASION]);
    render(<AquariumDetail id="s1" />);
    expect(
      await screen.findByRole("heading", { name: /Bolti medence/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/csak olvashatók/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Szerkesztés" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
    expect(screen.queryByText("Mérés felvétele")).toBeNull();
    expect(screen.getByText(/ismeretlen térfogat/)).toBeInTheDocument();
  });

  it("shows the server's one answer for an aquarium that is not the account's or does not exist", async () => {
    mockApi({
      "GET /aquariums/idegen": () => reply(404, { message: "Nem található." }),
      "GET /aquariums/idegen/measurements": () =>
        reply(404, { message: "Nem található." }),
      "GET /aquariums/idegen/targets": () =>
        reply(404, { message: "Nem található." }),
    });
    render(<AquariumDetail id="idegen" />);
    expect(
      await screen.findByText("Az akvárium nem található"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nem található.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Vissza az akváriumokhoz" }),
    ).toHaveAttribute("href", "/akvariumok");
  });
});
