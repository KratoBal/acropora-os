"use client";

import {
  HOMEPAGE_LIMITS,
  HOMEPAGE_NEWSLETTER_DEFAULT,
  type HomepageNewsletter,
} from "@acropora/types";

import { HOMEPAGE_INPUT_CLASS, Kapcsolo } from "./homepage-fields";

/**
 * THE NEWSLETTER ROW (Balázs, 2026-10-27, kirakat-lablec-kep): above the
 * footer on every page, switched on or off like the other blocks, its texts
 * editable. `null` is "not set": the storefront shows its own row, which is
 * the same as `HOMEPAGE_NEWSLETTER_DEFAULT`; the first edit makes it the OS's.
 *
 * NOT EDITED HERE, and said on the screen: the name and e-mail fields and the
 * privacy notice's link next to the consent text.
 */
export function HomepageNewsletterEditor({
  newsletter,
  onChange,
}: {
  newsletter: HomepageNewsletter | null;
  onChange: (newsletter: HomepageNewsletter) => void;
}) {
  const row = newsletter ?? HOMEPAGE_NEWSLETTER_DEFAULT;
  const set = (patch: Partial<HomepageNewsletter>) =>
    onChange({ ...row, ...patch });
  const field = (
    label: string,
    key: "title" | "text" | "consentText" | "button",
    max: number,
    multiline = false,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-pilot-grey-700">
        {label}
      </span>
      {multiline ? (
        <textarea
          aria-label={`Hírlevél: ${label}`}
          value={row[key]}
          maxLength={max}
          rows={3}
          onChange={(event) => set({ [key]: event.target.value })}
          className={HOMEPAGE_INPUT_CLASS}
        />
      ) : (
        <input
          aria-label={`Hírlevél: ${label}`}
          value={row[key]}
          maxLength={max}
          onChange={(event) => set({ [key]: event.target.value })}
          className={HOMEPAGE_INPUT_CLASS}
        />
      )}
    </label>
  );
  return (
    <div className="space-y-4">
      <span className="flex items-center gap-2 text-xs text-pilot-grey-600">
        Látszik
        <Kapcsolo
          label="Hírlevél: látszik (szerkesztő)"
          checked={row.enabled}
          onChange={(enabled) => set({ enabled })}
        />
      </span>
      {field("Cím", "title", HOMEPAGE_LIMITS.newsletterTitle)}
      {field("Szöveg", "text", HOMEPAGE_LIMITS.newsletterText, true)}
      {field(
        "Hozzájárulás szövege",
        "consentText",
        HOMEPAGE_LIMITS.newsletterConsent,
        true,
      )}
      {field("Gomb felirata", "button", HOMEPAGE_LIMITS.newsletterButton)}
      <p className="rounded-md bg-pilot-grey-50 px-3 py-2 text-xs text-pilot-grey-500 ring-1 ring-pilot-grey-200">
        A név- és az e-mail-mező, valamint az Adatkezelési tájékoztató linkje a
        hozzájárulás mellett rögzített. A feliratkozás a teszt webshop saját
        listájába kerül, levél nem megy ki; a hozzájárulás szövegét a
        feliratkozással együtt rögzíti.
      </p>
    </div>
  );
}
