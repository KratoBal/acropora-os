"use client";

import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  customerTextProblem,
  hasPermission,
  PERMISSIONS,
  searchWebshopCustomerTexts,
  WEBSHOP_CUSTOMER_MAIL_TEMPLATES_HREF,
  WEBSHOP_CUSTOMER_TEXT_GROUPS,
  WEBSHOP_CUSTOMER_TEXT_LOCALES,
  type WebshopCustomerText,
  type WebshopCustomerTextLocale,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopCustomerTextsApi } from "@/lib/api/webshop-customer-texts";

/**
 * VEVŐI SZÖVEGEK (kártya 7bfca4eb; Balázs, 2026-11-24 14:00 és 14:02 UTC: minden vevőnek szóló szöveg szerkeszthető legyen, egy
 * logikusan felépített felületen). A kirakat szövegei a vevő útja szerinti csoportokban (acrobot 60632), kereséssel; a webshop
 * levelei a Levélsablonok webshop csoportjában élnek, a Levelek csoport oda visz. Egy szöveg nyelvenként írható át, és
 * visszaállítható a kirakat alapértékére. Csak a teszt OS-en látszik.
 */

const LOCALE_LABEL: Record<WebshopCustomerTextLocale, string> = {
  hu: "Magyar",
  en: "Angol",
};

const KNOWN_GROUPS = new Set<string>(
  WEBSHOP_CUSTOMER_TEXT_GROUPS.map((group) => group.id),
);

const current = (
  text: WebshopCustomerText,
  locale: WebshopCustomerTextLocale,
) => text.overrides[locale] ?? text.defaults[locale];

const edited = (text: WebshopCustomerText) =>
  WEBSHOP_CUSTOMER_TEXT_LOCALES.some(
    (locale) => text.overrides[locale] !== null,
  );

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

function TextEditor({
  text,
  onSave,
  onClose,
}: {
  text: WebshopCustomerText;
  onSave: (
    locale: WebshopCustomerTextLocale,
    value: string | null,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<WebshopCustomerTextLocale, string>>(
    () => ({ hu: current(text, "hu"), en: current(text, "en") }),
  );
  const [problems, setProblems] = useState<
    Partial<Record<WebshopCustomerTextLocale, string>>
  >({});
  const [busy, setBusy] = useState(false);

  /**
   * CSAK AZT A NYELVET ÍRJA, AMI VÁLTOZOTT. Ha a beírt szöveg az alapértékkel egyezik, a felülírás törlődik (nem tárolunk
   * alapértékkel egyező másolatot, ami a szótár későbbi javítását eltakarná).
   */
  const save = async () => {
    const found: Partial<Record<WebshopCustomerTextLocale, string>> = {};
    for (const locale of WEBSHOP_CUSTOMER_TEXT_LOCALES) {
      if (draft[locale].trim() === current(text, locale)) continue;
      const problem = customerTextProblem(text.defaults[locale], draft[locale]);
      if (problem) found[locale] = problem;
    }
    setProblems(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      for (const locale of WEBSHOP_CUSTOMER_TEXT_LOCALES) {
        const value = draft[locale].trim();
        if (value === current(text, locale)) continue;
        await onSave(locale, value === text.defaults[locale] ? null : value);
      }
      onClose();
    } catch {
      // the page shows the error; the editor stays open with what was typed
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg bg-pilot-grey-50 p-3">
      {WEBSHOP_CUSTOMER_TEXT_LOCALES.map((locale) => (
        <div key={locale} className="space-y-1">
          <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
            {LOCALE_LABEL[locale]}
            <textarea
              aria-label={`${LOCALE_LABEL[locale]} szöveg`}
              className="w-full rounded-lg border border-pilot-grey-200 px-3 py-2 text-sm"
              rows={Math.min(
                6,
                Math.max(2, Math.ceil(draft[locale].length / 80)),
              )}
              value={draft[locale]}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, [locale]: event.target.value }))
              }
            />
          </label>
          <p className="text-xs text-pilot-grey-500">
            Alapérték: {text.defaults[locale]}
          </p>
          {problems[locale] ? (
            <p className="text-xs text-pilot-red-700">{problems[locale]}</p>
          ) : null}
          {text.overrides[locale] !== null ? (
            <PilotButton
              variant="ghost"
              disabled={busy}
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  [locale]: text.defaults[locale],
                }))
              }
            >
              Vissza az alapra
            </PilotButton>
          ) : null}
        </div>
      ))}
      <div className="flex gap-2">
        <PilotButton disabled={busy} onClick={() => void save()}>
          Mentés
        </PilotButton>
        <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
          Mégse
        </PilotButton>
      </div>
    </div>
  );
}

export function WebshopCustomerTextsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [texts, setTexts] = useState<WebshopCustomerText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      setTexts((await webshopCustomerTextsApi.get(token)).texts);
    } catch (cause) {
      setError(message(cause, "A vevői szövegek nem tölthetők be."));
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const found = useMemo(
    () => (texts ? searchWebshopCustomerTexts(texts, query) : []),
    [texts, query],
  );
  const searching = query.trim() !== "";

  const save = async (
    key: string,
    locale: WebshopCustomerTextLocale,
    value: string | null,
  ) => {
    setError(null);
    setSaved(null);
    try {
      const next = await webshopCustomerTextsApi.save(token, {
        key,
        locale,
        value,
      });
      setTexts((prev) =>
        prev ? prev.map((text) => (text.key === key ? next : text)) : prev,
      );
      setSaved(value === null ? "Visszaállítva az alapértékre." : "Mentve.");
    } catch (cause) {
      setError(message(cause, "A mentés nem sikerült."));
      throw cause;
    }
  };

  const row = (text: WebshopCustomerText) => (
    <li
      key={text.key}
      className="space-y-2 border-t border-pilot-grey-100 py-3 first:border-t-0"
      data-testid={`vevoi-szoveg-${text.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-pilot-grey-900">{current(text, "hu")}</p>
          <p className="text-xs text-pilot-grey-500">{current(text, "en")}</p>
          <p className="font-mono text-xs text-pilot-grey-400">{text.key}</p>
        </div>
        <div className="flex items-center gap-2">
          {edited(text) ? <PilotBadge variant="teal">Átírva</PilotBadge> : null}
          {editing !== text.key ? (
            <PilotButton variant="ghost" onClick={() => setEditing(text.key)}>
              Szerkesztés
            </PilotButton>
          ) : null}
        </div>
      </div>
      {editing === text.key ? (
        <TextEditor
          text={text}
          onSave={(locale, value) => save(text.key, locale, value)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </li>
  );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Vevői szövegek"
        description="A webshop vevőnek szóló szövegei a vevő útja szerint. Ami nincs átírva, a kirakat alapértéke."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a webshop vevői szövegeihez
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-pilot-grey-600">
          {saved}
        </p>
      ) : null}

      {canManage && !texts && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}

      {texts ? (
        <>
          <PilotInput
            type="search"
            aria-label="Keresés a vevői szövegekben"
            placeholder="Keresés szövegre vagy azonosítóra"
            value={query}
            onChange={setQuery}
          />
          {searching ? (
            <p className="text-sm text-pilot-grey-600">
              {found.length} találat
            </p>
          ) : null}
          {WEBSHOP_CUSTOMER_TEXT_GROUPS.map((group) => {
            if (group.id === "levelek")
              return searching ? null : (
                <PilotCard key={group.id} className="space-y-2 p-5">
                  <h2 className="text-base font-semibold text-pilot-grey-900">
                    {group.title}
                  </h2>
                  <p className="text-sm text-pilot-grey-600">
                    {group.description}
                  </p>
                  <Link
                    href={WEBSHOP_CUSTOMER_MAIL_TEMPLATES_HREF}
                    className="text-sm font-medium text-pilot-aqua-700 underline"
                  >
                    A webshop levelei
                  </Link>
                </PilotCard>
              );
            const inGroup = found.filter((text) => text.group === group.id);
            if (searching && !inGroup.length) return null;
            const expanded = searching || open === group.id;
            const editedCount = inGroup.filter(edited).length;
            return (
              <PilotCard key={group.id} className="space-y-3 p-5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => setOpen(expanded ? null : group.id)}
                  disabled={searching}
                >
                  <span className="space-y-1">
                    <span className="block text-base font-semibold text-pilot-grey-900">
                      {group.title}
                    </span>
                    <span className="block text-sm text-pilot-grey-600">
                      {group.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-pilot-grey-500">
                    {inGroup.length} szöveg
                    {editedCount ? `, ${editedCount} átírva` : ""}
                  </span>
                </button>
                {expanded ? <ul>{inGroup.map(row)}</ul> : null}
              </PilotCard>
            );
          })}
          {/* a group the shop sends and this page does not know yet: shown, not hidden */}
          {found.some((text) => !KNOWN_GROUPS.has(text.group)) ? (
            <PilotCard className="space-y-3 p-5">
              <h2 className="text-base font-semibold text-pilot-grey-900">
                Egyéb
              </h2>
              <ul>
                {found.filter((text) => !KNOWN_GROUPS.has(text.group)).map(row)}
              </ul>
            </PilotCard>
          ) : null}
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
