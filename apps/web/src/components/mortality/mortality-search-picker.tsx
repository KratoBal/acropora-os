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
 * „Csere” gombbal lehet újra keresni.
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

  useEffect(() => {
    if (!open || value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      search(term, controller.signal)
        .then((found) => {
          setOptions(found);
          setError(null);
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

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // a lista a fókusz elvesztésekor zárul, de egy találatra kattintás
        // a dobozon belül marad
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <div onFocus={() => setOpen(true)}>
        <PilotInput
          aria-label={label}
          value={term}
          onChange={(next) => {
            setTerm(next);
            setOpen(true);
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
            options.map((option) => (
              <li key={option.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-pilot-grey-50"
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
          {freeTextMaxLength && term.trim() ? (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange(freeTextOption(term, freeTextMaxLength));
                  setOpen(false);
                }}
                className="block w-full cursor-pointer border-t border-pilot-grey-100 px-3 py-2 text-left hover:bg-pilot-grey-50"
              >
                <span className="block text-sm text-pilot-grey-900">
                  „{term.trim().slice(0, freeTextMaxLength)}” megadása
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
