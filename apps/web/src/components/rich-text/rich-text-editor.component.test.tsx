import { sanitizeRichHtml } from "@acropora/rich-text";
import { splitTemplateVariables } from "@acropora/types";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A KOZOS SZERKESZTO (`@acropora/ui/rich-text-editor`) ALLITASAI.
 *
 * A komponens a `packages/ui`-ban lakik, de ott nincs DOM-os tesztfuttato (a
 * csomag `node --test`-tel fut). A TipTap-nak DOM kell, ezert a tesztje itt all,
 * a happy-dom alatt.
 *
 * A LEGFONTOSABB ALLITAS A KONZISZTENCIA: amit a szerkeszto eloallit, azt a
 * szerver tisztitoja VALTOZATLANUL engedi at. Ha nem, a szerver menteskor
 * csendben elvesz valamit (egy linket, egy jelolest), es a szerkeszto a
 * kovetkezo betolteskor mast mutat, mint amit a felhasznalo mentett.
 *
 * KORLAT: a parancsokat a TipTap API-jan adjuk ki, nem billentyuvel. A
 * billentyu-szimulacio a happy-dom alatt nem hu a bongeszohoz.
 */

interface Peldany {
  getHTML(): string;
  view: { pasteText(szoveg: string): boolean };
  commands: {
    setContent(tartalom: string, opciok?: { emitUpdate?: boolean }): boolean;
    selectAll(): boolean;
    setTextSelection(tartomany: { from: number; to: number }): boolean;
    toggleBold(): boolean;
    setLink(attrs: { href: string }): boolean;
    insertContent(
      tartalom: string,
      opciok?: { applyPasteRules?: boolean; applyInputRules?: boolean },
    ): boolean;
  };
}

const VALTOZOK = [
  { name: "jegyszam", description: "A hibajegy száma." },
  { name: "jegy_linkje", description: "Link.", kind: "link" as const },
];
const LINK_HELYORZOK = ["jegy_linkje"];

function megjelenit(ertek = "<p></p>") {
  const onChange = vi.fn();
  const ref = createRef<RichTextEditorHandle>();
  render(
    <RichTextEditor
      ref={ref}
      aria-label="Törzs"
      value={ertek}
      onChange={onChange}
      variables={VALTOZOK}
    />,
  );
  const editor = () =>
    (screen.getByLabelText("Törzs") as HTMLElement & { editor: Peldany })
      .editor;
  return { onChange, ref, editor };
}

describe("a közös szerkesztő kimenete", () => {
  /*
    MINDEN ESZKOZTAR-ELEM ES A VALTOZO EGYUTT: ha barmelyik bovitmeny olyan
    attributumot tenne a kimenetbe, amit a tisztito kidob (a link `target` es
    `rel` alapbol ilyen), ez az allitas piros.
  */
  it("a szerkesztő kimenete változatlanul átmegy a szerver tisztítóján", () => {
    const { editor } = megjelenit();
    const bemenet =
      '<p><strong>Félkövér</strong> <em>dőlt</em> <u>aláhúzott</u> <a href="https://x.hu/a">link</a> <a href="{{jegy_linkje}}">hibajegy</a> <span data-variable="jegyszam">{{jegyszam}}</span></p><ul><li><p>egy</p></li></ul><ol><li><p>kettő</p></li></ol>';
    act(() => {
      editor().commands.setContent(bemenet);
    });
    const kimenet = editor().getHTML();
    expect(kimenet).toBe(bemenet);
    expect(
      sanitizeRichHtml(kimenet, { hrefPlaceholders: LINK_HELYORZOK }),
    ).toBe(kimenet);
  });

  it("a javascript: célú linket nem fogadja el", () => {
    const { editor } = megjelenit("<p>szöveg</p>");
    act(() => {
      editor().commands.selectAll();
      editor().commands.setLink({ href: "javascript:alert(1)" });
    });
    expect(editor().getHTML()).toBe("<p>szöveg</p>");
  });

  /**
   * A NEM LINK FAJTAJU VALTOZO NEM LEHET LINK CELJA -- ugyanaz a szabaly, mint a
   * tisztitoban (`isAllowedRichHref`). Ha a szerkeszto elfogadna, a szerver
   * menteskor csendben kidobna.
   */
  it("nem link fajtájú változót nem fogad el link-célként", () => {
    const { editor } = megjelenit("<p>szöveg</p>");
    act(() => {
      editor().commands.selectAll();
      editor().commands.setLink({ href: "{{jegyszam}}" });
    });
    expect(editor().getHTML()).toBe("<p>szöveg</p>");
  });

  /** A VALTOZO ATOM: ez az oka, hogy nem sima szovegkent all. */
  it("a formázás az egész változóra kerül, nem vágja ketté", () => {
    /*
      A KIJELOLES A VALTOZO KOZEPEN ER VEGET (1..10 = "Jegy: " + 4 pozicio).
      Sima szovegkent ez `{{j`-ig tartana, es a felkover ketté vagna a nevet;
      atomkent a valtozo EGY pozicio, tehat vagy egeszen benne van, vagy nincs.
      Egy teljes kijeloles (`selectAll`) ezt nem merne: az szovegen is egeszet
      formaz.
    */
    const { editor } = megjelenit(
      '<p>Jegy: <span data-variable="jegyszam">{{jegyszam}}</span> vége</p>',
    );
    act(() => {
      editor().commands.setTextSelection({ from: 1, to: 10 });
      editor().commands.toggleBold();
    });
    const html = editor().getHTML();
    expect(html).toContain("{{jegyszam}}");
    expect(splitTemplateVariables(html)).toEqual([]);
  });

  it("beillesztéskor az ismert név atom lesz, az ismeretlen szöveg marad", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().view.pasteText("{{jegyszam}} és {{elgepelt}}");
    });
    expect(editor().getHTML()).toBe(
      '<p><span data-variable="jegyszam">{{jegyszam}}</span> és {{elgepelt}}</p>',
    );
  });
});

describe("a közös szerkesztő felülete", () => {
  it("a kezelő insertVariable parancsa atomot szúr be, ismeretlen névre semmit", () => {
    const { editor, ref, onChange } = megjelenit();
    act(() => {
      ref.current?.insertVariable("nincs_ilyen");
    });
    expect(editor().getHTML()).toBe("<p></p>");
    act(() => {
      ref.current?.insertVariable("jegyszam");
    });
    expect(editor().getHTML()).toContain('data-variable="jegyszam"');
    // A VALTOZAS A HIVOHOZ IS ELJUT, NEM CSAK A SZERKESZTOBEN LATSZIK.
    expect(onChange).toHaveBeenLastCalledWith(editor().getHTML());
  });

  it("pontosan a hat jóváhagyott eszköztár-gomb áll ott", () => {
    megjelenit();
    const gombok = Array.from(
      screen
        .getByRole("toolbar", { name: "Formázás" })
        .querySelectorAll("button"),
    ).map((gomb) => gomb.getAttribute("aria-label"));
    expect(gombok).toEqual([
      "Félkövér",
      "Dőlt",
      "Aláhúzott",
      "Link",
      "Felsorolás",
      "Számozott lista",
    ]);
  });

  it("a link-szerkesztő felkínálja a link-változót, és beállítja célnak", () => {
    const { editor } = megjelenit("<p>hibajegy</p>");
    act(() => {
      editor().commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.click(screen.getByRole("button", { name: "{{jegy_linkje}}" }));
    fireEvent.click(screen.getByRole("button", { name: "Link beállítása" }));
    expect(editor().getHTML()).toBe(
      '<p><a href="{{jegy_linkje}}">hibajegy</a></p>',
    );
  });

  /*
    KIVULROL JOVO ERTEK (esemeny-valtas, visszatoltes) a szerkesztobe kerul -- de
    NEM hivja vissza az `onChange`-et, kulonben a betoltes "szerkesztesnek"
    latszana.
  */
  it("a kívülről érkező érték a szerkesztőbe kerül, onChange nélkül", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor
        aria-label="Törzs"
        value="<p>egy</p>"
        onChange={onChange}
      />,
    );
    rerender(
      <RichTextEditor
        aria-label="Törzs"
        value="<p>kettő</p>"
        onChange={onChange}
      />,
    );
    const editor = (
      screen.getByLabelText("Törzs") as HTMLElement & { editor: Peldany }
    ).editor;
    expect(editor.getHTML()).toBe("<p>kettő</p>");
    expect(onChange).not.toHaveBeenCalled();
  });
});
