import { validateQuoteRichText } from "@acropora/types";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * AZ ARAJANLATI SZOVEG A KOZOS SZERKESZTOBEN (#1582 P1, barracuda 4. pontja).
 *
 * A fo allitas: barmit ir vagy illeszt be a felhasznalo, a szerkeszto KIMENETE
 * atmegy a kozos seman (`validateQuoteRichText`) -- nem a szerver utasitja el
 * menteskor, es a felhasznalo szovege nem vesz el, csak a formazasa.
 *
 * KORLAT, mint a testver-tesztben: a parancsokat a TipTap API-jan adjuk ki
 * (beiras bemeneti szabalyokkal, HTML-beillesztes), nem billentyuvel.
 */

interface Peldany {
  getJSON(): unknown;
  schema: { marks: Record<string, unknown>; nodes: Record<string, unknown> };
  view: { pasteHTML(html: string): boolean };
  commands: {
    selectAll(): boolean;
    toggleBold(): boolean;
    toggleOrderedList(): boolean;
    toggleBulletList(): boolean;
    toggleItalic(): boolean;
    splitBlock(): boolean;
    setHardBreak(): boolean;
    setTextSelection(range: { from: number; to: number }): boolean;
    insertContent(
      tartalom: string,
      opciok?: { applyInputRules?: boolean },
    ): boolean;
  };
}

const URES = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });

function megjelenit(ertek = URES) {
  const onChange = vi.fn();
  render(
    <RichTextEditor
      mode="quote"
      aria-label="Ajánlat szöveg"
      value={ertek}
      onChange={onChange}
    />,
  );
  const editor = () =>
    (
      screen.getByLabelText("Ajánlat szöveg") as HTMLElement & {
        editor: Peldany;
      }
    ).editor;
  const utolso = () => {
    const raw = onChange.mock.calls.at(-1)?.[0] as string;
    return { raw, parsed: JSON.parse(raw) as unknown };
  };
  return { onChange, editor, utolso };
}

const szoveg = (raw: string) =>
  [...raw.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");

describe("az ajánlati szöveg szerkesztője", () => {
  it("`# ` és `> ` beírás után a kimenet átmegy a sémán, a szöveg megmarad", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().commands.insertContent("# Cím", { applyInputRules: true });
      editor().commands.insertContent(" > idézet", { applyInputRules: true });
    });
    const { raw, parsed } = utolso();
    expect(validateQuoteRichText(parsed).ok).toBe(true);
    expect(szoveg(raw)).toBe("# Cím > idézet");
  });

  it("beillesztett címsor, idézet, aláhúzás és link: a formázás elmarad, a szöveg nem", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().view.pasteHTML(
        '<h2>Cím</h2><blockquote><p>Idézet</p></blockquote><p><u>aláhúzott</u> <a href="https://pelda.test">link</a> <s>áthúzott</s> <strong>félkövér</strong></p>',
      );
    });
    const { raw, parsed } = utolso();
    const eredmeny = validateQuoteRichText(parsed);
    expect(eredmeny.ok).toBe(true);
    for (const darab of [
      "Cím",
      "Idézet",
      "aláhúzott",
      "link",
      "áthúzott",
      "félkövér",
    ])
      expect(szoveg(raw)).toContain(darab);
    expect(raw).toContain('"marks":[{"type":"bold"}]');
  });

  it("aláhúzás, link, címsor és idézet nincs a sémában, tehát a Ctrl+U sem tud jelölni", () => {
    const { editor } = megjelenit();
    for (const mark of ["underline", "link", "strike", "code"])
      expect(editor().schema.marks[mark]).toBeUndefined();
    for (const node of ["heading", "blockquote", "codeBlock", "horizontalRule"])
      expect(editor().schema.nodes[node]).toBeUndefined();
  });

  /*
    URGENT BUG HUNT (card fa6d7fa6, Luca 2026-11-26): what the editor sends for the formatting changes the report names (one bold letter, a
    new paragraph, a bullet list, mixed formatting) passes the shared schema, which the server applies to the save. The same shapes were
    measured in a real browser on the test OS (all 200). WHAT TURNS IT RED: if any of these editor outputs is outside the subset.
  */
  it("egy betű félkövér: a kimenet átmegy a sémán, és csak az a betű jelölt", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().commands.insertContent("alma");
      editor().commands.setTextSelection({ from: 2, to: 3 });
      editor().commands.toggleBold();
    });
    const { raw, parsed } = utolso();
    expect(validateQuoteRichText(parsed).ok).toBe(true);
    expect(raw).toContain(
      '{"type":"text","text":"l","marks":[{"type":"bold"}]}',
    );
    expect(szoveg(raw)).toBe("alma");
  });

  it("új bekezdés és felsorolás: a kimenet átmegy a sémán, a szöveg megmarad", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().commands.insertContent("alma");
      editor().commands.splitBlock();
      editor().commands.insertContent("körte");
      editor().commands.toggleBulletList();
    });
    const { raw, parsed } = utolso();
    expect(validateQuoteRichText(parsed).ok).toBe(true);
    expect(raw).toContain('"type":"bulletList"');
    expect(szoveg(raw)).toBe("almakörte");
  });

  it("vegyes formázás (félkövér, dőlt, sortörés, felsorolás): a kimenet átmegy a sémán", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().commands.insertContent("alma");
      editor().commands.selectAll();
      editor().commands.toggleBold();
      editor().commands.toggleItalic();
      editor().commands.toggleBulletList();
    });
    const { raw, parsed } = utolso();
    expect(validateQuoteRichText(parsed).ok).toBe(true);
    expect(raw).toContain('"marks":[{"type":"bold"},{"type":"italic"}]');
    expect(raw).not.toContain("attrs");
  });

  /*
    LUCA 2026-11-26 (card fa6d7fa6, AJ-2026-0021 Feltételek blokk): egy BEILLESZTETT, FÉLKÖVÉR bekezdés sortörésekkel. A ProseMirror a beillesztett
    `<b>` jelölését a benne lévő `<br>`-re is ráteszi (`{"type":"hardBreak","marks":[bold]}`), a közös séma pedig csak a szöveg csomópontnak enged
    jelölést: a szerver az egész dokumentumot elutasította ("A szöveg nem megengedett formázást tartalmaz"), a blokk nem volt menthető.
    MI PIROSÍT: ha a kimenetben egy sortörés jelölést visel; ha a félkövér szöveg jelölése a sortörés miatt elvész; ha a kimenet nem megy át a sémán.
  */
  it("beillesztett félkövér szövegben a sortörés nem visel jelölést, a szöveg jelölése megmarad, és a kimenet átmegy a sémán", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().view.pasteHTML(
        "<p><strong>első sor<br>második sor<br><br>negyedik sor</strong></p>",
      );
    });
    const { raw, parsed } = utolso();
    expect(raw).toContain('{"type":"hardBreak"}');
    expect(raw).not.toMatch(/"type":"hardBreak","marks"/);
    expect(raw).toContain('"text":"második sor","marks":[{"type":"bold"}]');
    expect(szoveg(raw)).toBe("első sormásodik sornegyedik sor");
    expect(validateQuoteRichText(parsed).ok).toBe(true);
  });

  it("a számozott lista attribútumai nem kerülnek a kimenetbe", () => {
    const { editor, utolso } = megjelenit();
    act(() => {
      editor().commands.insertContent("első");
      editor().commands.selectAll();
      editor().commands.toggleOrderedList();
    });
    const { raw, parsed } = utolso();
    expect(raw).toContain('"type":"orderedList"');
    expect(raw).not.toContain("attrs");
    expect(validateQuoteRichText(parsed).ok).toBe(true);
  });

  it("pontosan a négy jóváhagyott eszköztár-gomb áll ott, kérésre sem több", () => {
    render(
      <RichTextEditor
        mode="quote"
        aria-label="Másik"
        value={URES}
        onChange={() => {}}
        toolbar={[
          "bold",
          "underline",
          "link",
          "italic",
          "bulletList",
          "orderedList",
        ]}
      />,
    );
    const eszkoztar = screen
      .getAllByRole("toolbar", { name: "Formázás" })
      .at(-1)!;
    expect(
      [...eszkoztar.querySelectorAll("button")].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toHaveLength(4);
  });

  it("a kívülről jövő JSON-érték a szerkesztőbe kerül", () => {
    const ertek = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Betöltve" }] },
      ],
    });
    const { editor } = megjelenit(ertek);
    // the parsed document, not the JSON string shown as text
    expect(szoveg(JSON.stringify(editor().getJSON()))).toBe("Betöltve");
  });

  it("egy később érkező JSON-érték (betöltés) dokumentumként kerül be, nem szövegként", () => {
    const { rerender } = render(
      <RichTextEditor
        mode="quote"
        aria-label="Késői"
        value={URES}
        onChange={() => {}}
      />,
    );
    const ujErtek = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Később" }] },
      ],
    });
    rerender(
      <RichTextEditor
        mode="quote"
        aria-label="Késői"
        value={ujErtek}
        onChange={() => {}}
      />,
    );
    const peldany = (
      screen.getByLabelText("Késői") as HTMLElement & { editor: Peldany }
    ).editor;
    expect(szoveg(JSON.stringify(peldany.getJSON()))).toBe("Később");
  });
});
