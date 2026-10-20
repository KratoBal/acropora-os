import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomepageContentEditorPage } from "./homepage-content-editor-page";

/*
  THE HOME PAGE EDITOR. What turns these red: a save that sends only the key
  just edited (the PUT replaces the WHOLE set of overrides, so every earlier
  override would be deleted: barracuda, OS #1720); an untouched save that turns
  starting values into the editor's own (it would remove the shop's sample
  marker of an invented fact); the default slides saved as an empty list (no
  hero) instead of null (not set); an unsafe address reaching the server; a
  sixth slide; a viewer able to edit; the projection result not told.
*/
const api = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  uploadImage: vi.fn(),
}));
vi.mock("@/lib/api/homepage-content", () => ({ homepageContentApi: api }));
const auth = vi.hoisted(() => ({ role: "OWNER" as UserRole }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "U",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } satisfies Session,
  }),
}));

const slide = (over: Record<string, unknown> = {}) => ({
  eyebrow: "Felirat",
  title: "Főcím",
  text: "Szöveg",
  cta: "Gomb",
  ctaHref: "/store",
  cta2: "",
  cta2Href: null,
  caption: "",
  caption2: "",
  imageUrl: null,
  imageAlt: "Alt",
  ...over,
});
const stored = (over: Record<string, unknown> = {}) => ({
  texts: {},
  slides: null,
  updatedAt: null,
  ...over,
});
const echo = (projection = "off") =>
  api.save.mockImplementation(async (_token: string, input: unknown) => ({
    content: { ...(input as object), updatedAt: "2026-10-20T12:00:00.000Z" },
    projection,
  }));

beforeEach(() => {
  auth.role = "OWNER";
  api.get.mockReset().mockResolvedValue(stored());
  api.save.mockReset();
  api.uploadImage.mockReset();
  echo();
});

/** The body of the first save call. */
const sent = () => api.save.mock.calls[0]![1];
const field = (label: string) => screen.findByLabelText(label);
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

describe("HomepageContentEditorPage", () => {
  it("HP-ED-DEFAULT: shows the starting value and the sample tag, nothing edited", async () => {
    render(<HomepageContentEditorPage />);
    const title = (await field("Mit keresel ma?: Címsor")) as HTMLInputElement;
    expect(title).toBeTruthy();
    expect(
      (
        (await field(
          "Hero: Harmadik tény: címsor (értékelés)",
        )) as HTMLInputElement
      ).value,
    ).toBe("4,9 / 5");
    expect(screen.getAllByText("Minta adat").length).toBeGreaterThan(0);
  });

  it("HP-ED-FULL: a save sends EVERY earlier override, not only the edited key", async () => {
    api.get.mockResolvedValue(
      stored({ texts: { "mit.cim": "Régi felülírás" } }),
    );
    render(<HomepageContentEditorPage />);
    fireEvent.change(await field("Hero: Első tény: címsor"), {
      target: { value: "Új cím" },
    });
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().texts).toEqual({
      "mit.cim": "Régi felülírás",
      "hero.tenyek.1.cim": "Új cím",
    });
  });

  it("HP-ED-UNTOUCHED: an untouched save claims no starting value as the editor's own", async () => {
    render(<HomepageContentEditorPage />);
    await field("Hero: Első tény: címsor");
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ texts: {}, slides: null });
  });

  it("HP-ED-RESET: Alapérték drops the override; an emptied field is an override, not a reset", async () => {
    api.get.mockResolvedValue(
      stored({
        texts: { "hero.tenyek.1.cim": "Saját", "hero.tenyek.2.cim": "Másik" },
      }),
    );
    render(<HomepageContentEditorPage />);
    const first = (await field("Hero: Első tény: címsor")) as HTMLInputElement;
    expect(first.value).toBe("Saját");
    // the reset button next to it
    fireEvent.click(
      first.closest("div")!.parentElement!.querySelector("button")!,
    );
    fireEvent.change(await field("Hero: Második tény: címsor"), {
      target: { value: "" },
    });
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().texts).toEqual({
      "hero.tenyek.2.cim": "",
    });
  });

  it("HP-ED-SLIDES: default slides save as null, own slides as the list, up to five", async () => {
    render(<HomepageContentEditorPage />);
    await field("Mit keresel ma?: Címsor");
    fireEvent.click(screen.getByLabelText(/Saját diák/));
    for (let i = 0; i < 5; i++)
      fireEvent.click(screen.getByRole("button", { name: "Dia hozzáadása" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Dia hozzáadása",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Dia törlése" })[0]!);
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().slides).toHaveLength(4);

    api.save.mockClear();
    fireEvent.click(screen.getByLabelText(/Alap diák/));
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().slides).toBeNull();
  });

  it("HP-ED-EMPTYLIST: own slides with none left is an empty list (no hero), not null", async () => {
    api.get.mockResolvedValue(stored({ slides: [slide()] }));
    render(<HomepageContentEditorPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Dia törlése" }));
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().slides).toEqual([]);
  });

  it("HP-ED-ADDRESS: an unsafe address is refused before the server", async () => {
    render(<HomepageContentEditorPage />);
    fireEvent.change(
      await field("Mit keresel ma? 1. terület: 1. hivatkozás: cél"),
      {
        target: { value: "javascript:alert(1)" },
      },
    );
    save();
    expect(
      await screen.findByText(/a shop path \(\/store\) or an http/),
    ).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("HP-ED-PROJECTION: the save tells what happened to the shop", async () => {
    for (const [projection, text] of [
      ["off", /ki van kapcsolva/],
      ["sent", /elküldve a webshopnak/],
      ["failed", /nem sikerült/],
    ] as const) {
      api.save.mockReset();
      echo(projection);
      const { unmount } = render(<HomepageContentEditorPage />);
      await field("Mit keresel ma?: Címsor");
      save();
      expect(await screen.findByText(text)).toBeTruthy();
      unmount();
    }
  });

  it("HP-ED-ERROR: a failed save keeps the page and says so", async () => {
    api.save
      .mockReset()
      .mockRejectedValue(new Error("a szerver nem érhető el"));
    render(<HomepageContentEditorPage />);
    await field("Mit keresel ma?: Címsor");
    save();
    expect(await screen.findByText("a szerver nem érhető el")).toBeTruthy();
  });

  it("HP-ED-VIEWER: without products.manage there is no editor", () => {
    auth.role = "SERVICE";
    render(<HomepageContentEditorPage />);
    expect(screen.getByText("Nincs hozzáférésed")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("HP-ED-IMAGE: an uploaded image's address goes into the field and is saved; a failed upload leaves it", async () => {
    api.uploadImage.mockResolvedValueOnce({
      url: "https://shop.example/static/a.jpg",
    });
    render(<HomepageContentEditorPage />);
    const picker = await screen.findByLabelText(
      "Mit keresel ma? 1. terület: Kép: feltöltés",
    );
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Mit keresel ma? 1. terület: Kép",
          ) as HTMLInputElement
        ).value,
      ).toBe("https://shop.example/static/a.jpg"),
    );
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().texts["mit.1.kep"]).toBe("https://shop.example/static/a.jpg");

    api.uploadImage.mockRejectedValueOnce(
      new Error("A webshopba küldés ki van kapcsolva"),
    );
    fireEvent.change(
      screen.getByLabelText("Mit keresel ma? 2. terület: Kép: feltöltés"),
      { target: { files: [file] } },
    );
    expect(await screen.findByText(/ki van kapcsolva/)).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          "Mit keresel ma? 2. terület: Kép",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });
});
