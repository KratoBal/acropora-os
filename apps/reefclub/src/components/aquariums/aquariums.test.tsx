import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi, reply } from "@/test/mock-api";

import { AquariumList } from "./aquarium-list";
import { NewAquarium } from "./new-aquarium";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const OWN = {
  id: "a-own",
  origin: "OWN",
  name: "Nappali nano",
  waterBodyType: "AKVARIUM",
  waterType: "TENGERI",
  systemVolumeLiters: 120,
  sharedWithShopAt: "2026-10-18T09:00:00.000Z",
  createdAt: "2026-10-01T09:00:00.000Z",
};
const SHOP = {
  id: "a-shop",
  origin: "SHOP",
  name: "Bolti medence",
  waterBodyType: "AKVARIUM",
  waterType: null,
  systemVolumeLiters: null,
  sharedWithShopAt: null,
  createdAt: "2026-09-01T09:00:00.000Z",
};
const LINK = {
  id: "l1",
  customerName: "Minta Vevő",
  createdAt: "2026-10-19T09:00:00.000Z",
};

describe("AquariumList", () => {
  it("lists own and shop aquariums apart, with what the answer says about them", async () => {
    mockApi({
      "GET /aquariums": () => reply(200, { aquariums: [OWN, SHOP] }),
      "GET /shop-links": () => reply(200, { links: [] }),
    });
    render(<AquariumList />);

    const own = (await screen.findByText("Nappali nano")).closest("a")!;
    expect(own).toHaveAttribute("href", "/akvariumok/a-own");
    expect(within(own).getByText("Saját")).toBeInTheDocument();
    expect(within(own).getByText(/Tengeri/)).toBeInTheDocument();
    expect(within(own).getByText(/120 liter/)).toBeInTheDocument();
    expect(within(own).getByText("Megosztva a bolttal")).toBeInTheDocument();

    const shop = screen.getByText("Bolti medence").closest("a")!;
    expect(within(shop).getByText("Bolti")).toBeInTheDocument();
    // nothing is invented for a missing volume or a private one
    expect(within(shop).getByText(/ismeretlen térfogat/)).toBeInTheDocument();
    expect(within(shop).queryByText("Megosztva a bolttal")).toBeNull();
  });

  it("says what to do when there is no aquarium yet", async () => {
    mockApi({
      "GET /aquariums": () => reply(200, { aquariums: [] }),
      "GET /shop-links": () => reply(200, { links: [] }),
    });
    render(<AquariumList />);
    expect(await screen.findByText(/Még nincs akváriumod/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Új akvárium" })).toHaveAttribute(
      "href",
      "/akvariumok/uj",
    );
  });

  it("shows the server's words when the list cannot be loaded", async () => {
    mockApi({
      "GET /aquariums": () => reply(502, {}),
      "GET /shop-links": () => reply(200, { links: [] }),
    });
    render(<AquariumList />);
    expect(
      await screen.findByText("Az akváriumok nem töltődtek be"),
    ).toBeInTheDocument();
  });

  it("redeems a shop code, tells whose it linked to, and reloads the aquariums", async () => {
    let linked = false;
    const { calls } = mockApi({
      "GET /aquariums": () =>
        reply(200, { aquariums: linked ? [OWN, SHOP] : [OWN] }),
      "GET /shop-links": () => reply(200, { links: linked ? [LINK] : [] }),
      "POST /shop-links": () => {
        linked = true;
        return reply(201, LINK);
      },
    });
    const user = userEvent.setup();
    render(<AquariumList />);
    await screen.findByText("Nappali nano");
    expect(screen.queryByText("Bolti medence")).toBeNull();

    await user.type(screen.getByLabelText("Bolti kód"), "ABCD-EFGH");
    await user.click(screen.getByRole("button", { name: "Összekötés" }));

    expect(await screen.findByText(/ezzel: Minta Vevő/)).toBeInTheDocument();
    expect(await screen.findByText("Bolti medence")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      code: "ABCD-EFGH",
    });
  });

  it("shows the server's one answer for a wrong code and keeps the typed code", async () => {
    mockApi({
      "GET /aquariums": () => reply(200, { aquariums: [] }),
      "GET /shop-links": () => reply(200, { links: [] }),
      "POST /shop-links": () =>
        reply(400, {
          message: "A kód érvénytelen, lejárt vagy már felhasználták.",
        }),
    });
    const user = userEvent.setup();
    render(<AquariumList />);
    await user.type(await screen.findByLabelText("Bolti kód"), "ROSSZ-KOD");
    await user.click(screen.getByRole("button", { name: "Összekötés" }));
    expect(
      await screen.findByText(
        "A kód érvénytelen, lejárt vagy már felhasználták.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bolti kód")).toHaveValue("ROSSZ-KOD");
  });

  it("ends a link only after a second question, then reloads", async () => {
    let ended = false;
    const { calls } = mockApi({
      "GET /aquariums": () =>
        reply(200, { aquariums: ended ? [OWN] : [OWN, SHOP] }),
      "GET /shop-links": () => reply(200, { links: ended ? [] : [LINK] }),
      "DELETE /shop-links/l1": () => {
        ended = true;
        return reply(204);
      },
    });
    const user = userEvent.setup();
    render(<AquariumList />);
    await user.click(
      await screen.findByRole("button", { name: "Megszüntetés" }),
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(
      screen.getByRole("button", { name: "Igen, megszüntetem" }),
    );

    await waitFor(() => expect(screen.queryByText("Bolti medence")).toBeNull());
    expect(
      calls.some((c) => c.method === "DELETE" && c.path === "/shop-links/l1"),
    ).toBe(true);
  });
});

describe("NewAquarium", () => {
  it("sends only what was filled in, the volume as a number with a decimal comma read right", async () => {
    const { calls } = mockApi({
      "POST /aquariums": () => reply(201, { ...OWN, id: "new-1" }),
    });
    const user = userEvent.setup();
    render(<NewAquarium />);
    await user.type(screen.getByLabelText("Név"), "  Új tank ");
    await user.selectOptions(screen.getByLabelText("Víz"), "TENGERI");
    await user.type(screen.getByLabelText(/Nettó térfogat/), "60,5");
    await user.click(screen.getByRole("button", { name: "Létrehozás" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/akvariumok/new-1"),
    );
    expect(calls[0]!.body).toEqual({
      name: "Új tank",
      waterBodyType: "AKVARIUM",
      waterType: "TENGERI",
      systemVolumeLiters: 60.5,
    });
  });

  it("leaves out the water and the volume when they are not given, instead of sending empty values", async () => {
    const { calls } = mockApi({
      "POST /aquariums": () => reply(201, { ...OWN, id: "new-2" }),
    });
    const user = userEvent.setup();
    render(<NewAquarium />);
    await user.type(screen.getByLabelText("Név"), "Csak név");
    await user.click(screen.getByRole("button", { name: "Létrehozás" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({
      name: "Csak név",
      waterBodyType: "AKVARIUM",
    });
  });

  it("names a volume that is not a number or not positive, and sends nothing", async () => {
    const { calls } = mockApi({});
    const user = userEvent.setup();
    render(<NewAquarium />);
    await user.type(screen.getByLabelText("Név"), "Tank");
    await user.type(screen.getByLabelText(/Nettó térfogat/), "sok");
    expect(screen.getByText(/számmal add meg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Létrehozás" })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Nettó térfogat/));
    await user.type(screen.getByLabelText(/Nettó térfogat/), "0");
    expect(screen.getByText(/nagyobb legyen nullánál/)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("keeps the form and shows the server's words when the creation fails", async () => {
    mockApi({
      "POST /aquariums": () =>
        reply(400, { message: "Elérted a saját akváriumok számának határát." }),
    });
    const user = userEvent.setup();
    render(<NewAquarium />);
    await user.type(screen.getByLabelText("Név"), "Tank");
    await user.click(screen.getByRole("button", { name: "Létrehozás" }));
    expect(
      await screen.findByText("Elérted a saját akváriumok számának határát."),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Név")).toHaveValue("Tank");
  });
});
