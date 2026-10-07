"use client";

import { Icon, PilotInput } from "@acropora/ui";
import { useEffect, useId, useState } from "react";

export interface PickerOption {
  id: string;
  title: string;
  subtitle?: string | null;
  /**
   * A beírt szöveg, nem a rendszer eleme (Balázs 2026-10-07: „előfordulhat, hogy
   * olyan élőlény van, vagy beszállító, aki nincs a rendszerben, és nem is akarjuk
   * felvenni”). Ilyenkor az `id` üres, a `title` a beírt név.
   */
  freeText?: boolean;
}

/** A beírt szöveg mint választás. */
export function freeTextOption(term: string, maxLength: number): PickerOption {
  return {
    id: "",
    title: term.trim().slice(0, maxLength),
    subtitle: "nincs a rendszerben",
    freeText: true,
  };
}

/**
 * KERESŐS VÁLASZTÓ az élőlényhez és a beszállítóhoz: a szerver a keresett
 * szóra legfeljebb húsz találatot ad, tehát egy legördülő lista itt nem
 * mutatná meg mindet. Kiválasztás után a választott elem áll a helyén, a
 * „Csere” gombbal lehet újra keresni. Egérrel, és a mezőből nyilakkal és
 * Enterrel is választható.
 */
export function MortalitySearchPicker({
  label,
  placeholder,
  value,
  onChange,
  search,
  emptyText,
  freeTextMaxLength,
}: {
  label: string;
  placeholder: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  search: (term: string, signal: AbortSignal) => Promise<PickerOption[]>;
  emptyText: string;
  /** ha meg van adva, a beírt szöveg is választható, legfeljebb ennyi karakterrel */
  freeTextMaxLength?: number;
}) {
  const listId = useId();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** a nyilakkal kijelölt sor indexe a választható sorok között, vagy -1 */
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open || value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      search(term, controller.signal)
        .then((found) => {
          setOptions(found);
          setError(null);
          setActive(-1);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof Error ? cause.message : "A keresés nem sikerült.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, term, value]);

  if (value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-pilot-grey-200">
        <div className="min-w-0">
          <div className="truncate font-medium text-pilot-grey-900">
            {value.title}
          </div>
          {value.subtitle ? (
            <div className="truncate text-xs text-pilot-grey-500">
              {value.subtitle}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTerm("");
            setOpen(true);
          }}
          className="shrink-0 cursor-pointer text-xs text-pilot-accent-warm-text hover:underline"
        >
          Csere
        </button>
      </div>
    );

  // a választható sorok egy listában: a találatok, utána a beírt név (ha
  // megadható); a nyilak és az Enter ezen lépkednek
  const freeText =
    freeTextMaxLength && term.trim()
      ? freeTextOption(term, freeTextMaxLength)
      : null;
  const shown = error || (loading && options.length === 0) ? [] : options;
  const choices = freeText ? [...shown, freeText] : shown;
  const activeChoice = active >= 0 ? choices[active] : undefined;

  const choose = (option: PickerOption) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // a lista a fókusz elvesztésekor zárul; a találatra kattintás nem viszi
        // el a fókuszt (lásd a lista `onMouseDown`-ját), a Tab a gombra igen,
        // de az a dobozon belül marad
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          setActive(-1);
          return;
        }
        if (!open || choices.length === 0) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((current) =>
            current < 0 && step < 0
              ? choices.length - 1
              : (current + step + choices.length) % choices.length,
          );
        } else if (event.key === "Enter" && activeChoice) {
          // az űrlapot ne küldje el: itt az Enter választás
          event.preventDefault();
          choose(activeChoice);
        }
      }}
    >
      <div onFocus={() => setOpen(true)}>
        <PilotInput
          aria-label={label}
          value={term}
          onChange={(next) => {
            setTerm(next);
            setOpen(true);
            setActive(-1);
          }}
          leadingIcon={<Icon name="search" size={16} />}
          placeholder={placeholder}
          className="h-10"
        />
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // A KATTINTÁS ITT DŐL EL (Luca hibajelzése, 2026-10-07): a Safari
          // egérkattintásra nem fókuszálja a gombot, tehát a mező `blur`-je cél
          // nélkül jött, a doboz bezárta a listát, és a `click` már nem talált
          // gombot. A `mousedown` alapértelmezését tiltva a fókusz a mezőben
          // marad, `blur` nincs, és a `click` célba ér.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-pilot-grey-200"
        >
          {error ? (
            <li className="px-3 py-2 text-sm text-rose-600">{error}</li>
          ) : loading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-pilot-grey-500">Keresés…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-pilot-grey-500">
              {emptyText}
            </li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.id}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => choose(option)}
                  className={`block w-full cursor-pointer px-3 py-2 text-left hover:bg-pilot-grey-50 ${
                    index === active ? "bg-pilot-grey-50" : ""
                  }`}
                >
                  <span className="block text-sm text-pilot-grey-900">
                    {option.title}
                  </span>
                  {option.subtitle ? (
                    <span className="block text-xs text-pilot-grey-500">
                      {option.subtitle}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
          {freeText ? (
            <li role="option" aria-selected={active === choices.length - 1}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => choose(freeText)}
                className={`block w-full cursor-pointer border-t border-pilot-grey-100 px-3 py-2 text-left hover:bg-pilot-grey-50 ${
                  active === choices.length - 1 ? "bg-pilot-grey-50" : ""
                }`}
              >
                <span className="block text-sm text-pilot-grey-900">
                  „{freeText.title}” megadása
                </span>
                <span className="block text-xs text-pilot-grey-500">
                  Nincs a rendszerben, és nem is kell felvenni
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
