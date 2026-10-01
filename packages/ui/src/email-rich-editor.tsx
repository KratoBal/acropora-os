"use client";

/**
 * A LEVEL SZERKESZTOJE: VIZUALIS ES HTML MOD (Figma 358:829 szeles, 358:1143
 * keskeny). Ugyanaz a komponens all a Levelezes oldalon es a szamlakuldes
 * draweren: Balazs jovahagyasa 2026-09-30 21:26 UTC (acrobot 25372).
 *
 * === A HTML MOD A TISZTITON AT MEGY VISSZA ===
 *
 * A nyers HTML-t minden valtozasnal ugyanaz a fuggveny tisztitja, amelyik a
 * szerveren is fut (`sanitizeRichHtmlReport`, nautilus #1309). Az `onChange`
 * mindig a TISZTA alakot kapja, tehat a mentes HTML modban is azt viszi, amit a
 * szerver tarolna. Ami a semaba nem fer (tablazat, `style`, idegen kep), az
 * elveszik, es a felulet MEGNEVEZI, nem csendben nyeli el.
 *
 * A szovegdoboz a felhasznalo sajat szovegét mutatja, amig gepel: ha minden
 * billentyure a tisztitott alakot irnank vissza, a felig beirt cimke (`<p`)
 * eltunne a keze alol.
 *
 * === A KEPEK ES A VALTOZOK HTML MODBAN IS BESZURHATOK ===
 *
 * A kezelo (`insertVariable`, `insertImage`) HTML modban a szovegdoboz
 * kurzorahoz irja a jelolest, ugyanabban az alakban, amit a vizualis szerkeszto
 * adna: a valtozo-atom es a sajat hivatkozasu kep.
 */
import { richImageId, sanitizeRichHtmlReport } from "@acropora/rich-text";
import {
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";

import {
  EMAIL_TOOLBAR,
  RichTextEditor,
  type RichTextEditorHandle,
  type RichTextEditorProps,
  type RichTextImage,
} from "./rich-text-editor";
import { cn } from "./utils";

export type EmailRichEditorHandle = RichTextEditorHandle;

export interface EmailRichEditorProps extends Omit<
  RichTextEditorProps,
  "ref" | "toolbar"
> {
  readonly toolbar?: RichTextEditorProps["toolbar"];
  readonly ref?: Ref<EmailRichEditorHandle>;
}

type Mod = "visual" | "html";

const escapeAttr = (ertek: string) =>
  ertek.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function EmailRichEditor({
  value,
  onChange,
  variables = [],
  toolbar = EMAIL_TOOLBAR,
  className,
  ref,
  ...props
}: EmailRichEditorProps) {
  const [mod, setMod] = useState<Mod>("visual");
  const [nyers, setNyers] = useState("");
  const [kiesett, setKiesett] = useState<readonly string[]>([]);
  const szerkesztoRef = useRef<RichTextEditorHandle | null>(null);
  const dobozRef = useRef<HTMLTextAreaElement | null>(null);
  const helyorzok = useMemo(
    () => variables.filter((v) => v.kind === "link").map((v) => v.name),
    [variables],
  );

  const nyersValtozik = (szoveg: string) => {
    setNyers(szoveg);
    const jelentes = sanitizeRichHtmlReport(szoveg, {
      hrefPlaceholders: helyorzok,
    });
    setKiesett(jelentes.removed);
    onChange(jelentes.html);
  };

  /** HTML modban a jeloles a szovegdoboz kurzorahoz kerul. */
  const beirNyersbe = (jeloles: string) => {
    const doboz = dobozRef.current;
    const eleje = doboz?.selectionStart ?? nyers.length;
    const vege = doboz?.selectionEnd ?? nyers.length;
    nyersValtozik(nyers.slice(0, eleje) + jeloles + nyers.slice(vege));
  };

  useImperativeHandle(
    ref,
    () => ({
      insertVariable(name: string) {
        if (mod === "visual") {
          szerkesztoRef.current?.insertVariable(name);
          return;
        }
        if (!variables.some((v) => v.name === name)) return;
        beirNyersbe(`<span data-variable="${name}">{{${name}}}</span>`);
      },
      insertImage(image: RichTextImage) {
        if (mod === "visual") {
          szerkesztoRef.current?.insertImage(image);
          return;
        }
        if (!richImageId(image.src)) return;
        const alt = image.alt?.trim() ? ` alt="${escapeAttr(image.alt)}"` : "";
        const width = image.width ? ` width="${Math.round(image.width)}"` : "";
        beirNyersbe(`<img src="${escapeAttr(image.src)}"${alt}${width}>`);
      },
      focus() {
        if (mod === "visual") szerkesztoRef.current?.focus();
        else dobozRef.current?.focus();
      },
    }),
    [mod, nyers, variables, helyorzok],
  );

  const valt = (uj: Mod) => {
    if (uj === mod) return;
    if (uj === "html") {
      setNyers(value);
      setKiesett([]);
    }
    setMod(uj);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Szerkesztés módja" className="flex">
          {(
            [
              ["visual", "Vizuális"],
              ["html", "HTML"],
            ] as const
          ).map(([kulcs, cimke]) => (
            <button
              key={kulcs}
              type="button"
              role="tab"
              aria-selected={mod === kulcs}
              onClick={() => valt(kulcs)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-dusk-700 transition hover:bg-dusk-100",
                mod === kulcs && "bg-brand-50 font-medium text-brand-700",
              )}
            >
              {cimke}
            </button>
          ))}
        </div>
        <span className="text-xs text-dusk-500">
          Tisztított, e-mail-biztos HTML
        </span>
      </div>
      {mod === "visual" ? (
        <RichTextEditor
          {...props}
          ref={szerkesztoRef}
          value={value}
          onChange={(html) => {
            setKiesett([]);
            onChange(html);
          }}
          variables={variables}
          toolbar={toolbar}
        />
      ) : (
        <textarea
          ref={dobozRef}
          aria-label={`${props["aria-label"]} (HTML)`}
          value={nyers}
          spellCheck={false}
          onChange={(event) => nyersValtozik(event.target.value)}
          className="min-h-48 w-full rounded-lg border border-dusk-200 bg-white px-3 py-2 font-mono text-xs text-dusk-900 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
        />
      )}
      {kiesett.length ? (
        <p role="status" className="text-xs text-amber-700">
          Levélben nem marad meg, ezért kimarad: {kiesett.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
