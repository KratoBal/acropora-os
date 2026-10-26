"use client";

import { PilotBadge } from "@acropora/ui";
import { RichTextEditor, SHORT_TOOLBAR } from "@acropora/ui/rich-text-editor";
import { HOMEPAGE_LIMITS, type HomepageTextField } from "@acropora/types";
import { useState } from "react";

/**
 * THE SHARED PIECES OF THE HOME PAGE ADMIN (Figma 685:535): the "Látszik"
 * switch, one text field with its "Alapérték" / "Visszaállítás" / "Minta adat"
 * state, and the image upload. Colours only from the pilot tokens, so the dark
 * theme follows.
 */

export function Kapcsolo({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-pilot-aqua-600" : "bg-pilot-grey-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

const TYPE_HINT: Record<HomepageTextField["type"], string> = {
  text: "",
  short:
    "Bekezdés, félkövér, dőlt, link és felsorolás: a webshop pontosan ezt mutatja.",
  link: "Webshop-cím (/store) vagy https:// cím; üresen a gomb nem jelenik meg.",
  image: "Kép címe (https://…); üresen szürke hely áll.",
};

const INPUT =
  "w-full rounded-md bg-white px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 outline-none focus:ring-2 focus:ring-pilot-aqua-500";

/**
 * ONE CATALOGUE FIELD. Not edited (`value === null`): the starting value of
 * the design shows, with the grey "Alapérték" tag, and "Minta adat" when that
 * starting value is an invented fact. Edited: the value is the editor's own,
 * even an empty one; "Visszaállítás" puts it back to not edited.
 */
export function TextField({
  field,
  value,
  onChange,
  onReset,
  upload,
}: {
  field: HomepageTextField;
  value: string | null;
  onChange: (value: string) => void;
  onReset: () => void;
  upload: ImageUploadControl;
}) {
  const edited = value !== null;
  const shown = edited ? value : field.default;
  const label = `${field.group}: ${field.label}`;
  const long =
    field.type === "short" ||
    (field.type === "text" &&
      (field.default.length > 70 || field.default.includes("\n")));
  return (
    <div className={long ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-pilot-grey-700">
          {field.label}
        </span>
        {edited ? (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-pilot-aqua-700 underline"
          >
            Visszaállítás
          </button>
        ) : (
          <>
            <PilotBadge variant="grey">Alapérték</PilotBadge>
            {field.sample ? (
              <PilotBadge variant="amber">Minta adat</PilotBadge>
            ) : null}
          </>
        )}
      </div>
      {field.type === "short" ? (
        /*
          A RÖVID PROFIL (2b-3; commerce #571): a kirakat ezen a helyen pontosan
          ennyit rajzol ki. Üres szerkesztő üres értéket ment, nem "<p></p>"-t.
        */
        <RichTextEditor
          profile="short"
          toolbar={SHORT_TOOLBAR}
          aria-label={label}
          value={shown || "<p></p>"}
          onChange={(html) => onChange(html === "<p></p>" ? "" : html)}
        />
      ) : long ? (
        <textarea
          aria-label={label}
          value={shown}
          rows={3}
          maxLength={HOMEPAGE_LIMITS.textValue}
          onChange={(event) => onChange(event.target.value)}
          className={INPUT}
        />
      ) : (
        <input
          aria-label={label}
          value={shown}
          maxLength={HOMEPAGE_LIMITS.textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.type === "image" ? "https://…" : undefined}
          className={INPUT}
        />
      )}
      {TYPE_HINT[field.type] ? (
        <p className="mt-1 text-xs text-pilot-grey-500">
          {TYPE_HINT[field.type]}
        </p>
      ) : null}
      {field.type === "image" ? (
        <ImageUpload
          label={`${label}: feltöltés`}
          control={upload}
          onUploaded={onChange}
        />
      ) : null}
    </div>
  );
}

export { INPUT as HOMEPAGE_INPUT_CLASS };

/**
 * WHO MAY UPLOAD. An upload writes to the shop's file storage, so it needs
 * the shop projection switched on (the server refuses it otherwise, #1721);
 * the control says so instead of offering a button that would fail.
 */
export interface ImageUploadControl {
  readonly allowed: boolean;
  readonly upload: (file: File) => Promise<string | null>;
}

export function ImageUpload({
  label,
  control,
  onUploaded,
}: {
  label: string;
  control: ImageUploadControl;
  onUploaded: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!control.allowed)
    return (
      <p className="mt-1 text-xs text-pilot-grey-500">
        Képfeltöltés csak bekapcsolt webshopba küldésnél.
      </p>
    );
  return (
    <label className="mt-1 block text-xs text-pilot-grey-600">
      {busy ? "Feltöltés..." : "Kép feltöltése"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        disabled={busy}
        className="ml-2"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const url = await control.upload(file);
            if (url) onUploaded(url);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
