"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotInput,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type QuoteSnippetDto,
  type QuoteTemplateDto,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";

import { errorText, isAbort } from "./quote-format";

export const QUOTE_TEMPLATES_PATH = "/beallitasok/ajanlat-sablonok";
const SNIPPETS_PATH = "/beallitasok/ajanlat-szovegreszletek";

/** A copy's body: everything but the identity, under a new name. */
export function templateCopy(template: QuoteTemplateDto) {
  return {
    name: `${template.name} (másolat)`.slice(0, 120),
    priceDisplay: template.priceDisplay,
    defaultValidityDays: template.defaultValidityDays,
    blocks: template.blocks,
    milestones: template.milestones,
  };
}

/**
 * AZ AJÁNLATSABLONOK (#1582; Figma 35 · OS / Offers / Templates, 579:2243).
 * Kártyánként egy sablon: név, állapot, blokkszám, a blokkok címei, és a
 * Szerkesztés / Másolat. Alatta a gyorsan beszúrható szövegrészletek. A
 * „Standard feltételek” fül és a nyelv/típus szűrő nincs: nincs mögöttük
 * modell (szándékos eltérés, FIGMA-MAP).
 */
export function QuoteTemplatesPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_TEMPLATES_MANAGE),
  );
  const [templates, setTemplates] = useState<QuoteTemplateDto[] | null>(null);
  const [snippets, setSnippets] = useState<QuoteSnippetDto[]>([]);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setError(null);
      try {
        setTemplates(await quotesApi.templateList(token, archived, signal));
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "A sablonok nem tölthetők be."));
      }
    },
    [archived, canManage, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    quotesApi
      .snippets(token, false, controller.signal)
      .then(setSnippets)
      .catch(() => setSnippets([]));
    return () => controller.abort();
  }, [canManage, token]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az ajánlatsablonokhoz"
        description="quotes.templates.manage jogosultság szükséges."
      />
    );

  const copy = async (template: QuoteTemplateDto) => {
    setBusy(true);
    setError(null);
    try {
      const created = await quotesApi.createTemplate(
        token,
        templateCopy(template),
      );
      router.push(`${QUOTE_TEMPLATES_PATH}/${created.id}`);
    } catch (cause) {
      setError(errorText(cause, "A másolat nem készült el."));
      setBusy(false);
    }
  };

  const needle = search.trim().toLocaleLowerCase("hu");
  const shown = (templates ?? []).filter((t) =>
    t.name.toLocaleLowerCase("hu").includes(needle),
  );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások / Árajánlatok"
        title="Ajánlatsablonok"
        description="Új ajánlat indításához használható teljes sablonok és újrahasznosítható szövegblokkok."
        actions={
          <PilotButton
            size="regular"
            onClick={() => router.push(`${QUOTE_TEMPLATES_PATH}/uj`)}
          >
            Új sablon
          </PilotButton>
        }
      />

      <nav aria-label="Sablon nézetek" className="flex gap-2">
        <span
          aria-current="page"
          className="rounded-md bg-pilot-aqua-50 px-3 py-2 text-sm font-semibold text-pilot-aqua-700 ring-1 ring-pilot-grey-200"
        >
          Teljes ajánlatsablonok
        </span>
        <Link
          href={SNIPPETS_PATH}
          className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-pilot-grey-700 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
        >
          Szövegblokkok
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-full max-w-sm">
          <PilotInput
            aria-label="Keresés sablon név alapján"
            placeholder="Keresés sablon név alapján…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-pilot-grey-700">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Archiváltak is
        </label>
      </div>

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {templates === null ? (
        <Skeleton className="h-64 w-full" />
      ) : shown.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {shown.map((template) => (
            <li key={template.id}>
              <PilotCard>
                <div className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-pilot-grey-900">
                      {template.name}
                    </h2>
                    <PilotBadge
                      variant={template.archivedAt ? "grey" : "success"}
                    >
                      {template.archivedAt ? "Archivált" : "Aktív"}
                    </PilotBadge>
                  </div>
                  <p className="text-xs text-pilot-grey-600">
                    {template.blocks.length} blokk
                  </p>
                  <p className="text-xs text-pilot-grey-700">
                    {template.blocks
                      .map((b) => b.title)
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex gap-2">
                    <PilotButton
                      variant="secondary"
                      aria-label={`${template.name}: szerkesztés`}
                      onClick={() =>
                        router.push(`${QUOTE_TEMPLATES_PATH}/${template.id}`)
                      }
                    >
                      Szerkesztés
                    </PilotButton>
                    <PilotButton
                      variant="secondary"
                      disabled={busy}
                      aria-label={`${template.name}: másolat`}
                      onClick={() => void copy(template)}
                    >
                      Másolat
                    </PilotButton>
                  </div>
                </div>
              </PilotCard>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pilot-grey-600">
          {templates.length
            ? "Nincs a keresésnek megfelelő sablon."
            : "Még nincs sablon. Az „Új sablon” gombbal vehetsz fel egyet."}
        </p>
      )}

      {snippets.length ? (
        <PilotCard>
          <PilotCardHeader title="Gyorsan újrahasználható blokkok" />
          <div className="space-y-3 p-5">
            <p className="text-xs text-pilot-grey-600">
              Ezek teljes sablonon kívül is beszúrhatók bármely ajánlatba.
            </p>
            <ul className="grid gap-3 sm:grid-cols-3">
              {snippets.map((snippet) => (
                <li key={snippet.id}>
                  <Link
                    href={SNIPPETS_PATH}
                    className="block rounded-md bg-white px-3 py-2 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
                  >
                    {snippet.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
