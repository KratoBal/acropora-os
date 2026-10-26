"use client";

import { PilotButton, PilotCallout } from "@acropora/ui";
import { HOMEPAGE_LIMITS, type HomepageFooter } from "@acropora/types";
import { RichTextEditor, SHORT_TOOLBAR } from "@acropora/ui/rich-text-editor";

import { HOMEPAGE_INPUT_CLASS } from "./homepage-fields";

export const emptyFooter = (): HomepageFooter => ({
  intro: "",
  columns: [],
  social: { facebook: null, instagram: null, youtube: null },
  bottomText: "",
});

const SOCIAL = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["youtube", "YouTube"],
] as const;

/**
 * THE FOOTER (Balázs's brief, 4. pont, "Lábléc"; Figma 685:535): short intro
 * (the short rich-text profile, #1879), link columns, social links, the legal line.
 *
 * NOT EDITED HERE, on purpose and said on the screen: the legal documents (the
 * storefront always adds them) and the address, opening hours and contact
 * (they come from the "A boltunk" block, so the page never shows two).
 *
 * `null`: the storefront's own footer shows. "Saját lábléc" starts an own one.
 */
export function HomepageFooterEditor({
  footer,
  onChange,
  onOpenBoltunk,
}: {
  footer: HomepageFooter | null;
  onChange: (footer: HomepageFooter | null) => void;
  onOpenBoltunk: () => void;
}) {
  if (!footer)
    return (
      <div className="space-y-4">
        <PilotCallout
          tone="aqua"
          title="A kirakat saját lábléce látszik."
          description="Saját bemutatkozást, link-oszlopokat és közösségi linkeket a saját lábléccel adhatsz meg."
        />
        <PilotButton
          variant="secondary"
          onClick={() => onChange(emptyFooter())}
        >
          Saját lábléc szerkesztése
        </PilotButton>
      </div>
    );
  const set = (patch: Partial<HomepageFooter>) =>
    onChange({ ...footer, ...patch });
  const setColumn = (
    index: number,
    column: HomepageFooter["columns"][number],
  ) =>
    set({ columns: footer.columns.map((c, i) => (i === index ? column : c)) });
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Rövid bemutatkozás
        </h3>
        {/*
          A ROVID PROFIL (#1879): bekezdes, felkover, dolt, link, felsorolas.
          A kirakat lablece pontosan ennyit rajzol ki, tehat amit itt latsz,
          az minden oldalon megjelenik (murena 36080).
        */}
        <RichTextEditor
          profile="short"
          toolbar={SHORT_TOOLBAR}
          aria-label="Lábléc: rövid bemutatkozás"
          value={footer.intro || "<p></p>"}
          onChange={(intro) => set({ intro: intro === "<p></p>" ? "" : intro })}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Link-oszlopok
        </h3>
        {footer.columns.map((column, index) => (
          <div
            key={index}
            className="space-y-2 rounded-lg bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200"
          >
            <div className="flex items-center gap-2">
              <input
                aria-label={`${index + 1}. oszlop címe`}
                placeholder="Oszlop címe"
                value={column.title}
                maxLength={HOMEPAGE_LIMITS.footerLabel}
                onChange={(event) =>
                  setColumn(index, { ...column, title: event.target.value })
                }
                className={HOMEPAGE_INPUT_CLASS}
              />
              <PilotButton
                variant="ghost"

                onClick={() =>
                  set({ columns: footer.columns.filter((_, i) => i !== index) })
                }
              >
                Oszlop törlése
              </PilotButton>
            </div>
            {column.links.map((link, linkIndex) => (
              <div
                key={linkIndex}
                className="grid grid-cols-[1fr_1fr_auto] gap-2"
              >
                <input
                  aria-label={`${index + 1}. oszlop, ${linkIndex + 1}. sor: felirat`}
                  placeholder="Felirat"
                  value={link.label}
                  maxLength={HOMEPAGE_LIMITS.footerLabel}
                  onChange={(event) =>
                    setColumn(index, {
                      ...column,
                      links: column.links.map((l, i) =>
                        i === linkIndex
                          ? { ...l, label: event.target.value }
                          : l,
                      ),
                    })
                  }
                  className={HOMEPAGE_INPUT_CLASS}
                />
                <input
                  aria-label={`${index + 1}. oszlop, ${linkIndex + 1}. sor: cél`}
                  placeholder="/store vagy https://"
                  value={link.href}
                  maxLength={HOMEPAGE_LIMITS.href}
                  onChange={(event) =>
                    setColumn(index, {
                      ...column,
                      links: column.links.map((l, i) =>
                        i === linkIndex
                          ? { ...l, href: event.target.value }
                          : l,
                      ),
                    })
                  }
                  className={HOMEPAGE_INPUT_CLASS}
                />
                <PilotButton
                  variant="ghost"

                  aria-label={`${index + 1}. oszlop, ${linkIndex + 1}. sor törlése`}
                  onClick={() =>
                    setColumn(index, {
                      ...column,
                      links: column.links.filter((_, i) => i !== linkIndex),
                    })
                  }
                >
                  ✕
                </PilotButton>
              </div>
            ))}
            <PilotButton
              variant="secondary"

              disabled={column.links.length >= HOMEPAGE_LIMITS.footerLinks}
              onClick={() =>
                setColumn(index, {
                  ...column,
                  links: [...column.links, { label: "", href: "" }],
                })
              }
            >
              Sor hozzáadása
            </PilotButton>
          </div>
        ))}
        <PilotButton
          variant="secondary"
          disabled={footer.columns.length >= HOMEPAGE_LIMITS.footerColumns}
          onClick={() =>
            set({ columns: [...footer.columns, { title: "", links: [] }] })
          }
        >
          Oszlop hozzáadása
        </PilotButton>
        <p className="rounded-md bg-pilot-grey-50 px-3 py-2 text-xs text-pilot-grey-500 ring-1 ring-pilot-grey-200">
          Jogi dokumentumok (ÁSZF, adatkezelési tájékoztató): automatikusan, a
          kirakat mindig hozzáteszi; itt nem szerkeszthetők.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Elérhetőség és nyitvatartás
        </h3>
        <p className="text-sm text-pilot-grey-600">
          A cím, a nyitvatartás és az elérhetőség az „A boltunk” blokkból jön,
          egy helyen szerkeszthető.
        </p>
        <PilotButton variant="secondary" onClick={onOpenBoltunk}>
          Az „A boltunk” blokk megnyitása
        </PilotButton>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Közösségi oldalak
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {SOCIAL.map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-pilot-grey-700">
                {label}
              </span>
              <input
                aria-label={`Lábléc: ${label}`}
                placeholder="https://"
                value={footer.social[key] ?? ""}
                maxLength={HOMEPAGE_LIMITS.href}
                onChange={(event) =>
                  set({
                    social: {
                      ...footer.social,
                      [key]: event.target.value || null,
                    },
                  })
                }
                className={HOMEPAGE_INPUT_CLASS}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-pilot-grey-900">Jogi sor</h3>
        <input
          aria-label="Lábléc: jogi sor"
          placeholder="© Acropora Kft."
          value={footer.bottomText}
          maxLength={HOMEPAGE_LIMITS.footerBottomText}
          onChange={(event) => set({ bottomText: event.target.value })}
          className={HOMEPAGE_INPUT_CLASS}
        />
      </section>

      <PilotButton variant="ghost" onClick={() => onChange(null)}>
        Vissza a kirakat saját láblécére
      </PilotButton>
    </div>
  );
}
