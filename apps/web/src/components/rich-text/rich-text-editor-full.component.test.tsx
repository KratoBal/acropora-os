import { sanitizeRichHtml } from "@acropora/rich-text";
import {
  FULL_TOOLBAR,
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A KOZOS SZERKESZTO TELJES PROFILJA (termekleiras, blogcikk, ReefClub cikk,
 * kezdolap blokk; Balazs dontese 2026-10-25 22:30 UTC, msg
 * 1564043552525389924).
 *
 * Ugyanaz a konzisztencia-allitas, mint a levelsablon profiljanal: amit a
 * szerkeszto eloallit, azt a szerver tisztitoja (`profile: "full"`)
 * VALTOZATLANUL engedi at. Es a masik irany: a levelsablon profilja ugyanazokat
 * a blokkokat tovabbra sem tudja eloallitani.
 */

interface Peldany {
  getHTML(): string;
  commands: {
    setContent(tartalom: string, opciok?: { emitUpdate?: boolean }): boolean;
    insertTable(opciok: {
      rows: number;
      cols: number;
      withHeaderRow: boolean;
    }): boolean;
    addRowAfter(): boolean;
  };
}

function megjelenit(props: Partial<Parameters<typeof RichTextEditor>[0]> = {}) {
  const onChange = vi.fn();
  const ref = createRef<RichTextEditorHandle>();
  render(
    <RichTextEditor
      ref={ref}
      aria-label="Leírás"
      value="<p></p>"
      onChange={onChange}
      profile="full"
      {...props}
    />,
  );
  const editor = () =>
    (screen.getByLabelText("Leírás") as HTMLElement & { editor: Peldany })
      .editor;
  return { onChange, ref, editor };
}

const teljesTisztito = (html: string) =>
  sanitizeRichHtml(html, { profile: "full" });

const MINDEN_BLOKK =
  '<h2 data-align="center">Cím</h2><h3>Alcím</h3>' +
  '<p><strong>Félkövér</strong> <em>dőlt</em> <u>aláhúzott</u> <a href="https://x.hu/a">link</a></p>' +
  "<ul><li><p>egy</p></li></ul><ol><li><p>kettő</p></li></ol>" +
  "<blockquote><p>idézet</p></blockquote>" +
  '<p><img src="https://cdn.example.hu/a.jpg" alt="A" width="800"></p>' +
  '<div data-gallery=""><img src="https://cdn.example.hu/b.jpg" alt="B"><img src="https://cdn.example.hu/c.jpg"></div>' +
  '<table><tbody><tr><th><p>Fej</p></th><th colspan="2"><p>Fej 2</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>' +
  '<div data-product-card="clx0abc123">Korallkaja</div>' +
  '<p data-align="center" data-cta=""><a href="https://x.hu/b">Gomb</a></p>';

describe("a teljes profil kimenete", () => {
  it("minden blokk változatlanul átmegy a szerkesztőn és a teljes profil tisztítóján", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.setContent(MINDEN_BLOKK);
    });
    const kimenet = editor().getHTML();
    expect(kimenet).toBe(MINDEN_BLOKK);
    expect(teljesTisztito(kimenet)).toBe(kimenet);
  });

  it("a beszúrt és bővített táblázat is a tisztító alakjában áll", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
      editor().commands.addRowAfter();
    });
    const kimenet = editor().getHTML();
    expect(kimenet).toContain("<table><tbody><tr><th>");
    expect(kimenet).not.toMatch(/style=|colgroup|colwidth/);
    expect(teljesTisztito(kimenet)).toBe(kimenet);
  });

  it("a szkriptet, az iframe-et és az on* attribútumot nem veszi át", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.setContent(
        '<p onclick="x()">a<script>alert(1)</script></p><iframe srcdoc="i"></iframe><table style="width:1px"><tbody><tr><td onmouseover="x()" style="text-align:center"><p>b</p></td></tr></tbody></table><img src="https://cdn.example.hu/a.jpg" onerror="x()">',
      );
    });
    const kimenet = editor().getHTML();
    expect(kimenet).not.toMatch(
      /script|iframe|onclick|onmouseover|onerror|style=/,
    );
    expect(teljesTisztito(kimenet)).toBe(kimenet);
  });

  it("http, data: és saját hivatkozású képet nem olvas be, a galériából sem", () => {
    const { editor } = megjelenit();
    act(() => {
      editor().commands.setContent(
        '<p>a<img src="http://cdn.example.hu/a.jpg">b<img src="acropora-image:logo1">c</p><div data-gallery=""><img src="data:image/png;base64,AAAA"></div>',
      );
    });
    expect(editor().getHTML()).not.toContain("<img");
    expect(editor().getHTML()).not.toContain("data-gallery");
  });
});

describe("a levelsablon profilja nem kap a teljes profil blokkjaiból", () => {
  it("táblázat, galéria és termékkártya nélkül olvassa be ugyanazt", () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        aria-label="Törzs"
        value={MINDEN_BLOKK}
        onChange={onChange}
        toolbar={FULL_TOOLBAR}
      />,
    );
    const elem = screen.getByLabelText("Törzs") as HTMLElement & {
      editor: Peldany;
    };
    const kimenet = elem.editor.getHTML();
    expect(kimenet).not.toMatch(/<table|data-gallery|data-product-card/);
    expect(sanitizeRichHtml(kimenet)).toBe(kimenet);
    const gombok = Array.from(
      screen
        .getByRole("toolbar", { name: "Formázás" })
        .querySelectorAll("button"),
    ).map((gomb) => gomb.getAttribute("aria-label"));
    expect(gombok).not.toContain("Táblázat");
    expect(gombok).not.toContain("Idézet");
  });
});

describe("a teljes profil kezelője és eszköztára", () => {
  it("insertGallery: csak a https képeket veszi át, üres listára semmit", () => {
    const { editor, ref } = megjelenit();
    act(() => {
      ref.current?.insertGallery([
        { src: "http://cdn.example.hu/x.jpg" },
        { src: "acropora-image:logo1" },
      ]);
    });
    expect(editor().getHTML()).not.toContain("data-gallery");
    act(() => {
      ref.current?.insertGallery([
        { src: "https://cdn.example.hu/a.jpg", alt: "A" },
        { src: "javascript:alert(1)" },
        { src: "https://cdn.example.hu/b.jpg" },
      ]);
    });
    expect(editor().getHTML()).toContain(
      '<div data-gallery=""><img src="https://cdn.example.hu/a.jpg" alt="A"><img src="https://cdn.example.hu/b.jpg"></div>',
    );
  });

  it("insertProductCard: érvényes azonosítóra kártyát tesz, rosszra semmit", () => {
    const { editor, ref } = megjelenit();
    act(() => {
      ref.current?.insertProductCard({ id: 'x" onclick="y', name: "Rossz" });
    });
    expect(editor().getHTML()).not.toContain("data-product-card");
    act(() => {
      ref.current?.insertProductCard({
        id: "clx0abc123",
        name: " Korallkaja ",
      });
    });
    expect(editor().getHTML()).toContain(
      '<div data-product-card="clx0abc123">Korallkaja</div>',
    );
    expect(teljesTisztito(editor().getHTML())).toBe(editor().getHTML());
  });

  it("a galéria és a termékkártya gombja csak választóval látszik, és azt hívja", () => {
    const onGalleryRequest = vi.fn();
    const onProductCardRequest = vi.fn();
    megjelenit({ onGalleryRequest, onProductCardRequest });
    fireEvent.click(screen.getByRole("button", { name: "Galéria beszúrása" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Termékkártya beszúrása" }),
    );
    expect(onGalleryRequest).toHaveBeenCalledTimes(1);
    expect(onProductCardRequest).toHaveBeenCalledTimes(1);
  });

  it("választó nélkül a galéria és a termékkártya gombja nincs ott", () => {
    megjelenit();
    expect(
      screen.queryByRole("button", { name: "Galéria beszúrása" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Termékkártya beszúrása" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Táblázat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Idézet" })).toBeTruthy();
  });

  it("a táblázat panel tábla nélkül beszúr, táblában sort ad hozzá", () => {
    const { editor } = megjelenit();
    fireEvent.click(screen.getByRole("button", { name: "Táblázat" }));
    fireEvent.click(
      screen.getByRole("button", { name: "3×3-as táblázat beszúrása" }),
    );
    expect(editor().getHTML().match(/<tr>/g)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Táblázat" }));
    fireEvent.click(screen.getByRole("button", { name: "Sor alá" }));
    expect(editor().getHTML().match(/<tr>/g)).toHaveLength(4);
  });
});
