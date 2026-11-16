import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mockApi, reply } from "@/test/mock-api";

import { RunOutReminders } from "./runout-reminders";
import { RunOutUnsubscribe } from "./runout-unsubscribe";

/*
  THE RUN-OUT REMINDER PAGES (ReefClub V3.2, slice 3c). WHAT TURNS THIS RED: the section telling a member which lock is closed;
  a reminder of the list without its turn-off, or the turn-off calling anything but its own product; the unsubscribe happening
  on the page load (a mail program's link checker would stop the reminder); the key left in the address bar; a wrong key shown
  as a success.
*/
const AQUARIUMS = {
  aquariums: [
    { id: "q1", name: "Nappali reef", origin: "OWN", systemVolumeLiters: 300 },
    {
      id: "q0",
      name: "Liter nélküli",
      origin: "OWN",
      systemVolumeLiters: null,
    },
  ],
};

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("RunOutReminders", () => {
  it("while a lock is closed says only that it is not available, never which lock", async () => {
    for (const state of ["off", "no-text", "no-secret"]) {
      mockApi({
        "GET /runout-reminders": () =>
          reply(200, { state, text: null, version: null, reminders: [] }),
        "GET /aquariums": () => reply(200, AQUARIUMS),
      });
      const view = render(<RunOutReminders />);
      expect(
        await screen.findByText("Az emlékeztető még nem érhető el."),
      ).toBeTruthy();
      expect(view.container.textContent).not.toMatch(
        /szöveg|kulcs|titok|kapcsoló/i,
      );
      view.unmount();
    }
  });

  it("a server without the routes yet (404) reads as not available, not as an error", async () => {
    mockApi({
      "GET /runout-reminders": () => reply(404, { message: "Cannot GET" }),
      "GET /aquariums": () => reply(200, AQUARIUMS),
    });
    render(<RunOutReminders />);
    expect(
      await screen.findByText("Az emlékeztető még nem érhető el."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists the reminders that are on with the product and the aquarium, and a turn-off stops exactly that product", async () => {
    let on = true;
    const { calls } = mockApi({
      "GET /runout-reminders": () =>
        reply(200, {
          state: "available",
          text: "Hozzájárulok.",
          version: "v1",
          reminders: on
            ? [
                {
                  id: "r1",
                  productId: "p/1",
                  productName: "Kalcium oldat 500 ml",
                  aquariumId: "q1",
                  consentAt: "2026-11-09T10:00:00Z",
                },
              ]
            : [],
        }),
      "GET /aquariums": () => reply(200, AQUARIUMS),
      "DELETE /runout-reminders/p%2F1": () => {
        on = false;
        return reply(200, { outcome: "DISABLED" });
      },
    });
    const user = userEvent.setup();
    render(<RunOutReminders />);
    expect(await screen.findByText("Kalcium oldat 500 ml")).toBeTruthy();
    expect(screen.getByText(/Nappali reef/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Kikapcsolás" }));
    expect(
      await screen.findByText("Most egyik termékre sem kértél emlékeztetőt."),
    ).toBeTruthy();
    expect(
      calls.filter((c) => c.method === "DELETE").map((c) => c.path),
    ).toEqual(["/runout-reminders/p%2F1"]);
  });
});

describe("RunOutReminders: turning one on", () => {
  const TEXT = "Hozzájárulok, hogy a ReefClub e-mailben emlékeztessen.";
  const overview = (over: Record<string, unknown> = {}) => ({
    state: "available",
    text: TEXT,
    version: "kifogyas-1",
    reminders: [],
    products: [
      { productId: "p1", productName: "Kalcium", packageText: "500 ml" },
      { productId: "p2", productName: "Magnézium", packageText: "1 l" },
    ],
    ...over,
  });

  it("offers nothing while a lock is closed, even if products came", async () => {
    mockApi({
      "GET /runout-reminders": () =>
        reply(200, overview({ state: "no-text", text: null, version: null })),
      "GET /aquariums": () => reply(200, AQUARIUMS),
    });
    render(<RunOutReminders />);
    await screen.findByText("Az emlékeztető még nem érhető el.");
    expect(
      screen.queryByRole("button", { name: "Emlékeztető kérése" }),
    ).toBeNull();
  });

  it("shows the consent text, asks for the checkbox, sends the shown version, and leaves out a product that is already on", async () => {
    let on: unknown[] = [];
    const { calls } = mockApi({
      "GET /runout-reminders": () =>
        reply(
          200,
          overview({
            reminders: on.length
              ? on
              : [
                  {
                    id: "r2",
                    productId: "p2",
                    productName: "Magnézium",
                    aquariumId: "q1",
                    consentAt: "2026-11-09T10:00:00Z",
                  },
                ],
          }),
        ),
      "GET /aquariums": () => reply(200, AQUARIUMS),
      "POST /runout-reminders": () => {
        on = [
          {
            id: "r1",
            productId: "p1",
            productName: "Kalcium",
            aquariumId: "q1",
            consentAt: "2026-11-10T10:00:00Z",
          },
        ];
        return reply(201, { id: "r1" });
      },
    });
    const user = userEvent.setup();
    render(<RunOutReminders />);
    expect(await screen.findByText(TEXT)).toBeTruthy();
    // an aquarium without litres is shown, but cannot be chosen, and says why (barracuda, #2350)
    const aquarium = screen.getByLabelText("Akvárium") as HTMLSelectElement;
    const noLitres = [...aquarium.options].find((o) => o.value === "q0")!;
    expect(noLitres.disabled).toBe(true);
    expect(noLitres.textContent).toMatch(/liter nélkül nem számolható/);
    expect([...aquarium.options].find((o) => o.value === "q1")!.disabled).toBe(
      false,
    );
    const product = screen.getByLabelText("Termék") as HTMLSelectElement;
    const options = [...product.options].map((o) => o.value);
    expect(options).toEqual(["", "p1"]);
    const send = screen.getByRole("button", { name: "Emlékeztető kérése" });
    await user.selectOptions(product, "p1");
    await user.selectOptions(screen.getByLabelText("Akvárium"), "q1");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await user.click(
      screen.getByLabelText("Elolvastam, és kérem az emlékeztetőt."),
    );
    await user.click(send);
    await screen.findByText("Kalcium");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual(
      [{ productId: "p1", aquariumId: "q1", consentVersion: "kifogyas-1" }],
    );
  });

  it("a refusal of the server is shown in its words", async () => {
    mockApi({
      "GET /runout-reminders": () => reply(200, overview()),
      "GET /aquariums": () => reply(200, AQUARIUMS),
      "POST /runout-reminders": () =>
        reply(400, {
          message: "Az emlékeztetőhöz add meg az akvárium literét.",
          code: "NO_VOLUME",
        }),
    });
    const user = userEvent.setup();
    render(<RunOutReminders />);
    await screen.findByText(TEXT);
    await user.selectOptions(screen.getByLabelText("Termék"), "p1");
    await user.selectOptions(screen.getByLabelText("Akvárium"), "q1");
    await user.click(
      screen.getByLabelText("Elolvastam, és kérem az emlékeztetőt."),
    );
    await user.click(
      screen.getByRole("button", { name: "Emlékeztető kérése" }),
    );
    expect(
      await screen.findByText("Az emlékeztetőhöz add meg az akvárium literét."),
    ).toBeTruthy();
  });
});

describe("RunOutUnsubscribe", () => {
  it("does NOTHING on load, removes the key from the address bar, and unsubscribes on the button with the key alone", async () => {
    window.history.replaceState(
      null,
      "",
      "/emlekezteto-leiratkozas#token=r1.abc",
    );
    const { calls } = mockApi({
      "POST /runout-reminders/unsubscribe": () =>
        reply(200, { outcome: "UNSUBSCRIBED" }),
    });
    const user = userEvent.setup();
    render(<RunOutUnsubscribe />);
    const button = await screen.findByRole("button", { name: "Leiratkozom" });
    expect(calls).toEqual([]);
    expect(window.location.hash).toBe("");
    await user.click(button);
    expect(await screen.findByText("Leiratkoztál")).toBeTruthy();
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/runout-reminders/unsubscribe", { key: "r1.abc" }],
    ]);
  });

  it("a second click says already, a wrong key is a failure with the server's words, a link without a key asks for the mail", async () => {
    mockApi({
      "POST /runout-reminders/unsubscribe": () =>
        reply(200, { outcome: "ALREADY_UNSUBSCRIBED" }),
    });
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/x#token=r1.abc");
    const first = render(<RunOutUnsubscribe />);
    await user.click(
      await screen.findByRole("button", { name: "Leiratkozom" }),
    );
    expect(await screen.findByText("Már korábban leiratkoztál")).toBeTruthy();
    first.unmount();

    mockApi({
      "POST /runout-reminders/unsubscribe": () =>
        reply(404, {
          message: "Ez a leiratkozó link nem érvényes.",
          code: "UNKNOWN_KEY",
        }),
    });
    window.history.replaceState(null, "", "/x#token=rossz");
    const second = render(<RunOutUnsubscribe />);
    await user.click(
      await screen.findByRole("button", { name: "Leiratkozom" }),
    );
    expect(
      await screen.findByText("Ez a leiratkozó link nem érvényes."),
    ).toBeTruthy();
    expect(screen.queryByText("Leiratkoztál")).toBeNull();
    second.unmount();

    const { calls } = mockApi({});
    window.history.replaceState(null, "", "/x");
    render(<RunOutUnsubscribe />);
    await waitFor(() =>
      expect(screen.getByText(/nincs benne leiratkozó kód/)).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Leiratkozom" })).toBeNull();
    expect(calls).toEqual([]);
  });
});
