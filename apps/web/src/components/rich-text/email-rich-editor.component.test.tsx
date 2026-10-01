import {
  EMAIL_CTA_STYLE,
  richHtmlForEmail,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  EmailRichEditor,
  type EmailRichEditorHandle,
} from "@acropora/ui/email-rich-editor";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A LEVEL SZERKESZTOJE (`@acropora/ui/email-rich-editor`, Figma 358:829 es
 * 358:1143): igazitas, gomb (CTA), bekezdes-tipus, visszavonas, HTML mod.
 *
 * A tarolt alak nautilus #1309-e: `data-align="center|right"` a bekezdesen es a
 * cimsoron, `<p data-cta="" ...><a href>Felirat</a></p>` a gomb. MI PIROSIT: ha
 * a szerkeszto mas jelolest adna, mint amit a tisztito atenged (a szerver
 * csendben elvenne); ha a gomb nem abban az alakban allna, amit a kuldes
 * (`richHtmlForEmail`) gombbá forditt; ha a HTML modbol tisztitatlan HTML
 * jutna az `onChange`-be, vagy a kiesett resz nem latszana.
 *
 * KORLAT, mint a kozos szerkeszto tesztjeinel: a kurzort a TipTap API-jan
 * allitjuk, nem billentyuvel.
 */

interface Peldany {
  getHTML(): string;
  commands: {
    setContent(tartalom: string, opciok?: { emitUpdate?: boolean }): boolean;
    setTextSelection(pozicio: number | { from: number; to: number }): boolean;
  };
}

const VALTOZOK = [
  { name: "customer_name", description: "A vevő neve." },
  { name: "document_link", description: "Link.", kind: "link" as const },
];
const HELYORZOK = ["document_link"];

function megjelenit(
  ertek = "<p></p>",
  extra: { onImageRequest?: () => void } = {},
) {
  const onChange = vi.fn();
  const ref = createRef<EmailRichEditorHandle>();
  render(
    <EmailRichEditor
      ref={ref}
      aria-label="Törzs"
      value={ertek}
      onChange={onChange}
      variables={VALTOZOK}
      {...extra}
    />,
  );
  const editor = () =>
    (screen.getByLabelText("Törzs") as HTMLElement & { editor: Peldany })
      .editor;
  const utolso = () => onChange.mock.calls.at(-1)?.[0] as string;
  return { onChange, ref, editor, utolso };
}

const gomb = (nev: string) =>
  within(screen.getByRole("toolbar", { name: "Formázás" })).getByRole(
    "button",
    { name: nev },
  );

describe("a levél szerkesztője: jelölés", () => {
  it("az igazítás és a gomb változatlanul átmegy a tisztítón", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.setContent(
        '<h2 data-align="center">Cím</h2><p data-align="right">jobbra</p><p data-cta="" data-align="center"><a href="{{document_link}}">Számla megnyitása</a></p>',
      );
    });
    const kimenet = editor().getHTML();
    expect(kimenet).toContain('<h2 data-align="center">Cím</h2>');
    expect(kimenet).toContain('<p data-align="right">jobbra</p>');
    expect(kimenet).toMatch(/<p [^>]*data-cta=""/);
    expect(sanitizeRichHtml(kimenet, { hrefPlaceholders: HELYORZOK })).toBe(
      kimenet,
    );
  });

  it("a bal igazításnak és az ismeretlen értéknek nincs jelölése", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.setContent(
        '<p data-align="left">bal</p><p data-align="justify">sorkizárt</p>',
      );
    });
    expect(editor().getHTML()).toBe("<p>bal</p><p>sorkizárt</p>");
  });
});

describe("a levél szerkesztője: eszköztár", () => {
  it("a terv sorrendjében áll, a kép gomb csak képadóval", () => {
    megjelenit("<p></p>", { onImageRequest: () => {} });
    const eszkoztar = screen.getByRole("toolbar", { name: "Formázás" });
    expect(
      within(eszkoztar).getByRole("combobox", { name: "Bekezdés típusa" }),
    ).toBeInTheDocument();
    expect(
      within(eszkoztar)
        .getAllByRole("button")
        .map((elem) => elem.getAttribute("aria-label")),
    ).toEqual([
      "Félkövér",
      "Dőlt",
      "Aláhúzott",
      "Visszavonás",
      "Újra",
      "Link",
      "Igazítás",
      "Felsorolás",
      "Számozott lista",
      "Kép beszúrása",
      "Gomb (CTA)",
    ]);
  });

  it("az igazítás panel középre tesz, a Balra leveszi a jelölést", () => {
    const { editor, utolso } = megjelenit("<p>szöveg</p>");
    act(() => {
      editor().commands.setTextSelection(2);
    });
    fireEvent.click(gomb("Igazítás"));
    fireEvent.click(screen.getByRole("button", { name: "Középre" }));
    expect(utolso()).toBe('<p data-align="center">szöveg</p>');
    fireEvent.click(gomb("Igazítás"));
    expect(screen.getByRole("button", { name: "Középre" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Balra" }));
    expect(utolso()).toBe("<p>szöveg</p>");
  });

  it("a bekezdés-típus címsorrá tesz, és az igazítás megmarad", () => {
    const { editor, utolso } = megjelenit('<p data-align="right">cím</p>');
    act(() => {
      editor().commands.setTextSelection(2);
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Bekezdés típusa" }),
      {
        target: { value: "h2" },
      },
    );
    expect(utolso()).toBe('<h2 data-align="right">cím</h2>');
  });

  it("a visszavonás csak változás után él, és visszaállít", () => {
    const { editor, utolso } = megjelenit("<p>szöveg</p>");
    expect(gomb("Visszavonás")).toBeDisabled();
    act(() => {
      editor().commands.setTextSelection(2);
    });
    fireEvent.click(gomb("Igazítás"));
    fireEvent.click(screen.getByRole("button", { name: "Jobbra" }));
    expect(utolso()).toBe('<p data-align="right">szöveg</p>');
    expect(gomb("Visszavonás")).not.toBeDisabled();
    fireEvent.click(gomb("Visszavonás"));
    expect(utolso()).toBe("<p>szöveg</p>");
    expect(gomb("Újra")).not.toBeDisabled();
  });
});

describe("a levél szerkesztője: gomb (CTA)", () => {
  it("a gombot a megbeszélt alakban szúrja be, a link-változót felkínálja", () => {
    const { utolso } = megjelenit("<p>Kedves vevő!</p>");
    fireEvent.click(gomb("Gomb (CTA)"));
    const panel = screen.getByRole("group", { name: "Gomb" });
    // az alapcél az első link-változó
    expect(within(panel).getByLabelText("Gomb célja")).toHaveValue(
      "{{document_link}}",
    );
    fireEvent.change(within(panel).getByLabelText("Gomb felirata"), {
      target: { value: "Számla megnyitása" },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Gomb beszúrása" }),
    );
    const html = utolso();
    expect(html).toMatch(
      /<p (?=[^>]*data-cta="")(?=[^>]*data-align="center")[^>]*><a href="\{\{document_link\}\}">Számla megnyitása<\/a><\/p>/,
    );
    // a küldés gombbá fordítja (nautilus #1309)
    expect(richHtmlForEmail(html)).toContain(`style="${EMAIL_CTA_STYLE}"`);
    expect(sanitizeRichHtml(html, { hrefPlaceholders: HELYORZOK })).toBe(html);
  });

  it("a meglévő gombot helyben írja át, és vissza tudja tenni sima bekezdésnek", () => {
    const { editor, utolso } = megjelenit(
      '<p data-cta="" data-align="center"><a href="{{document_link}}">Régi</a></p>',
    );
    act(() => {
      editor().commands.setTextSelection(2);
    });
    fireEvent.click(gomb("Gomb (CTA)"));
    const panel = screen.getByRole("group", { name: "Gomb" });
    expect(within(panel).getByLabelText("Gomb felirata")).toHaveValue("Régi");
    fireEvent.change(within(panel).getByLabelText("Gomb felirata"), {
      target: { value: "Új felirat" },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Gomb módosítása" }),
    );
    expect(utolso().match(/data-cta/g)).toHaveLength(1);
    expect(utolso()).toContain(
      '<a href="{{document_link}}">Új felirat</a></p>',
    );
    expect(utolso()).not.toContain("Régi");

    fireEvent.click(gomb("Gomb (CTA)"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Gomb" })).getByRole("button", {
        name: "Gomb megszüntetése",
      }),
    );
    expect(utolso()).not.toContain("data-cta");
    expect(utolso()).toContain('<a href="{{document_link}}">Új felirat</a>');
  });

  it("nem engedett célra és üres feliratra nem szúr be", () => {
    megjelenit();
    fireEvent.click(gomb("Gomb (CTA)"));
    const panel = screen.getByRole("group", { name: "Gomb" });
    const beszur = within(panel).getByRole("button", {
      name: "Gomb beszúrása",
    });
    expect(beszur).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText("Gomb felirata"), {
      target: { value: "Katt" },
    });
    fireEvent.change(within(panel).getByLabelText("Gomb célja"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(beszur).toBeDisabled();
    expect(
      within(panel).getByText(
        "Csak http(s), mailto vagy link-változó lehet a cél.",
      ),
    ).toBeInTheDocument();
  });
});

describe("a levél szerkesztője: HTML mód", () => {
  it("a nyers HTML a tisztítón át jut az onChange-be, a kiesett rész látszik", () => {
    const { utolso } = megjelenit("<p>alap</p>");
    fireEvent.click(screen.getByRole("tab", { name: "HTML" }));
    const doboz = screen.getByLabelText("Törzs (HTML)");
    expect(doboz).toHaveValue("<p>alap</p>");
    fireEvent.change(doboz, {
      target: {
        value:
          '<p style="color:red">piros</p><table><tr><td>cella</td></tr></table><p data-align="center">közép</p>',
      },
    });
    expect(utolso()).not.toContain("style");
    expect(utolso()).not.toContain("<table");
    expect(utolso()).toContain('<p data-align="center">közép</p>');
    const jelzes = screen.getByRole("status");
    expect(jelzes).toHaveTextContent("table");
    expect(jelzes).toHaveTextContent("p style");
    // a doboz a beírt szöveget tartja, nem írja vissza a tisztítottat
    expect(doboz).toHaveValue(
      '<p style="color:red">piros</p><table><tr><td>cella</td></tr></table><p data-align="center">közép</p>',
    );
  });

  it("HTML módban a változó a kurzorhoz kerül, atom alakban", () => {
    const { ref, utolso } = megjelenit("<p>ab</p>");
    fireEvent.click(screen.getByRole("tab", { name: "HTML" }));
    const doboz = screen.getByLabelText("Törzs (HTML)") as HTMLTextAreaElement;
    doboz.setSelectionRange(4, 4);
    act(() => {
      ref.current?.insertVariable("customer_name");
    });
    expect(utolso()).toBe(
      '<p>a<span data-variable="customer_name">{{customer_name}}</span>b</p>',
    );
    act(() => {
      ref.current?.insertVariable("nincs_ilyen");
    });
    expect(utolso()).toBe(
      '<p>a<span data-variable="customer_name">{{customer_name}}</span>b</p>',
    );
  });
});
