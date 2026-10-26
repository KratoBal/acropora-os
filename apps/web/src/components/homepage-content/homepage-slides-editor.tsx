"use client";

import { PilotBadge, PilotButton, PilotCallout } from "@acropora/ui";
import {
  HOMEPAGE_LIMITS,
  isShopHref,
  normalizeShopHref,
  SHOP_HREF_RULE,
  type HomepageSlide,
} from "@acropora/types";
import { RichTextEditor, SHORT_TOOLBAR } from "@acropora/ui/rich-text-editor";
import { useState } from "react";

import {
  HOMEPAGE_INPUT_CLASS,
  ImageUpload,
  type ImageUploadControl,
} from "./homepage-fields";

export const emptySlide = (): HomepageSlide => ({
  eyebrow: "",
  title: "",
  text: "",
  cta: "",
  ctaHref: null,
  cta2: "",
  cta2Href: null,
  caption: "",
  caption2: "",
  imageUrl: null,
  imageAlt: "",
});

/**
 * THE STOREFRONT'S OWN THREE STARTING SLIDES (acropora-commerce 913e882,
 * `modules/kezdolap/tartalom.ts`, `ALAP_DIAK`): felirat and főcím. NOT the
 * Figma frame's demo text (brief, 7. pont). When the storefront changes them,
 * this list follows in the next change, like `HOMEPAGE_TEXT_FIELDS`.
 */
const ALAP_DIAK = [
  [
    "A zátonyod darabjait egyenként válogatjuk.",
    "Tengeri akvarisztikai szaküzlet · Budapest",
  ],
  ["Új korallok kerültek a medencékbe.", "Friss érkezés · minden pénteken"],
  ["Megtervezzük és beüzemeljük az akváriumodat.", "Tervezés és telepítés"],
] as const;

/**
 * THE HERO SLIDES (Figma 685:535, "Fejléc diák"; brief 4. pont). "Alap diák":
 * the storefront's three starting slides, labelled as a sample, saved as `null`.
 * "Saját diák": your list, at most five, in the order shown (drag a card by its
 * handle, or use the arrow keys on it); an empty list means no hero at all.
 */
export function HomepageSlidesEditor({
  own,
  slides,
  onOwnChange,
  onSlidesChange,
  upload,
  shopHosts = [],
}: {
  own: boolean;
  slides: readonly HomepageSlide[];
  onOwnChange: (own: boolean) => void;
  onSlidesChange: (slides: HomepageSlide[]) => void;
  upload: ImageUploadControl;
  /** The shop's own hosts: a full address on them becomes its path. */
  shopHosts?: readonly string[];
}) {
  const [open, setOpen] = useState<number | null>(0);
  const [dragged, setDragged] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= slides.length || from === to) return;
    const list = [...slides];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved as HomepageSlide);
    onSlidesChange(list);
    setOpen(to);
  };
  const tab = (value: boolean, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={own === value}
      onClick={() => onOwnChange(value)}
      className={`flex-1 rounded-md px-4 py-2.5 text-left text-sm font-semibold ${
        own === value
          ? "bg-pilot-aqua-50 text-pilot-aqua-700"
          : "bg-pilot-grey-100 text-pilot-grey-600"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Diák forrása" className="flex gap-2">
        {tab(false, "Alap diák")}
        {tab(true, "Saját diák")}
      </div>
      {!own ? (
        <>
          <p className="text-sm text-pilot-grey-600">
            A kirakat alapértelmezett három diaeleme.
          </p>
          <ol className="space-y-3">
            {ALAP_DIAK.map(([cim, alcim], i) => (
              <li
                key={cim}
                className="flex items-center gap-4 rounded-lg bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200"
              >
                <span className="text-2xl font-semibold text-pilot-aqua-700">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-pilot-grey-900">
                    {cim}
                  </span>
                  <span className="block text-xs text-pilot-grey-500">
                    {alcim}
                  </span>
                </span>
                <PilotBadge variant="amber">Minta adat</PilotBadge>
              </li>
            ))}
          </ol>
          <PilotCallout
            tone="aqua"
            title="Az Alap diák a kirakat mintatartalmát használják."
            description="Válts a Saját diák fülre egyéni tartalomhoz."
          />
        </>
      ) : (
        <>
          <p className="text-sm text-pilot-grey-600">
            Legfeljebb {HOMEPAGE_LIMITS.slides} dia. A sorrend húzással
            módosítható.
          </p>
          {slides.length === 0 ? (
            <PilotCallout
              tone="warm"
              title="Nincs saját dia"
              description="Mentés után a kirakat kezdőlapján nem jelenik meg fejléc-csúszka."
            />
          ) : null}
          <ol className="space-y-3">
            {slides.map((slide, index) => (
              <li
                key={index}
                onDragOver={(event) => {
                  if (dragged !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged !== null) move(dragged, index);
                  setDragged(null);
                }}
                className="rounded-lg bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragged(index)}
                    onDragEnd={() => setDragged(null)}
                    aria-label={`${index + 1}. dia áthelyezése (fel és le nyíl)`}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        move(index, index - 1);
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        move(index, index + 1);
                      }
                    }}
                    className="cursor-grab px-1 text-pilot-grey-400"
                  >
                    ⋮⋮
                  </button>
                  <button
                    type="button"
                    aria-expanded={open === index}
                    onClick={() => setOpen(open === index ? null : index)}
                    className="flex-1 text-left text-sm font-semibold text-pilot-grey-900"
                  >
                    {index + 1}. dia {slide.title ? `· ${slide.title}` : ""}
                  </button>
                </div>
                {open === index ? (
                  <SlideFields
                    index={index}
                    slide={slide}
                    upload={upload}
                    shopHosts={shopHosts}
                    onChange={(patch) =>
                      onSlidesChange(
                        slides.map((s, i) =>
                          i === index ? { ...s, ...patch } : s,
                        ),
                      )
                    }
                  />
                ) : null}
                <div className="mt-3 flex justify-end">
                  <PilotButton
                    variant="secondary"

                    onClick={() =>
                      onSlidesChange(slides.filter((_, i) => i !== index))
                    }
                  >
                    Dia törlése
                  </PilotButton>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-3">
            <PilotButton
              variant="secondary"
              disabled={slides.length >= HOMEPAGE_LIMITS.slides}
              onClick={() => {
                onSlidesChange([...slides, emptySlide()]);
                setOpen(slides.length);
              }}
            >
              Dia hozzáadása
            </PilotButton>
            {slides.length >= HOMEPAGE_LIMITS.slides ? (
              <span className="text-xs text-pilot-grey-500">
                Legfeljebb {HOMEPAGE_LIMITS.slides} dia
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function SlideFields({
  index,
  slide,
  onChange,
  upload,
  shopHosts,
}: {
  index: number;
  slide: HomepageSlide;
  onChange: (patch: Partial<HomepageSlide>) => void;
  upload: ImageUploadControl;
  shopHosts: readonly string[];
}) {
  const n = index + 1;
  const field = (
    label: string,
    key: keyof HomepageSlide,
    max: number,
    options: { long?: boolean; address?: boolean; button?: boolean } = {},
  ) => (
    <label className={`block ${options.long ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-pilot-grey-700">
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
      {options.long ? (
        /*
          A DIA SZÖVEGE FORMÁZOTT (2b-3; commerce #571): a rövid profil, amit a
          kirakat a dián kirajzol. Üres szerkesztő üres szöveget ment.
        */
        <RichTextEditor
          profile="short"
          toolbar={SHORT_TOOLBAR}
          aria-label={`${n}. dia: ${label}`}
          value={((slide[key] as string | null) ?? "") || "<p></p>"}
          onChange={(html) =>
            onChange({ [key]: html === "<p></p>" ? "" : html })
          }
        />
      ) : (
        <input
          aria-label={`${n}. dia: ${label}`}
          value={(slide[key] as string | null) ?? ""}
          maxLength={max}
          aria-invalid={
            options.button && !isShopHref((slide[key] as string | null) ?? "")
              ? true
              : undefined
          }
          onChange={(event) =>
            onChange({
              [key]: options.address
                ? event.target.value || null
                : event.target.value,
            })
          }
          /*
            A GOMB CÉLJA A MEZŐ ELHAGYÁSAKOR áll a bolt alakjára (acrobot
            36371): a bolt saját címe az útvonalára, a perjel nélküli útvonal
            perjelet kap. Gépelés közben nem nyúl hozzá.
          */
          onBlur={
            options.button
              ? (event) => {
                  const next = normalizeShopHref(event.target.value, shopHosts);
                  if (next !== event.target.value)
                    onChange({ [key]: next || null });
                }
              : undefined
          }
          className={HOMEPAGE_INPUT_CLASS}
        />
      )}
      {options.button && !isShopHref((slide[key] as string | null) ?? "") ? (
        <span role="alert" className="mt-1 block text-xs text-red-700">
          {`${n}. dia, ${label}: ${SHOP_HREF_RULE}`}
        </span>
      ) : null}
    </label>
  );
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg bg-white p-4 ring-1 ring-pilot-grey-200">
        {slide.imageUrl ? (
          <img
            src={slide.imageUrl}
            alt=""
            className="mb-2 h-24 w-40 rounded object-cover"
          />
        ) : null}
        <p className="text-sm font-semibold text-pilot-grey-900">
          {slide.imageUrl ? "Kép cseréje" : "Kép feltöltése"}
        </p>
        <ImageUpload
          label={`${n}. dia: kép feltöltése`}
          control={upload}
          onUploaded={(url) => onChange({ imageUrl: url })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("kép leírása", "imageAlt", HOMEPAGE_LIMITS.imageAlt)}
        {field("felirat", "eyebrow", HOMEPAGE_LIMITS.eyebrow)}
        {field("főcím", "title", HOMEPAGE_LIMITS.title)}
        {field("szöveg", "text", HOMEPAGE_LIMITS.slideText, { long: true })}
        {field("első gomb felirata", "cta", HOMEPAGE_LIMITS.button)}
        {field("első gomb célja", "ctaHref", HOMEPAGE_LIMITS.href, {
          address: true,
          button: true,
        })}
        {field("második gomb felirata", "cta2", HOMEPAGE_LIMITS.button)}
        {field("második gomb célja", "cta2Href", HOMEPAGE_LIMITS.href, {
          address: true,
          button: true,
        })}
        {field("képaláírás", "caption", HOMEPAGE_LIMITS.caption)}
        {field("képaláírás, második sor", "caption2", HOMEPAGE_LIMITS.caption)}
        {field("kép címe", "imageUrl", HOMEPAGE_LIMITS.address, {
          address: true,
        })}
      </div>
    </div>
  );
}
