import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aquariumMeasurementParametersFor,
  aquariumMeasurementTargetRange,
} from "@acropora/types";

import { mockApi, reply } from "@/test/mock-api";

import { AquariumDetail } from "./aquarium-detail";
import { TargetsEditor } from "./targets-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const OWN = {
  id: "a1",
  origin: "OWN" as const,
  name: "Nappali nano",
  waterBodyType: "AKVARIUM" as const,
  waterType: "TENGERI" as const,
  systemVolumeLiters: 120,
  sharedWithShopAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
};
const FRESH = { ...OWN, waterType: "EDESVIZI" as const };

describe("TargetsEditor", () => {
  it("lists only the water type's parameters, prefilled from the own ranges with a decimal comma, with the default shown where there is one", async () => {
    const user = userEvent.setup();
    render(
      <TargetsEditor
        aquarium={OWN}
        targets={[{ parameterCode: "PH", min: 8, max: 8.4 }]}
        onSaved={async () => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    expect(screen.getByLabelText("pH alsó határ")).toHaveValue("8");
    expect(screen.getByLabelText("pH felső határ")).toHaveValue("8,4");
    // a marine-only parameter is there, a fresh-water-only one is not
    expect(screen.getByLabelText("Kalcium alsó határ")).toBeInTheDocument();
    expect(screen.queryByLabelText("GH alsó határ")).toBeNull();
    // the default range of a parameter without an own one is named, not filled in
    expect(screen.getByLabelText("Kalcium alsó határ")).toHaveValue("");
    expect(screen.getAllByText(/^alap: /).length).toBeGreaterThan(0);
  });

  it("a fresh-water aquarium has no default range to show, and has its own parameter list", async () => {
    const user = userEvent.setup();
    render(
      <TargetsEditor aquarium={FRESH} targets={[]} onSaved={async () => {}} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    expect(screen.getByLabelText("GH alsó határ")).toBeInTheDocument();
    expect(screen.queryByLabelText("Kalcium alsó határ")).toBeNull();
    expect(screen.queryByText(/^alap: /)).toBeNull();
  });

  it("sends the whole set of filled rows, one bound allowed, an emptied row dropped, numbers read with the comma", async () => {
    const { calls } = mockApi({
      "PUT /aquariums/a1/targets": () => reply(200, { targets: [] }),
    });
    const onSaved = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <TargetsEditor
        aquarium={OWN}
        targets={[
          { parameterCode: "PH", min: 8, max: 8.4 },
          { parameterCode: "KH", min: 7, max: 9 },
        ]}
        onSaved={onSaved}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    await user.clear(screen.getByLabelText("KH alsó határ"));
    await user.clear(screen.getByLabelText("KH felső határ"));
    await user.clear(screen.getByLabelText("pH felső határ"));
    await user.type(screen.getByLabelText("pH felső határ"), "8,3");
    await user.type(screen.getByLabelText("Nitrát felső határ"), "10,5");
    await user.click(screen.getByRole("button", { name: "Célsávok mentése" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      targets: [
        { parameterCode: "PH", min: 8, max: 8.3 },
        { parameterCode: "NITRAT", max: 10.5 },
      ],
    });
  });

  it("names a reversed range and a non-number on their row, and sends nothing", async () => {
    const { calls } = mockApi({});
    const user = userEvent.setup();
    render(
      <TargetsEditor aquarium={OWN} targets={[]} onSaved={async () => {}} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    await user.type(screen.getByLabelText("pH alsó határ"), "9");
    await user.type(screen.getByLabelText("pH felső határ"), "8");
    expect(
      screen.getByText("Az alsó határ nem lehet nagyobb a felsőnél."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Célsávok mentése" }),
    ).toBeDisabled();
    await user.clear(screen.getByLabelText("pH alsó határ"));
    await user.type(screen.getByLabelText("pH alsó határ"), "sok");
    expect(screen.getByText("Számot írj, például 8,2.")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("a stored range for a parameter that is not on the list now goes back unchanged, not deleted silently", async () => {
    const { calls } = mockApi({
      "PUT /aquariums/a1/targets": () => reply(200, { targets: [] }),
    });
    const user = userEvent.setup();
    // the aquarium is marine now; GH is a fresh-water parameter, a range kept from before the water type changed
    render(
      <TargetsEditor
        aquarium={OWN}
        targets={[
          { parameterCode: "GH", min: 6, max: null },
          { parameterCode: "PH", min: 8, max: 8.4 },
        ]}
        onSaved={async () => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    expect(screen.queryByLabelText("GH alsó határ")).toBeNull();
    await user.clear(screen.getByLabelText("pH felső határ"));
    await user.type(screen.getByLabelText("pH felső határ"), "8,3");
    await user.click(screen.getByRole("button", { name: "Célsávok mentése" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      targets: [
        { parameterCode: "GH", min: 6 },
        { parameterCode: "PH", min: 8, max: 8.3 },
      ],
    });
  });

  it("every default range the editor can name has BOTH bounds as numbers (the 'alap:' line prints both)", () => {
    for (const parameter of aquariumMeasurementParametersFor("TENGERI")) {
      const range = aquariumMeasurementTargetRange("TENGERI", parameter.code);
      if (range === undefined) continue;
      expect(Number.isFinite(range.min), parameter.code).toBe(true);
      expect(Number.isFinite(range.max), parameter.code).toBe(true);
    }
    // fresh water has none at all
    expect(aquariumMeasurementTargetRange("EDESVIZI", "PH")).toBeUndefined();
  });

  it("emptying every row sends an empty set, which removes the own ranges", async () => {
    const { calls } = mockApi({
      "PUT /aquariums/a1/targets": () => reply(200, { targets: [] }),
    });
    const user = userEvent.setup();
    render(
      <TargetsEditor
        aquarium={OWN}
        targets={[{ parameterCode: "PH", min: 8, max: 8.4 }]}
        onSaved={async () => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    await user.clear(screen.getByLabelText("pH alsó határ"));
    await user.clear(screen.getByLabelText("pH felső határ"));
    await user.click(screen.getByRole("button", { name: "Célsávok mentése" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT")).toBe(true),
    );
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      targets: [],
    });
  });

  it("keeps the form and shows the server's words when the save fails", async () => {
    mockApi({
      "PUT /aquariums/a1/targets": () =>
        reply(400, {
          message:
            "A pH céltartomány alsó határa nem lehet nagyobb a felsőnél.",
        }),
    });
    const user = userEvent.setup();
    render(
      <TargetsEditor aquarium={OWN} targets={[]} onSaved={async () => {}} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Célsávok szerkesztése" }),
    );
    await user.type(screen.getByLabelText("pH alsó határ"), "8");
    await user.click(screen.getByRole("button", { name: "Célsávok mentése" }));
    expect(
      await screen.findByText(
        "A pH céltartomány alsó határa nem lehet nagyobb a felsőnél.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("pH alsó határ")).toHaveValue("8");
  });
});

describe("the aquarium page and the editor", () => {
  it("an own aquarium offers it; after a save both the ranges and the measurements are read again", async () => {
    let saved = false;
    const { calls } = mockApi({
      "GET /aquariums/a1": () => reply(200, OWN),
      "GET /aquariums/a1/measurements": () => reply(200, { occasions: [] }),
      "GET /aquariums/a1/targets": () =>
        reply(200, {
          targets: saved ? [{ parameterCode: "PH", min: 8, max: 8.3 }] : [],
        }),
      "PUT /aquariums/a1/targets": () => {
        saved = true;
        return reply(200, {
          targets: [{ parameterCode: "PH", min: 8, max: 8.3 }],
        });
      },
    });
    const user = userEvent.setup();
    render(<AquariumDetail id="a1" />);
    await user.click(
      await screen.findByRole("button", { name: "Célsávok szerkesztése" }),
    );
    await user.type(screen.getByLabelText("pH alsó határ"), "8");
    await user.type(screen.getByLabelText("pH felső határ"), "8,3");
    await user.click(screen.getByRole("button", { name: "Célsávok mentése" }));

    expect(await screen.findByText("8 – 8,3")).toBeInTheDocument();
    expect(
      calls.filter((c) => c.method === "GET" && c.path.endsWith("/targets"))
        .length,
    ).toBe(2);
    expect(
      calls.filter(
        (c) => c.method === "GET" && c.path.endsWith("/measurements"),
      ).length,
    ).toBe(2);
  });

  it("a shop aquarium has no editor: its ranges are the shop's", async () => {
    const SHOP = { ...OWN, id: "s1", origin: "SHOP" as const, name: "Bolti" };
    mockApi({
      "GET /aquariums/s1": () => reply(200, SHOP),
      "GET /aquariums/s1/measurements": () => reply(200, { occasions: [] }),
      "GET /aquariums/s1/targets": () => reply(200, { targets: [] }),
    });
    render(<AquariumDetail id="s1" />);
    await screen.findByRole("heading", { name: /Bolti/ });
    expect(
      screen.queryByRole("button", { name: "Célsávok szerkesztése" }),
    ).toBeNull();
  });
});
