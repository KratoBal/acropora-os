import type { ReactNode } from "react";

import { PilotCard } from "./pilot-ui";

/**
 * AZ ÚJ HIBAJEGY, AZ ÚJ MUNKALAP ÉS AZ ÚJ KARBANTARTÁS ŰRLAP KÖZÖS VÁZA (picasso leltár 3.7 és a hozzá adott terv, acrobot 2026-11-25).
 *
 * Három űrlap, három szerkezet volt: a kötelező mező háromféleképpen volt jelölve ("*", "Kötelező: ...", "Hiányzó kötelező mezők: ..."), a mezők sorrendje
 * mindenhol más, és 1440 px-en a hibajegy űrlap keskeny oszlop volt nagy üres jobb oldallal. A váz ezt egyetlen szabályra hozza:
 *
 *  - a KÖTELEZŐ mező címkéje félkövér, utána piros csillag; a NEM kötelezőé után szürkén "(nem kötelező)": a két jel egy szabály, mindkét alak kimondva
 *  - az összesítő a gombsor bal oldalán, egy alakban: "Hiányzik: Alegység, Tárgy"
 *  - a csoportok egy-egy kártya, a kártya címe a KÉRDÉS (nincs sorszám): Kinek és hol? A munka (mi)? Mikor? Ki felel érte?
 *  - 1440 px-en egy főoszlop (legfeljebb 760 px) és jobbra egy 300 px-es "Mi történik ezután" oldalkártya (csak 1100 px fölött); alatta a gombsor fölött sima szöveg
 *
 * A váz a mezők TARTALMÁHOZ és a kötelezőségi szabályokhoz nem nyúl: csak a helyükhöz és a feliratukhoz.
 */

/**
 * A MEZŐ ALATTI SÚGÓ ÉS A FÜGGŐ MEZŐ "ELŐBB VÁLASSZ ..." MONDATA EGY STÍLUS (acrobot 2026-11-25, a stage-képről): kicsi, szürke. Eddig a függő mező
 * mondata sötét és nagy volt (a hibajegy és a karbantartás űrlapon), dőlt (a munkalapon) vagy a másik szürke volt, a súgó pedig kicsi és halvány.
 */
export const PILOT_FIELD_HINT_CLASS = "text-xs text-pilot-grey-400";

/** Egy űrlap-csoport kártyája: a címe a kérdés ("Kinek és hol?"), a mezők egy oszlopban, a rövid párok egy sorban (`PilotFieldPair`). */
export function PilotFormCard({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <PilotCard className="overflow-hidden">
      <section id={id} aria-labelledby={id ? `${id}-title` : undefined}>
        <h2
          id={id ? `${id}-title` : undefined}
          className="border-b border-pilot-grey-100 px-5 py-4 text-sm font-semibold text-pilot-grey-900"
        >
          {title}
        </h2>
        <div className="flex flex-col gap-5 px-5 py-5">{children}</div>
      </section>
    </PilotCard>
  );
}

/** Két rövid mező egy soron (Partner + Alegység; Keltezés + Határidő): telefonon egymás alatt. */
export function PilotFieldPair({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>
  );
}

/**
 * A MEZŐ CÍMKÉJE ÉS HIBÁJA. `requirement` KÖTELEZŐ paraméter (nincs alapérték): a hívónak ki kell mondania, melyik a mező, hogy egy új mező ne
 * maradjon jelölés nélkül. A hiba a mezőnél áll egy mondattal ("Válassz alegységet."), a mező pedig piros keretet kap (a gyerek `input`,
 * `select` és `textarea` elemeire, mert a hívók különféle komponenseket tesznek ide).
 */
export function PilotField({
  label,
  requirement,
  htmlFor,
  help,
  error,
  children,
  className,
  id,
}: {
  label: string;
  requirement: "required" | "optional";
  htmlFor?: string;
  help?: string;
  /** A mező hibamondata; csak az első mentési kísérlet után adja a hívó. */
  error?: string | null;
  children: ReactNode;
  className?: string;
  /** A mező doboza: az összesítő hibájára ide görget a mentés gomb. */
  id?: string;
}) {
  return (
    <div
      id={id}
      data-invalid={error ? "true" : undefined}
      className={`flex flex-col gap-1.5 ${error ? "[&_input]:ring-pilot-red-700 [&_select]:ring-pilot-red-700 [&_textarea]:ring-pilot-red-700" : ""} ${className ?? ""}`}
    >
      <label
        htmlFor={htmlFor}
        className="text-sm font-semibold text-pilot-grey-800"
      >
        {label}
        {requirement === "required" ? (
          <>
            <span aria-hidden="true" className="text-pilot-red-700">
              *
            </span>
            <span className="sr-only"> (kötelező)</span>
          </>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-pilot-grey-400">
            (nem kötelező)
          </span>
        )}
      </label>
      {children}
      {help ? <p className={PILOT_FIELD_HINT_CLASS}>{help}</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-pilot-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A hiányzó kötelező mezők összesítője, EGY alakban: "Hiányzik: Alegység, Tárgy". Nincs hiányzó mező: semmi. */
export function PilotMissingSummary({
  missing,
}: {
  missing: readonly string[];
}) {
  if (missing.length === 0) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-sm font-medium text-pilot-red-700"
    >
      Hiányzik: {missing.join(", ")}
    </p>
  );
}

/**
 * A GOMBSOR: bal oldalt az összesítő, jobb oldalt a Mégse és a mentés. A mentés gomb HALVÁNY (`aria-disabled`), amíg van hiányzó mező, de KATTINTHATÓ:
 * a hívó `onSubmit`-ja dönt (hiányzó mezőnél megmutatja a hibákat és a hibás mezőhöz görget, nem ment). Telefonon a sor teljes szélességű,
 * a Mégse és a mentés egymás mellett.
 */
export function PilotFormActions({
  missing,
  busy,
  submitLabel,
  busyLabel,
  cancelLabel = "Mégse",
  onCancel,
  onSubmit,
}: {
  missing: readonly string[];
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const dimmed = missing.length > 0;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-5 sm:flex-1">
        <PilotMissingSummary missing={missing} />
      </div>
      <div className="flex gap-3 sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-10 flex-none cursor-pointer items-center justify-center rounded-md bg-white px-4 text-sm font-semibold text-pilot-grey-900 ring-1 ring-pilot-grey-200 transition-colors hover:bg-pilot-grey-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          aria-disabled={dimmed || busy}
          onClick={() => {
            if (!busy) onSubmit();
          }}
          className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md bg-pilot-aqua-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-pilot-aqua-700 aria-disabled:opacity-50 aria-disabled:hover:bg-pilot-aqua-600 sm:flex-none"
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * AZ ELRENDEZÉS: egy főoszlop (legfeljebb 760 px), jobbra 300 px-es oldalkártya "Mi történik ezután" -- CSAK 1100 px fölött. Alatta (telefon, tablet) ugyanaz
 * a szöveg sima mondatként a gombsor fölé kerül (`actions` előtt). `afterText` 1-3 mondat: mi lesz a mentés után.
 */
export function PilotFormLayout({
  children,
  afterText,
  actions,
  top,
}: {
  children: ReactNode;
  afterText: string;
  actions: ReactNode;
  /** A főoszlop TETEJÉN álló sávok (hiba, kapcsolat nélküli jelzés): ugyanabban az oszlopban, hogy egy üres sáv ne hagyjon helyet. */
  top?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 min-[1100px]:flex-row min-[1100px]:items-start">
      <div className="flex w-full min-w-0 max-w-[760px] flex-col gap-6">
        {top}
        {children}
        <p
          data-testid="form-after-inline"
          className="text-sm text-pilot-grey-500 min-[1100px]:hidden"
        >
          {afterText}
        </p>
        {actions}
      </div>
      <aside
        aria-label="Mi történik ezután"
        className="hidden w-[300px] shrink-0 min-[1100px]:block"
      >
        <PilotCard className="p-5">
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Mi történik ezután
          </h2>
          <p className="mt-2 text-sm text-pilot-grey-600">{afterText}</p>
        </PilotCard>
      </aside>
    </div>
  );
}
