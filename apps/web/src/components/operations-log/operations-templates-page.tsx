"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type OperationsTaskTemplateDto,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { operationsLogApi } from "@/lib/api/operations-log";

import {
  errorText,
  isAbort,
  OPERATIONS_FREQUENCY_LABELS,
  OPERATIONS_FREQUENCY_VARIANT,
  OPERATIONS_TEMPLATES_PATH,
  targetLabel,
} from "./operations-format";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJAI (task os-uzemeltetesi-naplo, S1b; a legközelebbi meglévő képernyő az Ajánlatsablonok,
 * `quotes/quote-templates-page.tsx`, Figma 35 · OS / Offers / Templates 579:2243). Kártyánként egy sablon: név, gyakoriság,
 * állapot, a cél (eszköz vagy kategória), a mezők száma és a mezők címkéi, és a Szerkesztés. A keresés és az „Kivezetettek is”
 * kapcsoló az ajánlatsablonokéval egyezik.
 */
export function OperationsTemplatesPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session &&
    hasPermission(session.user, PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE),
  );
  const [templates, setTemplates] = useState<
    OperationsTaskTemplateDto[] | null
  >(null);
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setError(null);
      try {
        setTemplates(
          (await operationsLogApi.list(token, inactive, signal)).items,
        );
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "A sablonok nem tölthetők be."));
      }
    },
    [inactive, canManage, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az üzemeltetési napló sablonjaihoz"
        description="operations-log.templates.manage jogosultság szükséges."
      />
    );

  const needle = search.trim().toLocaleLowerCase("hu");
  const shown = (templates ?? []).filter((t) =>
    t.name.toLocaleLowerCase("hu").includes(needle),
  );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások / Üzemeltetési napló"
        title="Üzemeltetési napló sablonjai"
        description="A rendszeres üzemeltetési feladatok (napi, heti, alkalmi) sablonja: melyik eszközre vagy kategóriára szól, és mit kell rögzíteni hozzá."
        actions={
          <PilotButton
            size="regular"
            onClick={() => router.push(`${OPERATIONS_TEMPLATES_PATH}/uj`)}
          >
            Új sablon
          </PilotButton>
        }
      />

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
            checked={inactive}
            onChange={(event) => setInactive(event.target.checked)}
          />
          Kivezetettek is
        </label>
      </div>

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {templates === null ? (
        <Skeleton className="h-64 w-full" />
      ) : shown.length ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {shown.map((template) => (
            <li key={template.id}>
              <PilotCard>
                <div className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-pilot-grey-900">
                      {template.name}
                    </h2>
                    <div className="flex shrink-0 gap-2">
                      <PilotBadge
                        variant={
                          OPERATIONS_FREQUENCY_VARIANT[template.frequency]
                        }
                      >
                        {OPERATIONS_FREQUENCY_LABELS[template.frequency]}
                      </PilotBadge>
                      <PilotBadge
                        variant={template.isActive ? "success" : "grey"}
                      >
                        {template.isActive ? "Aktív" : "Kivezetett"}
                      </PilotBadge>
                    </div>
                  </div>
                  <p className="text-xs text-pilot-grey-600">
                    {targetLabel(template.target)}
                  </p>
                  <p className="text-xs text-pilot-grey-600">
                    {template.fields.length} mező
                  </p>
                  <p className="text-xs text-pilot-grey-700">
                    {template.fields.map((field) => field.label).join(" · ")}
                  </p>
                  <div className="flex gap-2">
                    <PilotButton
                      variant="secondary"
                      aria-label={`${template.name}: szerkesztés`}
                      onClick={() =>
                        router.push(
                          `${OPERATIONS_TEMPLATES_PATH}/${template.id}`,
                        )
                      }
                    >
                      Szerkesztés
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
    </PilotThemeRoot>
  );
}
