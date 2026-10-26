import { sanitizeRichHtml } from "@acropora/rich-text";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A KOZOS SZERKESZTO ROVID PROFILJA (Balazs megbizasa, 2026-10-26, 4. pont:
 * bekezdes, felkover, dolt, link, felsorolas). A kirakat kotott helyeire es a
 * lablec bemutatkozasara: annyi, amennyit a kirakat ott kirajzol.
 *
 * Ugyanaz a konzisztencia-allitas, mint a tobbi profilnal: amit a szerkeszto
 * eloallit, azt a `short` tisztito valtozatlanul engedi at; amit a profil nem
 * ismer, azt a szerkeszto elo sem allitja.
 */
interface Peldany {
  getHTML(): string;
  commands: {
    setContent(tartalom: string): boolean;
    selectAll(): boolean;
  };
}

function megjelenit() {
  render(
    <RichTextEditor
      aria-label="Rövid"
      profile="short"
      value="<p></p>"
      onChange={vi.fn()}
    />,
  );
  return () =>
    (screen.getByLabelText("Rövid") as HTMLElement & { editor: Peldany })
      .editor;
}

const rovid = (html: string) => sanitizeRichHtml(html, { profile: "short" });

describe("a rövid profil", () => {
  it("a megengedett formázás változatlanul átmegy a szerkesztőn és a rövid tisztítón", () => {
    const editor = megjelenit();
    const bemenet =
      '<p><strong>a</strong> <em>b</em> <a href="/store">bolt</a> <a href="https://x.hu">x</a></p><ul><li><p>egy</p></li></ul><ol><li><p>kettő</p></li></ol>';
    act(() => {
      editor().commands.setContent(bemenet);
    });
    expect(editor().getHTML()).toBe(bemenet);
    expect(rovid(editor().getHTML())).toBe(editor().getHTML());
  });

  it("címsort, idézetet, aláhúzást, képet és táblázatot nem állít elő", () => {
    const editor = megjelenit();
    act(() => {
      editor().commands.setContent(
        '<h2>Cím</h2><blockquote><p>i</p></blockquote><p><u>u</u><s>s</s><img src="https://x.hu/a.jpg"></p><table><tbody><tr><td><p>t</p></td></tr></tbody></table>',
      );
    });
    const kimenet = editor().getHTML();
    expect(kimenet).not.toMatch(/<h2|<blockquote|<u>|<s>|<img|<table/);
    expect(rovid(kimenet)).toBe(kimenet);
  });

  it("pontosan az öt rövid eszköztár-gomb áll ott", () => {
    megjelenit();
    const gombok = Array.from(
      screen
        .getByRole("toolbar", { name: "Formázás" })
        .querySelectorAll("button"),
    ).map((gomb) => gomb.getAttribute("aria-label"));
    expect(gombok).toEqual([
      "Félkövér",
      "Dőlt",
      "Link",
      "Felsorolás",
      "Számozott lista",
    ]);
  });

  it("a link célja lehet bolti útvonal, de a javascript: nem", () => {
    const editor = megjelenit();
    act(() => {
      editor().commands.setContent("<p>bolt</p>");
      editor().commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const cim = screen.getByLabelText("Link címe");
    fireEvent.change(cim, { target: { value: "javascript:alert(1)" } });
    expect(
      (
        screen.getByRole("button", {
          name: "Link beállítása",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(cim, { target: { value: "/store" } });
    fireEvent.click(screen.getByRole("button", { name: "Link beállítása" }));
    expect(editor().getHTML()).toBe('<p><a href="/store">bolt</a></p>');
  });
});
