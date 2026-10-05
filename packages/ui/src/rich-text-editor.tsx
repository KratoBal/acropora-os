"use client";

/**
 * A FORMAZOTT SZOVEG SZERKESZTOJE -- KOZOS KOMPONENS.
 *
 * Balazs kerese, 2026-09-26 14:10 (Acropora OS szal): HTML szerkeszto a
 * levelsablonokhoz, KOZOS komponenskent, hogy mas helyen is hasznalhato
 * legyen. Terv: `agents/nautilus/html-levelsablon-terv-2026-09-26.md`, 1. es
 * 5. pont.
 *
 * === KULON ALUTVONALON, NEM A FO `index.ts`-BOL ===
 *
 * `@acropora/ui/rich-text-editor`. A partnerportal is a `@acropora/ui`-t
 * importalja; ha ez a fo indexbol jonne, a TipTap annak a csomagjaba is
 * bekerulne, pedig ott nem hasznalja senki.
 *
 * === A TIPTAP OPCIONALIS PEER, NEM FUGGOSEG -- ES EZ MERT OK ===
 *
 * Elso alakjaban a harom TipTap csomag a `@acropora/ui` `dependencies` alatt
 * allt. A repo `.npmrc`-je `inject-workspace-packages=true`, es a peer-igenyes
 * fuggoseg miatt a pnpm a `ui`-t onnantol NEM symlinkkel, hanem MASOLATKENT
 * kototte be a webbe es a partnerportalba (`file:packages/ui` a lockfile-ban).
 * Kovetkezmenyek, mindketto mert: a partnerportal `next build`-je elhasalt
 * ("Unknown module type" a masolt `src/index.ts`-en, mert ott nincs a
 * `transpilePackages`-ben), es a `ui` fejlesztes kozbeni valtozasa ujratelepites
 * nelkul nem jutott volna el az alkalmazasokba.
 *
 * Ezert: a `ui` csak OPCIONALIS peerkent nevezi meg (fejleszteshez dev-fuggoseg),
 * a valodi fuggoseg annal az alkalmazasnal all, amelyik ezt az alutvonalat
 * importalja (ma: `apps/web`). A partnerportal igy TipTap nelkul marad.
 *
 * === A KIMENET A `RICH_TEXT_ALLOWED_TAGS` RESZHALMAZA ===
 *
 * A bovitmenyek listaja szandekosan szuk: ami a szerver tisztitojan nem menne
 * at (kod-blokk, inline kod), az itt nincs is. A link `target`/`rel`
 * attributuma ki van kapcsolva, es a link-cel ugyanazon a szabalyon dol el,
 * mint a tisztitoban (`isAllowedRichHref`). Igy amit a szerkeszto elfogad, azt
 * a szerver valtozatlanul tarolja -- erre allitas all a web tesztjei kozott.
 *
 * === A VALTOZO ATOM, NEM SZOVEG ===
 *
 * Egy sima szovegkent allo `{{jegyszam}}` belsejere formazas kerulhet
 * (`{{jegy<strong>szam</strong>}}`), es akkor a level a nevet nyersen kuldi.
 * Atomkent a valtozo egy egyseg: egyben jelolheto ki, egyben torolheto, a
 * formazas az egeszre kerul.
 */
import {
  isAllowedRichHref,
  RICH_TEXT_ALIGNMENTS,
  RICH_TEXT_IMAGE_MAX_WIDTH,
  RICH_TEXT_VARIABLE_NAME,
  richImageId,
  type RichTextAlignment,
} from "@acropora/rich-text";
import {
  EditorContent,
  Extension,
  InputRule,
  Node,
  PasteRule,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";

import { cn } from "./utils";

export interface RichTextVariable {
  readonly name: string;
  readonly description?: string;
  /**
   * `"link"`: link celjakent is beilleszheto. `"block"`: a system-built block
   * that stands alone in its paragraph; the editor inserts it like any other.
   */
  readonly kind?: "link" | "block";
}

export type RichTextToolbarItem =
  | "blockType"
  | "bold"
  | "italic"
  | "underline"
  | "undo"
  | "redo"
  | "link"
  | "align"
  | "bulletList"
  | "orderedList"
  | "image"
  | "cta";

/**
 * A LEVELEK ESZKOZTARA (Figma 358:829, 358:1143): a sorrend a tervé. A kep gomb
 * itt is csak akkor latszik, ha a hivo ad `onImageRequest`-et.
 */
export const EMAIL_TOOLBAR: readonly RichTextToolbarItem[] = [
  "blockType",
  "bold",
  "italic",
  "underline",
  "undo",
  "redo",
  "link",
  "align",
  "bulletList",
  "orderedList",
  "image",
  "cta",
];

/** A beszurando kep. A `src` a sajat hivatkozas: `acropora-image:<id>`. */
export interface RichTextImage {
  readonly src: string;
  readonly alt?: string;
  readonly width?: number;
}

export interface RichTextEditorHandle {
  /** A valtozot atomkent a kurzor helyere teszi. Ismeretlen nevre nem tesz semmit. */
  insertVariable(name: string): void;
  /**
   * A kepet a kurzor helyere teszi. Idegen forrasra (`http`, `data:`) nem tesz
   * semmit: a tisztito ugyis kidobna, es a szerkeszto ne mutasson olyat, ami
   * nem marad meg.
   */
  insertImage(image: RichTextImage): void;
  focus(): void;
}

export interface RichTextEditorProps {
  /** A `RICH_TEXT_ALLOWED_TAGS` szerinti HTML. */
  readonly value: string;
  readonly onChange: (html: string) => void;
  /** Hianyaban nincs valtozo-atom: altalanos szovegszerkeszto. */
  readonly variables?: readonly RichTextVariable[];
  readonly toolbar?: readonly RichTextToolbarItem[];
  /**
   * A KEP GOMB ESEMENYE. A kepvalaszto (feltoltes, lista) a HIVO dolga, mert
   * a kep tarolasa alkalmazasfuggo; a szerkeszto csak jelzi, hogy kep kell, es
   * a hivo az `insertImage`-dzsel teszi be. Hianyaban a kep gomb nem jelenik
   * meg, akkor sem, ha az eszkoztar listaja tartalmazza.
   */
  readonly onImageRequest?: () => void;
  /**
   * A SAJAT HIVATKOZAS MEGJELENITHETO CIME (pl. egy mar betoltott `data:` URL).
   * A szerkesztoben csak a MEGJELENITES hasznalja: a kimenetben a hivatkozas
   * all, nem ez. `undefined`-re a kep helye ures, amig a cim meg nincs meg.
   */
  readonly resolveImageSrc?: (src: string) => string | undefined;
  readonly "aria-label": string;
  readonly className?: string;
  readonly ref?: Ref<RichTextEditorHandle>;
}

const ALAP_ESZKOZTAR: readonly RichTextToolbarItem[] = [
  "bold",
  "italic",
  "underline",
  "link",
  "bulletList",
  "orderedList",
];

const BEIRT_VALTOZO = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;
const BEILLESZTETT_VALTOZO = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * A VALTOZO-CSOMOPONT. HTML-alakja `<span data-variable="nev">{{nev}}</span>`:
 * a szoveg benne maga a helyorzo, tehat a szerveren a sablon-motor minta
 * valtozatlanul illeszkedik ra, a jeloles pedig csak a szerkesztonek szol.
 */
function valtozoCsomopont(ismert: ReadonlySet<string>) {
  const letrehoz = (nev: string | undefined) =>
    nev && ismert.has(nev) ? { name: nev } : null;
  return Node.create({
    name: "templateVariable",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        name: {
          default: null,
          parseHTML: (elem) => elem.getAttribute("data-variable"),
          renderHTML: (attrs) => ({ "data-variable": attrs.name }),
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: "span[data-variable]",
          getAttrs: (elem) =>
            RICH_TEXT_VARIABLE_NAME.test(
              elem.getAttribute("data-variable") ?? "",
            )
              ? null
              : false,
        },
      ];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["span", HTMLAttributes, `{{${node.attrs.name as string}}}`];
    },
    renderText({ node }) {
      return `{{${node.attrs.name as string}}}`;
    },
    /*
      BEIRASRA ES BEILLESZTESRE IS ATOM LESZ -- DE CSAK AZ ISMERT NEV.
      Az ismeretlen nev szoveg marad, tehat latszik, es a sablon-ellenorzes
      megnevezi. Ha azt is atomma tennenk, egy elgepeles "rendes" valtozonak
      nezne ki.
    */
    addInputRules() {
      return [
        new InputRule({
          find: BEIRT_VALTOZO,
          handler: ({ state, range, match }) => {
            const attrs = letrehoz(match[1]);
            if (!attrs) return null;
            state.tr.replaceWith(range.from, range.to, this.type.create(attrs));
          },
        }),
      ];
    },
    addPasteRules() {
      return [
        new PasteRule({
          find: BEILLESZTETT_VALTOZO,
          /*
            AZ ISMERETLEN NEVRE `undefined`, NEM `null`. A TipTap beillesztesi
            koreben EGYETLEN `null` az egesz kort ervenyteleniti (`handlers.every(
            h => h !== null)`), tehat egy elgepelt nev mellett az ismertek sem
            valnanak atomma. Mert, 2026-09-26: `{{jegyszam}} es {{elgepelt}}`
            beillesztve mindkettot szovegnek hagyta.
          */
          handler: ({ chain, range, match }) => {
            const attrs = letrehoz(match[1]);
            if (!attrs) return;
            chain()
              .deleteRange(range)
              .insertContentAt(range.from, { type: this.name, attrs })
              .run();
          },
        }),
      ];
    },
  });
}

/**
 * A KEP-CSOMOPONT (2026-09-28). HTML-alakja `<img src="acropora-image:<id>"
 * alt="..." width="...">`, pontosan a tisztito altal engedett reszhalmaz.
 *
 * A BEOLVASAS CSAK A SAJAT HIVATKOZAST FOGADJA EL. Egy beillesztett kulso kep
 * (`http`, `data:`) nem lesz csomopont, tehat el sem jut a mentesig -- ugyanaz
 * a szabaly, mint a tisztitoban (`richImageId`).
 *
 * A MEGJELENITES KULON UT (`addNodeView`): a hivatkozast a bongeszo nem tudja
 * betolteni, ezert a csomopont a hivo altal adott cimet mutatja, a kimenet
 * (`renderHTML`) pedig a hivatkozast. A ketto soha nem keveredik: a
 * megjelenitett cim nem kerulhet a mentett HTML-be.
 */
function kepCsomopont(felold: {
  current: ((src: string) => string | undefined) | undefined;
}) {
  return Node.create({
    name: "templateImage",
    group: "inline",
    inline: true,
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return {
        src: { default: null },
        alt: { default: null },
        width: {
          default: null,
          parseHTML: (elem) => {
            const w = Number(elem.getAttribute("width"));
            return Number.isInteger(w) &&
              w >= 1 &&
              w <= RICH_TEXT_IMAGE_MAX_WIDTH
              ? w
              : null;
          },
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: "img[src]",
          getAttrs: (elem) =>
            richImageId(elem.getAttribute("src") ?? "") ? null : false,
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ["img", HTMLAttributes];
    },
    addNodeView() {
      return ({ node }) => {
        const img = document.createElement("img");
        const src = node.attrs.src as string;
        img.dataset.src = src;
        const cim = felold.current?.(src);
        if (cim) img.src = cim;
        if (node.attrs.alt) img.alt = node.attrs.alt as string;
        if (node.attrs.width) img.width = node.attrs.width as number;
        img.style.maxWidth = "100%";
        img.style.display = "inline-block";
        return { dom: img };
      };
    },
  });
}

const IGAZITASOK: ReadonlySet<string> = new Set(RICH_TEXT_ALIGNMENTS);

/**
 * AZ IGAZITAS ES A GOMB JELOLESE (nautilus #1309, a tarolt alak:
 * `agents/nautilus/megosztas/email-rich-editor-tarolt-html.md`).
 *
 * - `data-align="center|right"` a bekezdesen es a cimsoron. A bal az
 *   alapertelmezes, es NINCS jelolese: a `null` nem ir attributumot.
 * - `data-cta=""` a bekezdesen: a benne allo egyetlen link gombkent megy ki.
 *
 * Nem a TipTap `TextAlign`-ja: az `style="text-align"`-t ir, a tisztito pedig a
 * `style`-t eldobja. Igy a szerkeszto pontosan azt a jelolest adja, amit a
 * tisztito atenged, es amit a kuldes (`richHtmlForEmail`) inline stilusra fordit.
 */
const blokkJelolesek = Extension.create({
  name: "emailBlockMarks",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          align: {
            default: null,
            parseHTML: (elem) => {
              const ertek = elem.getAttribute("data-align");
              return ertek && IGAZITASOK.has(ertek) ? ertek : null;
            },
            renderHTML: (attrs) =>
              attrs.align ? { "data-align": attrs.align as string } : {},
          },
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          cta: {
            default: false,
            parseHTML: (elem) => elem.hasAttribute("data-cta"),
            renderHTML: (attrs) => (attrs.cta ? { "data-cta": "" } : {}),
          },
        },
      },
    ];
  },
});

function bovitmenyek(
  variables: readonly RichTextVariable[],
  linkValtozok: readonly string[],
  felold: { current: ((src: string) => string | undefined) | undefined },
) {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      trailingNode: false,
      heading: { levels: [2, 3] },
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { target: null, rel: null },
        isAllowedUri: (href) =>
          isAllowedRichHref(href, { hrefPlaceholders: linkValtozok }),
      },
    }),
    ...(variables.length
      ? [valtozoCsomopont(new Set(variables.map((v) => v.name)))]
      : []),
    kepCsomopont(felold),
    blokkJelolesek,
  ];
}

function EszkozGomb(props: {
  cimke: string;
  aktiv: boolean;
  tiltott?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.cimke}
      title={props.cimke}
      aria-pressed={props.aktiv}
      disabled={props.tiltott}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
      className={cn(
        "min-w-8 rounded-md px-2 py-1 text-sm text-dusk-700 transition hover:bg-dusk-100 disabled:opacity-40 disabled:hover:bg-transparent",
        props.aktiv && "bg-brand-50 text-brand-700",
      )}
    >
      {props.children}
    </button>
  );
}

function LinkSzerkeszto(props: {
  editor: Editor;
  linkValtozok: readonly RichTextVariable[];
  onClose: () => void;
}) {
  const { editor, linkValtozok, onClose } = props;
  const [cim, setCim] = useState<string>(
    (editor.getAttributes("link").href as string | undefined) ?? "",
  );
  const ervenyes = isAllowedRichHref(cim, {
    hrefPlaceholders: linkValtozok.map((v) => v.name),
  });
  const alkalmaz = () => {
    if (!ervenyes) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: cim }).run();
    onClose();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-dusk-100 px-2 py-2">
      <input
        aria-label="Link címe"
        value={cim}
        placeholder="https://"
        onChange={(event) => setCim(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            alkalmaz();
          }
        }}
        className="min-w-48 flex-1 rounded-md border border-dusk-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
      />
      {/*
        A LINK-VALTOZOK KULON FELKINALVA: a `{{jegy_linkje}}` alakot kezzel
        begepelni hibalehetoseg, es a szerkeszto csak a link fajtajuakat
        fogadja el celkent.
      */}
      {linkValtozok.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => setCim(`{{${v.name}}}`)}
          className="rounded-md bg-dusk-50 px-2 py-1 font-mono text-xs text-dusk-700 hover:bg-dusk-100"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
      <button
        type="button"
        onClick={alkalmaz}
        disabled={!ervenyes}
        className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
      >
        Link beállítása
      </button>
      {editor.isActive("link") ? (
        <button
          type="button"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
          className="rounded-md px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
        >
          Link törlése
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-2 py-1 text-xs text-dusk-600 hover:bg-dusk-100"
      >
        Mégse
      </button>
      {!ervenyes && cim ? (
        <p className="w-full text-xs text-rose-600">
          Csak http(s), mailto vagy link-változó lehet a cél.
        </p>
      ) : null}
    </div>
  );
}

const IGAZITAS_GOMBOK: readonly {
  ertek: RichTextAlignment | null;
  cimke: string;
}[] = [
  { ertek: null, cimke: "Balra" },
  { ertek: "center", cimke: "Középre" },
  { ertek: "right", cimke: "Jobbra" },
];

/** A kijelolt blokk igazitasa: bekezdes vagy cimsor, a bal a `null`. */
function blokkIgazitas(editor: Editor): RichTextAlignment | null {
  const ertek =
    (editor.getAttributes("paragraph").align as string | null | undefined) ??
    (editor.getAttributes("heading").align as string | null | undefined);
  return ertek && IGAZITASOK.has(ertek) ? (ertek as RichTextAlignment) : null;
}

function IgazitasPanel(props: { editor: Editor; onClose: () => void }) {
  const { editor, onClose } = props;
  const most = blokkIgazitas(editor);
  return (
    <div
      role="group"
      aria-label="Igazítás"
      className="flex flex-wrap items-center gap-1 border-b border-dusk-100 px-2 py-2"
    >
      {IGAZITAS_GOMBOK.map(({ ertek, cimke }) => (
        <button
          key={cimke}
          type="button"
          aria-pressed={most === ertek}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            // a nem kijelolt tipusra a parancs nem tesz semmit, a masik igen
            editor
              .chain()
              .focus()
              .updateAttributes("paragraph", { align: ertek })
              .updateAttributes("heading", { align: ertek })
              .run();
            onClose();
          }}
          className={cn(
            "rounded-md px-2 py-1 text-xs text-dusk-700 hover:bg-dusk-100",
            most === ertek && "bg-brand-50 text-brand-700",
          )}
        >
          {cimke}
        </button>
      ))}
    </div>
  );
}

/** A kurzor bekezdese, ha gomb (`data-cta`): a felirata es a link celja. */
function ctaBekezdes(editor: Editor): { felirat: string; cel: string } | null {
  const { $from } = editor.state.selection;
  const blokk = $from.parent;
  if (blokk.type.name !== "paragraph" || !blokk.attrs.cta) return null;
  let cel = "";
  blokk.forEach((gyerek) => {
    const link = gyerek.marks.find((mark) => mark.type.name === "link");
    if (!cel && link) cel = (link.attrs.href as string | undefined) ?? "";
  });
  return { felirat: blokk.textContent, cel };
}

/**
 * A GOMB (CTA) PANELJE. A gomb egy SAJAT SORBAN allo bekezdes, benne pontosan
 * EGY link, csak szoveggel (`<p data-cta="" data-align="center"><a href>`): a
 * panel ezt az alakot allitja elo, es a meglevo gombot is ebben az alakban
 * irja at. A cel ugyanazon a szabalyon dol el, mint a linke
 * (`isAllowedRichHref`), a link-valtozok kulon felkinalva.
 */
function CtaPanel(props: {
  editor: Editor;
  linkValtozok: readonly RichTextVariable[];
  onClose: () => void;
}) {
  const { editor, linkValtozok, onClose } = props;
  const meglevo = ctaBekezdes(editor);
  const [felirat, setFelirat] = useState(meglevo?.felirat ?? "");
  const [cel, setCel] = useState(
    meglevo?.cel ?? (linkValtozok[0] ? `{{${linkValtozok[0].name}}}` : ""),
  );
  const ervenyes =
    felirat.trim() !== "" &&
    isAllowedRichHref(cel, {
      hrefPlaceholders: linkValtozok.map((v) => v.name),
    });
  const alkalmaz = () => {
    if (!ervenyes) return;
    const szoveg = felirat.trim();
    if (meglevo) {
      editor
        .chain()
        .focus()
        .command(({ tr, state }) => {
          const { $from } = state.selection;
          const link = state.schema.marks.link!.create({ href: cel });
          tr.replaceWith(
            $from.start(),
            $from.end(),
            state.schema.text(szoveg, [link]),
          );
          return true;
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "paragraph",
          attrs: { cta: true, align: "center" },
          content: [
            {
              type: "text",
              text: szoveg,
              marks: [{ type: "link", attrs: { href: cel } }],
            },
          ],
        })
        .run();
    }
    onClose();
  };
  return (
    <div
      role="group"
      aria-label="Gomb"
      className="flex flex-wrap items-center gap-2 border-b border-dusk-100 px-2 py-2"
    >
      <input
        aria-label="Gomb felirata"
        value={felirat}
        placeholder="Számla megnyitása"
        onChange={(event) => setFelirat(event.target.value)}
        className="min-w-40 flex-1 rounded-md border border-dusk-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
      />
      <input
        aria-label="Gomb célja"
        value={cel}
        placeholder="https://"
        onChange={(event) => setCel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            alkalmaz();
          }
        }}
        className="min-w-40 flex-1 rounded-md border border-dusk-200 px-2 py-1 text-sm outline-none focus:border-brand-500"
      />
      {linkValtozok.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => setCel(`{{${v.name}}}`)}
          className="rounded-md bg-dusk-50 px-2 py-1 font-mono text-xs text-dusk-700 hover:bg-dusk-100"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
      <button
        type="button"
        onClick={alkalmaz}
        disabled={!ervenyes}
        className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
      >
        {meglevo ? "Gomb módosítása" : "Gomb beszúrása"}
      </button>
      {meglevo ? (
        <button
          type="button"
          onClick={() => {
            // a gombbol sima bekezdes lesz; a felirat es a link megmarad
            editor
              .chain()
              .focus()
              .updateAttributes("paragraph", { cta: false })
              .run();
            onClose();
          }}
          className="rounded-md px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
        >
          Gomb megszüntetése
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-2 py-1 text-xs text-dusk-600 hover:bg-dusk-100"
      >
        Mégse
      </button>
      {!ervenyes && felirat.trim() !== "" && cel ? (
        <p className="w-full text-xs text-rose-600">
          Csak http(s), mailto vagy link-változó lehet a cél.
        </p>
      ) : null}
    </div>
  );
}

type BlokkTipus = "p" | "h2" | "h3";

function BlokkValaszto(props: { editor: Editor; ertek: BlokkTipus }) {
  const { editor, ertek } = props;
  return (
    <select
      aria-label="Bekezdés típusa"
      value={ertek}
      onChange={(event) => {
        const uj = event.target.value as BlokkTipus;
        /*
          AZ IGAZITAS ATMEGY AZ UJ BLOKKRA, es ezt nem mi csinaljuk: a TipTap
          `setNode`-ja (3.31.3) a blokk sajat attributumait masolja, ha a
          kijeloles egy blokkon belul all. Merve: a kulon atadott `align`
          nelkul is megmaradt; `align: null`-lal elveszett.
        */
        const lanc = editor.chain().focus();
        (uj === "p"
          ? lanc.setParagraph()
          : lanc.setHeading({ level: uj === "h2" ? 2 : 3 })
        ).run();
      }}
      className="rounded-md bg-transparent px-2 py-1 text-sm text-dusk-700 outline-none hover:bg-dusk-100"
    >
      <option value="p">Bekezdés</option>
      <option value="h2">Címsor</option>
      <option value="h3">Alcím</option>
    </select>
  );
}

export function RichTextEditor({
  value,
  onChange,
  variables = [],
  toolbar = ALAP_ESZKOZTAR,
  className,
  ref,
  onImageRequest,
  resolveImageSrc,
  ...props
}: RichTextEditorProps) {
  /*
    A KEP-FELOLDO REF-BEN, mint az `onChange`: a csomopont-nezet a
    szerkesztovel egyutt jon letre, es a kesobb erkezo cimeket csak igy latja.
  */
  const feloldRef = useRef(resolveImageSrc);
  const linkValtozok = useMemo(
    () => variables.filter((v) => v.kind === "link"),
    [variables],
  );
  /*
    A BOVITMENY-LISTA A VALTOZOK NEVEITOL FUGG. A kulcs a nevek osszefuzese,
    nem a tomb azonossaga: a hivo minden renderben uj tombot adhat, es attol a
    szerkeszto ujra letrejonne, a kurzor pedig elveszne.
  */
  const kulcs = variables.map((v) => `${v.name}:${v.kind ?? ""}`).join("|");
  const extensions = useMemo(
    () =>
      bovitmenyek(
        variables,
        linkValtozok.map((v) => v.name),
        feloldRef,
      ),
    [kulcs],
  );

  /*
    A LEGFRISSEBB `onChange` EGY REF-BEN. A szerkeszto csak a bovitmenyek
    valtozasakor jon letre ujra, tehat az `onUpdate` az ELSO renderben latott
    fuggvenyt tartana meg -- egy kesobb csereolt hivo a regi allapotba irna.
  */
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor(
    {
      extensions,
      content: value,
      /*
        NEXT.JS ALATT A SZERVER NEM RENDEREL SZERKESZTOT: a ProseMirror DOM-ot
        kell hogy lasson. Enelkul a hidratalas elter, es a React figyelmeztet.
      */
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": props["aria-label"],
          role: "textbox",
          "aria-multiline": "true",
          class:
            "min-h-48 px-3 py-2 text-sm text-dusk-900 outline-none [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:text-brand-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-dusk-200 [&_blockquote]:pl-3 [&_[data-variable]]:rounded [&_[data-variable]]:bg-brand-50 [&_[data-variable]]:px-1 [&_[data-variable]]:font-mono [&_[data-variable]]:text-xs [&_[data-variable]]:text-brand-700 [&_[data-align=center]]:text-center [&_[data-align=right]]:text-right [&_p[data-cta]]:my-4 [&_p[data-cta]_a]:inline-block [&_p[data-cta]_a]:rounded-[7px] [&_p[data-cta]_a]:bg-[#0b7a6e] [&_p[data-cta]_a]:px-6 [&_p[data-cta]_a]:py-3 [&_p[data-cta]_a]:font-semibold [&_p[data-cta]_a]:text-white [&_p[data-cta]_a]:no-underline",
        },
      },
      onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
    },
    [extensions],
  );

  /*
    KIVULROL JOVO ERTEK (betoltes, esemeny-valtas, alapertelmezes vissza-
    toltese). Csak akkor irjuk be, ha TENYLEG mas, mint ami a szerkesztoben all
    -- kulonben minden gepelesnel visszairnank a sajat kimenetet, es a kurzor
    a szoveg elejere ugrana.
  */
  useEffect(() => {
    if (editor && value !== editor.getHTML())
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  /*
    A KEPEK CIME KESOBB ERKEZIK, MINT A TARTALOM (a hivo betolti oket). A mar
    kirajzolt kepek ezert itt kapjak meg: a csomopont-nezet a `data-src`-ben
    orzi a hivatkozast, ebbol keressuk ki a cimet.
  */
  useEffect(() => {
    feloldRef.current = resolveImageSrc;
    if (!editor || !resolveImageSrc) return;
    editor.view.dom
      .querySelectorAll<HTMLImageElement>("img[data-src]")
      .forEach((img) => {
        const cim = resolveImageSrc(img.dataset.src ?? "");
        if (cim && img.src !== cim) img.src = cim;
      });
  }, [editor, resolveImageSrc]);

  useImperativeHandle(
    ref,
    () => ({
      insertVariable(name: string) {
        if (!editor || !variables.some((v) => v.name === name)) return;
        editor
          .chain()
          .focus()
          .insertContent({ type: "templateVariable", attrs: { name } })
          .run();
      },
      insertImage(image: RichTextImage) {
        if (!editor || !richImageId(image.src)) return;
        const width =
          image.width && image.width >= 1
            ? Math.min(Math.round(image.width), RICH_TEXT_IMAGE_MAX_WIDTH)
            : null;
        editor
          .chain()
          .focus()
          .insertContent({
            type: "templateImage",
            attrs: { src: image.src, alt: image.alt?.trim() || null, width },
          })
          .run();
      },
      focus() {
        editor?.commands.focus();
      },
    }),
    [editor, variables],
  );

  const allapot = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      link: e?.isActive("link") ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      image: e?.isActive("templateImage") ?? false,
      align: e ? blokkIgazitas(e) !== null : false,
      cta: e?.isActive("paragraph", { cta: true }) ?? false,
      undo: false,
      redo: false,
      blockType: false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
      tipus: (e?.isActive("heading", { level: 2 })
        ? "h2"
        : e?.isActive("heading", { level: 3 })
          ? "h3"
          : "p") as BlokkTipus,
    }),
  });
  /* EGYSZERRE EGY PANEL: a link, az igazitas vagy a gomb. */
  const [panel, setPanel] = useState<"link" | "align" | "cta" | null>(null);
  const valt = (nev: "link" | "align" | "cta") =>
    setPanel((nyitva) => (nyitva === nev ? null : nev));

  const gombok: Record<
    Exclude<RichTextToolbarItem, "blockType">,
    {
      cimke: string;
      jel: string;
      futtat: (e: Editor) => void;
      tiltott?: boolean;
    }
  > = {
    bold: {
      cimke: "Félkövér",
      jel: "B",
      futtat: (e) => e.chain().focus().toggleBold().run(),
    },
    italic: {
      cimke: "Dőlt",
      jel: "I",
      futtat: (e) => e.chain().focus().toggleItalic().run(),
    },
    underline: {
      cimke: "Aláhúzott",
      jel: "U",
      futtat: (e) => e.chain().focus().toggleUnderline().run(),
    },
    undo: {
      cimke: "Visszavonás",
      jel: "↶",
      futtat: (e) => e.chain().focus().undo().run(),
      tiltott: !allapot?.canUndo,
    },
    redo: {
      cimke: "Újra",
      jel: "↷",
      futtat: (e) => e.chain().focus().redo().run(),
      tiltott: !allapot?.canRedo,
    },
    link: {
      cimke: "Link",
      jel: "🔗",
      futtat: () => valt("link"),
    },
    align: {
      cimke: "Igazítás",
      jel: "↔",
      futtat: () => valt("align"),
    },
    cta: {
      cimke: "Gomb (CTA)",
      jel: "CTA",
      futtat: () => valt("cta"),
    },
    bulletList: {
      cimke: "Felsorolás",
      jel: "•",
      futtat: (e) => e.chain().focus().toggleBulletList().run(),
    },
    orderedList: {
      cimke: "Számozott lista",
      jel: "1.",
      futtat: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    image: {
      cimke: "Kép beszúrása",
      jel: "🖼",
      futtat: () => onImageRequest?.(),
    },
  };
  /* A KEP GOMB CSAK AKKOR ALL OTT, HA VAN, AKI KEPET AD. */
  const lathato = toolbar.filter(
    (elem) => elem !== "image" || onImageRequest !== undefined,
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-dusk-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15",
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label="Formázás"
        className="flex flex-wrap gap-1 border-b border-dusk-100 px-2 py-1"
      >
        {lathato.map((elem) =>
          elem === "blockType" ? (
            editor ? (
              <BlokkValaszto
                key={elem}
                editor={editor}
                ertek={allapot?.tipus ?? "p"}
              />
            ) : null
          ) : (
            <EszkozGomb
              key={elem}
              cimke={gombok[elem].cimke}
              aktiv={allapot?.[elem] ?? false}
              tiltott={gombok[elem].tiltott}
              onClick={() => editor && gombok[elem].futtat(editor)}
            >
              {gombok[elem].jel}
            </EszkozGomb>
          ),
        )}
      </div>
      {panel === "link" && editor ? (
        <LinkSzerkeszto
          editor={editor}
          linkValtozok={linkValtozok}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "align" && editor ? (
        <IgazitasPanel editor={editor} onClose={() => setPanel(null)} />
      ) : null}
      {panel === "cta" && editor ? (
        <CtaPanel
          editor={editor}
          linkValtozok={linkValtozok}
          onClose={() => setPanel(null)}
        />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
