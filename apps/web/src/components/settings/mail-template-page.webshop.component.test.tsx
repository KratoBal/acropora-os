import { mailTemplateEventVariables } from "@acropora/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailTemplatePage } from "./mail-template-page";

/*
  LEVÉLSABLONOK · WEBSHOP (Figma 527:414, the prompt's point 27). WHAT TURNS
  RED: the two groups do not separate; the webshop group does not list its ten
  templates; switching loses unsaved text without asking; the reset does not
  ask; a failed load wipes the editor; a block inside a sentence can be saved;
  the webshop preview is not the send path's.
*/
const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api/mail-templates", async () => {
  const valodi = await vi.importActual<
    typeof import("@/lib/api/mail-templates")
  >("@/lib/api/mail-templates");
  return { ...valodi, mailTemplatesApi: api };
});

const kepApi = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  content: vi.fn(),
}));
vi.mock("@/lib/api/mail-images", () => ({ mailImagesApi: kepApi }));
vi.mock("@/lib/api/webshop-mail-outbox", () => ({
  webshopMailOutboxApi: {
    stuck: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    retry: vi.fn(),
  },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

const v = (n: string) => `<span data-variable="${n}">{{${n}}}</span>`;

/** The server's answer for a webshop key: its real variable list. */
const webshopValasz = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source: "default",
  subject: "Feladtuk a csomagodat (#{{rendeles_szam}})",
  body: "x",
  bodyHtml: `<p>Rendelés: #${v("rendeles_szam")}</p><p>${v("szallitas_doboz")}</p><p>${v("csomag_tartalma")}</p>`,
  defaultTemplate: {
    subject: "Feladtuk a csomagodat (#{{rendeles_szam}})",
    body: "x",
    bodyHtml: `<p>Rendelés: #${v("rendeles_szam")}</p><p>${v("szallitas_doboz")}</p><p>${v("csomag_tartalma")}</p>`,
  },
  sampleLinks: {},
  variables: mailTemplateEventVariables(id),
  ...over,
});

const szervizValasz = {
  id: "WORKSHEET_SIGNED",
  source: "stored",
  subject: "{{jegyszam}}",
  body: "Kedves {{cimzett}}!",
  bodyHtml: null,
  defaultTemplate: { subject: "{{jegyszam}}", body: "Alap {{cimzett}}" },
  sampleLinks: {},
  variables: mailTemplateEventVariables("WORKSHEET_SIGNED"),
};

interface SzerkesztoPeldany {
  getHTML(): string;
  commands: {
    setContent(tartalom: string, opciok?: { emitUpdate?: boolean }): boolean;
  };
}
const szerkeszto = () =>
  (
    screen.getByLabelText("Törzs") as HTMLElement & {
      editor: SzerkesztoPeldany;
    }
  ).editor;
const torzsBeir = (html: string) =>
  act(() => {
    szerkeszto().commands.setContent(html, { emitUpdate: true });
  });

const megjelenit = async () => {
  render(<MailTemplatePage />);
  await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
};

const webshopFul = async () => {
  fireEvent.click(screen.getByRole("tab", { name: "Webshop" }));
  await waitFor(() =>
    expect(api.read).toHaveBeenLastCalledWith(
      "token-1",
      "WEBSHOP_ORDER_PLACED",
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
};

beforeEach(() => {
  api.read
    .mockReset()
    .mockImplementation(async (_t: string, id: string) =>
      id.startsWith("WEBSHOP_") ? webshopValasz(id) : szervizValasz,
    );
  api.save.mockReset().mockResolvedValue({ ok: true });
  api.list.mockReset().mockResolvedValue([
    {
      id: "WEBSHOP_ORDER_SHIPPED",
      source: "stored",
      updatedAt: "2026-10-05T16:42:00.000Z",
    },
  ]);
  kepApi.list.mockReset().mockResolvedValue([]);
});

describe("Levélsablonok: Szerviz és Webshop", () => {
  it("the Webshop tab lists its sixteen templates with their status", async () => {
    await megjelenit();
    expect(
      screen
        .getByRole("tab", { name: "Szerviz" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await webshopFul();
    const lista = screen.getByRole("list", { name: "Sablonok" });
    /* sixteen Hungarian mails (the fifteenth: the withdrawal acknowledgement, a draft; the sixteenth: the stock alert's arrival), and the sixteen English twins next to them (card d5c6befd) */
    expect(within(lista).getAllByRole("button")).toHaveLength(32);
    // the draft is listed like any other: the owner edits its wording in the editor, so it must be reachable there
    expect(
      within(lista).getByRole("button", {
        name: /Elállási nyilatkozat megérkezett(?! \(angol\))/,
      }),
    ).toBeTruthy();
    const angol = within(lista).getByRole("button", {
      name: /Csomag átadva a szállítónak \(angol\)/,
    });
    expect(within(angol).getByText("Alapértelmezett")).toBeTruthy();
    const feladtuk = within(lista).getByRole("button", {
      name: /Csomag átadva a szállítónak(?! \(angol\))/,
    });
    expect(within(feladtuk).getByText("Szerkesztett")).toBeTruthy();
    expect(
      within(
        within(lista).getByRole("button", {
          name: /Rendelés leadva(?! \(angol\))/,
        }),
      ).getByText("Alapértelmezett"),
    ).toBeTruthy();
  });

  it("choosing a template loads it", async () => {
    await megjelenit();
    await webshopFul();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Csomag átadva a szállítónak(?! \(angol\))/,
      }),
    );
    await waitFor(() =>
      expect(api.read).toHaveBeenLastCalledWith(
        "token-1",
        "WEBSHOP_ORDER_SHIPPED",
        expect.anything(),
      ),
    );
  });

  it("unsaved text: switching asks, Maradok keeps it, Kilépés switches", async () => {
    await megjelenit();
    await webshopFul();
    await torzsBeir("<p>Átírva</p>");
    fireEvent.click(
      screen.getByRole("button", { name: /Szállítási csúszás(?! \(angol\))/ }),
    );
    expect(screen.getByText("Nem mentett módosításaid vannak.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Maradok" }));
    expect(szerkeszto().getHTML()).toContain("Átírva");
    expect(api.read).not.toHaveBeenLastCalledWith(
      "token-1",
      "WEBSHOP_SHIPPING_DELAYED",
      expect.anything(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Szállítási csúszás(?! \(angol\))/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Kilépés mentés nélkül" }),
    );
    await waitFor(() =>
      expect(api.read).toHaveBeenLastCalledWith(
        "token-1",
        "WEBSHOP_SHIPPING_DELAYED",
        expect.anything(),
      ),
    );
  });

  it("unsaved text: the group tab asks too; untouched text does not", async () => {
    await megjelenit();
    await webshopFul();
    // control: an untouched template switches without a question
    fireEvent.click(
      screen.getByRole("button", { name: /Visszatérítés(?! \(angol\))/ }),
    );
    expect(screen.queryByText("Nem mentett módosításaid vannak.")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
    await torzsBeir("<p>Átírva</p>");
    fireEvent.click(screen.getByRole("tab", { name: "Szerviz" }));
    expect(screen.getByText("Nem mentett módosításaid vannak.")).toBeTruthy();
  });

  it("unsaved text: a link inside the app asks before leaving", async () => {
    await megjelenit();
    const link = document.createElement("a");
    link.href = "/beallitasok";
    link.setAttribute("href", "/beallitasok");
    link.textContent = "Beállítások";
    document.body.appendChild(link);
    await torzsBeir("<p>Átírva</p>");
    fireEvent.click(link);
    expect(screen.getByText("Nem mentett módosításaid vannak.")).toBeTruthy();
    link.remove();
  });

  it("the reset asks; Mégse leaves the text alone", async () => {
    await megjelenit();
    await webshopFul();
    await torzsBeir("<p>Átírva</p>");
    fireEvent.click(
      screen.getByRole("button", { name: "Alapértelmezés visszatöltése" }),
    );
    expect(
      screen.getByText("Visszaállítod az alapértelmezett szöveget?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mégse" }));
    expect(szerkeszto().getHTML()).toContain("Átírva");
    fireEvent.click(
      screen.getByRole("button", { name: "Alapértelmezés visszatöltése" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Visszaállítás" }));
    await waitFor(() => expect(szerkeszto().getHTML()).not.toContain("Átírva"));
    expect(api.save).not.toHaveBeenCalled();
  });

  it("loading shows a placeholder, not an empty editor", async () => {
    api.read.mockImplementation(() => new Promise(() => undefined));
    render(<MailTemplatePage />);
    expect(screen.getByLabelText("Sablon betöltése")).toBeTruthy();
    expect(screen.queryByLabelText("Törzs")).toBeNull();
  });

  it("a load error says so and retries", async () => {
    api.read.mockRejectedValueOnce(new Error("A szerver nem válaszolt."));
    render(<MailTemplatePage />);
    expect(
      await screen.findByText("Nem sikerült betölteni a levélsablonokat."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Újrapróbálás" }));
    await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
  });

  it("a failed reload after saving keeps the edited text", async () => {
    await megjelenit();
    await torzsBeir("<p>Mentett szöveg</p>");
    api.read.mockRejectedValueOnce(new Error("A szerver nem válaszolt."));
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("Nem sikerült betölteni a levélsablonokat."),
    ).toBeTruthy();
    expect(szerkeszto().getHTML()).toContain("Mentett szöveg");
  });

  it("a block inside a sentence is named, and the save is off", async () => {
    await megjelenit();
    await webshopFul();
    await torzsBeir(`<p>Tételek: ${v("rendeles_tetelek")}</p>`);
    expect(
      screen.getByText("A blokk csak külön bekezdésben állhat"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("the webshop preview is the send path's: blocks, frame, both forms", async () => {
    await megjelenit();
    await webshopFul();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Csomag átadva a szállítónak(?! \(angol\))/,
      }),
    );
    await waitFor(() =>
      expect(api.read).toHaveBeenLastCalledWith(
        "token-1",
        "WEBSHOP_ORDER_SHIPPED",
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Feladtuk a csomagodat (#38)")).toBeTruthy(),
    );
    const iframe = screen.getByTitle(
      "A levél formázott előnézete",
    ) as HTMLIFrameElement;
    const html = iframe.getAttribute("srcdoc") ?? "";
    expect(html).toContain("FOXPOST – Auchan Aquincum automata");
    expect(html).toContain("CLFOX0000000000");
    expect(html).toContain("Hanna HI780-25 pH reagens × 1");
    expect(html).toContain("Acropora tengeri akvarisztika");
    expect(html).not.toContain("{{");
    fireEvent.click(screen.getByRole("tab", { name: "Szöveges" }));
    expect(document.querySelector("pre")?.textContent).toContain(
      "A csomagban:\n- Hanna HI780-25 pH reagens × 1",
    );
  });

  /*
    THE ENGLISH TWIN PREVIEWS AS ENGLISH (card d5c6befd): opening it reads the
    twin's own key, and the preview's document carries the language, so the
    page language and the words agree. (The fixture serves the same text for
    every key; what is under test is the key and the language.)
  */
  it("an English twin loads under its own key and previews as an English mail", async () => {
    await megjelenit();
    await webshopFul();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Csomag átadva a szállítónak \(angol\)/,
      }),
    );
    await waitFor(() =>
      expect(api.read).toHaveBeenLastCalledWith(
        "token-1",
        "WEBSHOP_ORDER_SHIPPED_EN",
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTitle("A levél formázott előnézete")).toBeTruthy(),
    );
    const iframe = screen.getByTitle(
      "A levél formázott előnézete",
    ) as HTMLIFrameElement;
    expect(iframe.getAttribute("srcdoc") ?? "").toContain('<html lang="en">');
  });

  /*
    FROM THE WEBSHOP SETTINGS PAGE (2026-10-26): its card links here with
    ?csoport=webshop, and the Webshop tab opens straight away. Without the
    parameter the Szerviz tab stays the default (the first test above).
  */
  it("?csoport=webshop opens the Webshop tab and loads its first template", async () => {
    window.history.replaceState(
      null,
      "",
      "/beallitasok/levelsablonok?csoport=webshop",
    );
    try {
      await megjelenit();
      expect(
        screen
          .getByRole("tab", { name: "Webshop" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(api.read).toHaveBeenCalledWith(
        "token-1",
        "WEBSHOP_ORDER_PLACED",
        expect.anything(),
      );
      expect(api.read).not.toHaveBeenCalledWith(
        "token-1",
        "WORKSHEET_SIGNED",
        expect.anything(),
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("a saved template says when it was saved", async () => {
    api.read.mockImplementation(async (_t: string, id: string) =>
      webshopValasz(id, { source: "stored" }),
    );
    await megjelenit();
    await webshopFul();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Csomag átadva a szállítónak(?! \(angol\))/,
      }),
    );
    expect(
      await screen.findByText(/^Utoljára mentve (ma )?.*\d\d:\d\d$/),
    ).toBeTruthy();
  });
});
