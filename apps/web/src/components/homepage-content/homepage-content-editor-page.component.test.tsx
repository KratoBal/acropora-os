import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomepageContentEditorPage } from "./homepage-content-editor-page";

/*
  THE PREVIEW FRAME POINTS AT THE TEST STOREFRONT: the test must not load it
  over the network. happy-dom's own switch, set for this file only.
*/
(
  window as unknown as {
    happyDOM?: {
      settings: { navigation: { disableChildFrameNavigation: boolean } };
    };
  }
).happyDOM!.settings.navigation.disableChildFrameNavigation = true;

/*
  THE HOME PAGE EDITOR. What turns these red: a save that sends only the key
  just edited (the PUT replaces the WHOLE set of overrides, so every earlier
  override would be deleted: barracuda, OS #1720); an untouched save that turns
  starting values into the editor's own (it would remove the shop's sample
  marker of an invented fact); the default slides saved as an empty list (no
  hero) instead of null (not set); an unsafe address reaching the server; a
  sixth slide; a viewer able to edit; the projection result not told.

  THE BLOCK EDITOR (2026-10-26, Figma 685:535): a block's order or visibility
  not saved; an untouched page saved as an own order (it would freeze today's
  order against a later storefront change); a save with every block hidden
  without asking; the unsaved state not shown; an upload offered where the
  shop projection is off (the server refuses it, #1721); a preview that talks
  to a frame of another origin.
*/
const api = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  uploadImage: vi.fn(),
  setProjection: vi.fn(),
}));
vi.mock("@/lib/api/homepage-content", () => ({ homepageContentApi: api }));
const auth = vi.hoisted(() => ({
  role: "OWNER" as UserRole,
  // the server's switch reaches the page through the menu it serves (`homepage-content`)
  served: true,
}));
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
      navigation: auth.served
        ? [{ id: "homepage-content", surfaces: ["web"] }]
        : [],
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
  blocks: null,
  footer: null,
  imageHosts: [],
  storefrontUrl: null,
  updatedAt: null,
  projectionEnabled: false,
  projectionAllowed: true,
  ...over,
});
const echo = (projection = "off") =>
  api.save.mockImplementation(async (_token: string, input: unknown) => ({
    content: {
      blocks: null,
      footer: null,
      imageHosts: [],
      storefrontUrl: null,
      projectionEnabled: false,
      projectionAllowed: true,
      ...(input as object),
      updatedAt: "2026-10-20T12:00:00.000Z",
    },
    projection,
  }));

beforeEach(() => {
  auth.role = "OWNER";
  auth.served = true;
  api.get.mockReset().mockResolvedValue(stored());
  api.save.mockReset();
  api.uploadImage.mockReset();
  api.setProjection.mockReset();
  echo();
});

/** The body of the first save call. */
const sent = () => api.save.mock.calls[0]![1];
const field = (label: string) => screen.findByLabelText(label);
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
/** Opens a block's editor from the left column. */
const open = async (label: string) =>
  fireEvent.click(
    await screen.findByRole("button", { name: `${label} szerkesztése` }),
  );
const UNTOUCHED = { texts: {}, slides: null, blocks: null, footer: null };

describe("HomepageContentEditorPage", () => {
  it("HP-ED-DEFAULT: shows the starting value and the sample tag, nothing edited", async () => {
    render(<HomepageContentEditorPage />);
    expect(
      (
        (await field(
          "Hero: Harmadik tény: címsor (értékelés)",
        )) as HTMLInputElement
      ).value,
    ).toBe("4,9 / 5");
    expect(screen.getAllByText("Minta adat").length).toBeGreaterThan(0);
    await open("Mit keresel ma?");
    expect(await field("Mit keresel ma?: Címsor")).toBeTruthy();
  });

  it("HP-ED-BRANDS: the logo strip is part of the save, in the edited order; a never-set list is not sent", async () => {
    const brand = (id: string, shown = true) => ({
      id,
      name: `Márka ${id}`,
      slug: `marka-${id}`,
      logoUrl: null,
      shown,
    });
    api.get.mockResolvedValue(
      stored({
        brandIds: ["b1", "b2", "b3"],
        brands: [brand("b1"), brand("b2", false), brand("b3")],
      }),
    );
    render(<HomepageContentEditorPage />);
    await open("Márkák");
    fireEvent.keyDown(
      await screen.findByRole("button", { name: /^Márka b3 áthelyezése/ }),
      { key: "ArrowUp" },
    );
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(sent().brandIds).toEqual(["b1", "b3", "b2"]);
    // the block's own texts stay editable under the list
    expect(await field("Márkák: Felirat")).toBeTruthy();
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
    expect(sent()).toEqual(UNTOUCHED);
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
    await field("Hero: Első tény: címsor");
    fireEvent.click(screen.getByRole("tab", { name: "Saját diák" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Alap diák" }));
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
    await open("Mit keresel ma?");
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
      ["off", "Mentve (a webshopba küldés ki van kapcsolva)"],
      ["sent", "Mentve, és elküldve a webshopnak"],
      ["unchanged", "Mentve, a webshopban nem változott semmi"],
      [
        "failed",
        "Mentve, de a webshopba küldés nem sikerült: a következő ütemezett kör újrapróbálja",
      ],
    ] as const) {
      api.save.mockReset();
      echo(projection);
      const { unmount } = render(<HomepageContentEditorPage />);
      await field("Hero: Első tény: címsor");
      save();
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("HP-ED-ERROR: a failed save keeps the page and says so", async () => {
    api.save
      .mockReset()
      .mockRejectedValue(new Error("a szerver nem érhető el"));
    render(<HomepageContentEditorPage />);
    await field("Hero: Első tény: címsor");
    save();
    expect(await screen.findByText("a szerver nem érhető el")).toBeTruthy();
  });

  // MI PIROSÍT: ha a szerkesztő a szerver kapcsolója nélkül is betöltene vagy írna (élesen a
  // commerce-kivétel nem él; acrobot 34365)
  it("HP-ED-OFF: without the environment's switch there is no editor and nothing is loaded", () => {
    auth.served = false;
    render(<HomepageContentEditorPage />);
    expect(screen.getByText("Ebben a környezetben nem elérhető")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
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
    api.get.mockResolvedValue(stored({ projectionEnabled: true }));
    // the server answers with the switch as it is: on
    api.save.mockImplementation(async (_token: string, input: unknown) => ({
      content: { ...stored({ projectionEnabled: true }), ...(input as object) },
      projection: "sent",
    }));
    render(<HomepageContentEditorPage />);
    await open("Mit keresel ma?");
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

  it("HP-ED-SWITCH: the administrator's switch is not part of the save and is sent on its own", async () => {
    api.setProjection.mockResolvedValue({ projectionEnabled: true });
    render(<HomepageContentEditorPage />);
    const box = await screen.findByLabelText(/menjen a webshopba/);
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.setProjection).toHaveBeenCalledWith("token-1", true),
    );
    expect(
      (await screen.findAllByText(/be van kapcsolva/)).length,
    ).toBeGreaterThan(0);
    expect(api.save).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual(UNTOUCHED);
  });

  it("HP-ED-SWITCH-RIGHTS: an editor without settings.manage sees the switch but cannot use it", async () => {
    auth.role = "MANAGER";
    render(<HomepageContentEditorPage />);
    const box = (await screen.findByLabelText(
      /menjen a webshopba/,
    )) as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(box);
    expect(api.setProjection).not.toHaveBeenCalled();
  });

  it("HP-ED-ALLOWED: where the environment does not allow it the switch is disabled and the page says so", async () => {
    api.get.mockResolvedValue(
      stored({ projectionEnabled: true, projectionAllowed: false }),
    );
    render(<HomepageContentEditorPage />);
    const box = (await screen.findByLabelText(
      /menjen a webshopba/,
    )) as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(await screen.findByText(/nincs engedélyezve/)).toBeTruthy();
    fireEvent.click(box);
    expect(api.setProjection).not.toHaveBeenCalled();
  });
  it("HP-ED-BLOCKS: a hidden and a moved block are saved as the own list, in page order", async () => {
    render(<HomepageContentEditorPage />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Márkák: látszik" }),
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: /^A boltunk áthelyezése/ }),
      { key: "ArrowUp" },
    );
    expect(screen.getByText("Rejtve")).toBeTruthy();
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().blocks).toEqual([
      { key: "hero", visible: true },
      { key: "mit-keresel", visible: true },
      { key: "kezdo-es-halado", visible: true },
      { key: "egyedi-korallok", visible: true },
      { key: "szolgaltatasok", visible: true },
      { key: "markak", visible: false },
      { key: "boltunk", visible: true },
      { key: "velemenyek", visible: true },
    ]);
  });

  it("HP-ED-ALLHIDDEN: hiding every block asks before saving; Mégse saves nothing", async () => {
    render(<HomepageContentEditorPage />);
    for (const label of [
      "Fejléc diák",
      "Mit keresel ma?",
      "Kezdőknek és tapasztaltaknak",
      "Egyedi korallok",
      "Szolgáltatások",
      "Márkák",
      "Vélemények",
      "A boltunk",
    ])
      fireEvent.click(
        await screen.findByRole("switch", { name: `${label}: látszik` }),
      );
    save();
    expect(
      await screen.findByText("Minden blokk rejtve van. Biztosan így mented?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(api.save).not.toHaveBeenCalled();
    save();
    fireEvent.click(await screen.findByRole("button", { name: "Mentés így" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().blocks.every((b: { visible: boolean }) => !b.visible)).toBe(
      true,
    );
  });

  it("HP-ED-DIRTY: an edit shows the unsaved state until the save answers", async () => {
    render(<HomepageContentEditorPage />);
    expect(await screen.findByText("Nincs mentett változás")).toBeTruthy();
    fireEvent.change(await field("Hero: Első tény: címsor"), {
      target: { value: "Új" },
    });
    expect(screen.getByText("Nem mentett változás")).toBeTruthy();
    save();
    await waitFor(() =>
      expect(screen.queryByText("Nem mentett változás")).toBeNull(),
    );
  });

  it("HP-ED-TABS: the beginner and the advanced band are one block with two tabs", async () => {
    render(<HomepageContentEditorPage />);
    await open("Kezdőknek és tapasztaltaknak");
    expect(await field("Kezdőknek: Címsor")).toBeTruthy();
    expect(screen.queryByLabelText("Tapasztaltaknak: Címsor")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Tapasztaltaknak" }));
    expect(await field("Tapasztaltaknak: Címsor")).toBeTruthy();
  });

  /*
    THE FORMATTED SHORT TEXTS (2b-3; commerce #571): a short place is the short
    editor, and what it holds is saved as its HTML; an untouched one is not
    saved at all (the starting value is not claimed). What turns this red: a
    plain textarea at a short place, or the editor marking a field edited by
    itself.
  */
  it("HP-ED-SHORT: a short place is the short editor, its HTML is saved, an untouched one is not", async () => {
    render(<HomepageContentEditorPage />);
    await open("Kezdőknek és tapasztaltaknak");
    const editor = (await field("Kezdőknek: Bevezető")) as HTMLElement & {
      editor: {
        commands: {
          setContent(html: string, options?: { emitUpdate?: boolean }): boolean;
        };
      };
    };
    expect(editor.tagName).not.toBe("TEXTAREA");
    expect(editor.editor).toBeTruthy();
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().texts).toEqual({});

    api.save.mockClear();
    act(() => {
      editor.editor.commands.setContent("<p>Első <strong>lépés</strong></p>", {
        emitUpdate: true,
      });
    });
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().texts["kezdo.szoveg"]).toBe(
      "<p>Első <strong>lépés</strong></p>",
    );
  });

  it("HP-ED-FOOTER: an own footer is saved; the legal documents and the address are not edited here", async () => {
    render(<HomepageContentEditorPage />);
    await open("Lábléc");
    expect(
      await screen.findByText("A kirakat saját lábléce látszik."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Saját lábléc szerkesztése" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Oszlop hozzáadása" }));
    fireEvent.change(screen.getByLabelText("1. oszlop címe"), {
      target: { value: "Oldaltérkép" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sor hozzáadása" }));
    fireEvent.change(screen.getByLabelText("1. oszlop, 1. sor: felirat"), {
      target: { value: "Termékek" },
    });
    fireEvent.change(screen.getByLabelText("1. oszlop, 1. sor: cél"), {
      target: { value: "/store" },
    });
    fireEvent.change(screen.getByLabelText("Lábléc: Facebook"), {
      target: { value: "https://facebook.com/acropora" },
    });
    fireEvent.change(screen.getByLabelText("Lábléc: jogi sor"), {
      target: { value: "© Acropora Kft." },
    });
    expect(screen.getByText(/Jogi dokumentumok/)).toBeTruthy();
    expect(screen.getByText(/„A boltunk” blokkból jön/)).toBeTruthy();
    save();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sent().footer).toEqual({
      intro: "",
      columns: [
        {
          title: "Oldaltérkép",
          links: [{ label: "Termékek", href: "/store" }],
        },
      ],
      social: {
        facebook: "https://facebook.com/acropora",
        instagram: null,
        youtube: null,
      },
      bottomText: "© Acropora Kft.",
    });
  });

  it("HP-ED-UPLOAD-OFF: with the shop projection off no upload is offered, and the page says why", async () => {
    render(<HomepageContentEditorPage />);
    await open("Mit keresel ma?");
    await field("Mit keresel ma? 1. terület: Kép");
    expect(
      screen.queryByLabelText("Mit keresel ma? 1. terület: Kép: feltöltés"),
    ).toBeNull();
    expect(
      screen.getAllByText("Képfeltöltés csak bekapcsolt webshopba küldésnél.")
        .length,
    ).toBeGreaterThan(0);
  });

  /*
    A SLIDE BUTTON'S TARGET (acrobot 36371): the test shop's full address
    becomes its path when the field is left, another site is named under the
    field, in Hungarian.
  */
  it("HP-ED-SLIDE-HREF: the shop's full address becomes its path, another site is named", async () => {
    api.get.mockResolvedValue(
      stored({ storefrontUrl: "https://teszt.invalid" }),
    );
    render(<HomepageContentEditorPage />);
    await field("Hero: Első tény: címsor");
    fireEvent.click(screen.getByRole("tab", { name: "Saját diák" }));
    fireEvent.click(screen.getByRole("button", { name: "Dia hozzáadása" }));
    const target = screen.getByLabelText("1. dia: első gomb célja");
    fireEvent.change(target, {
      target: { value: "https://teszt.invalid/hu/categories/sps" },
    });
    fireEvent.blur(target);
    expect(target).toHaveValue("/hu/categories/sps");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(target, { target: { value: "https://maps.example/x" } });
    fireEvent.blur(target);
    expect(target).toHaveValue("https://maps.example/x");
    expect(
      screen.getByText(
        /1\. dia, első gomb célja: csak a webshop egy oldala lehet/,
      ),
    ).toBeTruthy();
  });

  it("HP-ED-PREVIEW: without the storefront's address the preview says so, with it the frame points at the preview route", async () => {
    const { unmount } = render(<HomepageContentEditorPage />);
    expect(
      await screen.findByText(
        "A teszt kirakat címe ebben a környezetben nincs beállítva.",
      ),
    ).toBeTruthy();
    unmount();
    api.get.mockResolvedValue(
      stored({ storefrontUrl: "https://teszt.invalid" }),
    );
    render(<HomepageContentEditorPage />);
    const frame = (await screen.findByTitle(
      "A teszt kirakat kezdőlapjának élő előnézete",
    )) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      "https://teszt.invalid/hu/kezdolap-elonezet",
    );
    expect(
      screen
        .getByRole("link", { name: "Előnézet új lapon" })
        .getAttribute("href"),
    ).toBe("https://teszt.invalid/");
  });
});
