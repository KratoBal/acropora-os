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
  aquariums: [{ id: "q1", name: "Nappali reef", origin: "OWN" }],
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
