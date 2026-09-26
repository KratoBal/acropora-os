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
  RICH_TEXT_VARIABLE_NAME,
} from "@acropora/rich-text";
import {
  EditorContent,
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
  /** `"link"`: link celjakent is beilleszheto. */
  readonly kind?: "link";
}

export type RichTextToolbarItem =
  "bold" | "italic" | "underline" | "link" | "bulletList" | "orderedList";

export interface RichTextEditorHandle {
  /** A valtozot atomkent a kurzor helyere teszi. Ismeretlen nevre nem tesz semmit. */
  insertVariable(name: string): void;
  focus(): void;
}

export interface RichTextEditorProps {
  /** A `RICH_TEXT_ALLOWED_TAGS` szerinti HTML. */
  readonly value: string;
  readonly onChange: (html: string) => void;
  /** Hianyaban nincs valtozo-atom: altalanos szovegszerkeszto. */
  readonly variables?: readonly RichTextVariable[];
  readonly toolbar?: readonly RichTextToolbarItem[];
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

function bovitmenyek(
  variables: readonly RichTextVariable[],
  linkValtozok: readonly string[],
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
  ];
}

function EszkozGomb(props: {
  cimke: string;
  aktiv: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.cimke}
      title={props.cimke}
      aria-pressed={props.aktiv}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
      className={cn(
        "min-w-8 rounded-md px-2 py-1 text-sm text-dusk-700 transition hover:bg-dusk-100",
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

export function RichTextEditor({
  value,
  onChange,
  variables = [],
  toolbar = ALAP_ESZKOZTAR,
  className,
  ref,
  ...props
}: RichTextEditorProps) {
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
            "min-h-48 px-3 py-2 text-sm text-dusk-900 outline-none [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:text-brand-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-dusk-200 [&_blockquote]:pl-3 [&_[data-variable]]:rounded [&_[data-variable]]:bg-brand-50 [&_[data-variable]]:px-1 [&_[data-variable]]:font-mono [&_[data-variable]]:text-xs [&_[data-variable]]:text-brand-700",
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
    }),
  });
  const [linkNyitva, setLinkNyitva] = useState(false);

  const gombok: Record<
    RichTextToolbarItem,
    { cimke: string; jel: string; futtat: (e: Editor) => void }
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
    link: {
      cimke: "Link",
      jel: "🔗",
      futtat: () => setLinkNyitva((nyitva) => !nyitva),
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
  };

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
        {toolbar.map((elem) => (
          <EszkozGomb
            key={elem}
            cimke={gombok[elem].cimke}
            aktiv={allapot?.[elem] ?? false}
            onClick={() => editor && gombok[elem].futtat(editor)}
          >
            {gombok[elem].jel}
          </EszkozGomb>
        ))}
      </div>
      {linkNyitva && editor ? (
        <LinkSzerkeszto
          editor={editor}
          linkValtozok={linkValtozok}
          onClose={() => setLinkNyitva(false)}
        />
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
