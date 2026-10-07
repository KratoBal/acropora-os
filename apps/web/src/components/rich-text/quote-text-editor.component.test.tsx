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
