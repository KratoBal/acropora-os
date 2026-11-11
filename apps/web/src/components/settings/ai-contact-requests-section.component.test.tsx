import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AiContactRequestView } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiContactRequestsSection } from "./ai-contact-requests-section";

/*
  A KAPCSOLAT-KÉRÉSEK LISTÁJA (kártya f5b8f7ba, 4c). MI PIROSÍT: a lista nem a legújabbat mutatja elöl, vagy az elérhetőséget nem
  (a kolléga ezen keresi a vevőt); a kezelt kérésen még ott a gomb; a kezeltnek jelölés nem az adott kérésre megy, vagy a lista nem
  frissül utána; hibát nem mutat; az értesítő levél hiánya nem látszik; az üres lista üres oldalt ad.
*/
const api = vi.hoisted(() => ({ list: vi.fn(), handled: vi.fn() }));
vi.mock("@/lib/api/ai-contact-requests", () => ({ aiContactRequestsApi: api }));

const row = (over: Partial<AiContactRequestView>): AiContactRequestView => ({
  id: "r1",
  channel: "PHONE",
  value: "06 30 123 4567",
  conversationRef: "conv",
  createdAt: "2026-11-11T10:00:00.000Z",
  notifiedAt: "2026-11-11T10:00:01.000Z",
  handledAt: null,
  ...over,
});

beforeEach(() => {
  api.list.mockReset();
  api.handled.mockReset();
});

const mount = () =>
  render(createElement(AiContactRequestsSection, { token: "t1" }));

describe("AiContactRequestsSection", () => {
  it("lists the requests in the order the server gave (newest first), with the contact and the channel", async () => {
    api.list.mockResolvedValue([
      row({ id: "new", value: "vasarlo@example.hu", channel: "EMAIL" }),
      row({ id: "old", value: "06 30 123 4567" }),
    ]);
    mount();
    const items = await screen.findAllByTestId("contact-request");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("E-mail: vasarlo@example.hu");
    expect(items[1]!.textContent).toContain("Telefon: 06 30 123 4567");
    expect(api.list).toHaveBeenCalledWith("t1");
  });

  it("shows the time in Budapest time", async () => {
    api.list.mockResolvedValue([
      row({ createdAt: "2026-11-11T10:00:00.000Z" }),
    ]);
    mount();
    const item = await screen.findByTestId("contact-request");
    expect(item.textContent).toMatch(/11:00/);
  });

  it("an unhandled request has the button, a handled one has the Kezelve badge and no button", async () => {
    api.list.mockResolvedValue([
      row({ id: "open" }),
      row({ id: "done", handledAt: "2026-11-11T11:00:00.000Z" }),
    ]);
    mount();
    const [open, done] = await screen.findAllByTestId("contact-request");
    expect(
      within(open!).getByRole("button", { name: "Kezeltnek jelölöm" }),
    ).toBeTruthy();
    expect(within(done!).queryByRole("button")).toBeNull();
    expect(done!.textContent).toContain("Kezelve");
    expect(done!.textContent).toContain("kezelve:");
  });

  it("marks exactly the clicked request handled, then reloads the list", async () => {
    api.list
      .mockResolvedValueOnce([
        row({ id: "a" }),
        row({ id: "b", value: "06 20 765 4321" }),
      ])
      .mockResolvedValueOnce([
        row({ id: "a" }),
        row({
          id: "b",
          value: "06 20 765 4321",
          handledAt: "2026-11-11T11:00:00.000Z",
        }),
      ]);
    api.handled.mockResolvedValue(row({ id: "b" }));
    mount();
    const items = await screen.findAllByTestId("contact-request");
    fireEvent.click(
      within(items[1]!).getByRole("button", { name: "Kezeltnek jelölöm" }),
    );
    await waitFor(() => expect(api.handled).toHaveBeenCalledWith("t1", "b"));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Kezeltnek jelölöm" }),
      ).toHaveLength(1),
    );
  });

  it("says when the notification mail did not go out, and shows nothing about it when it did", async () => {
    api.list.mockResolvedValue([
      row({ id: "x", notifiedAt: null }),
      row({ id: "y" }),
    ]);
    mount();
    const [missing, sent] = await screen.findAllByTestId("contact-request");
    expect(missing!.textContent).toContain("Az értesítő levél nem ment ki");
    expect(sent!.textContent).not.toContain("értesítő levél");
  });

  it("shows an empty state, and the server's message when the list or the marking fails", async () => {
    api.list.mockResolvedValue([]);
    const first = mount();
    expect(await screen.findByText("Nincs kapcsolat-kérés.")).toBeTruthy();
    first.unmount();

    api.list.mockRejectedValue(new Error("Nincs jogosultság."));
    const second = mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Nincs jogosultság.",
    );
    second.unmount();

    api.list.mockResolvedValue([row({ id: "z" })]);
    api.handled.mockRejectedValue(
      new Error("Nincs ilyen, még nem kezelt kérés."),
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Kezeltnek jelölöm" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Nincs ilyen",
    );
  });
});
