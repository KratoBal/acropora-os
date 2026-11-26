"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  hasPermission,
  parseWebshopPriceRulesInput,
  PERMISSIONS,
  WEBSHOP_PRICE_RULE_SECTIONS,
  WEBSHOP_PRICE_RULES,
  type WebshopPriceRuleField,
  type WebshopPriceRuleSource,
  type WebshopPriceRules,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopPriceRulesApi } from "@/lib/api/webshop-price-rules";

/**
 * HŰSÉGPONT ÉS ÁRSZABÁLYOK (acrobot 60467; Balázs, 2026-11-24: „minden szám és kapcsoló adminból állítható”). A pontbeváltás
 * kapcsolója és számai (commerce #881) és az Omnibus ár-előzmény küszöbe (commerce #880), a webshop határaival. A lap azt
 * mutatja, amit a webshop TÉNYLEGESEN használ, és hogy honnan (tárolt sor, a webshop környezete, alapérték): a teszt kirakat
 * beváltását a környezet kapcsolja be (barracuda, #2824). Egy mentés az egész lapot viszi, de a webshopba csak a
 * megváltoztatott érték íródik. Csak a teszt OS-en látszik.
 */

/**
 * A forrás az ember nyelvén; a `row` (valaki tárolta) nem kap megjegyzést. AZ ALAPÉRTÉK NEM KAP MEZŐNKÉNTI MEGJEGYZÉST (Picasso 3.20): tizenegyszer ugyanaz a mondat zaj volt;
 * helyette EGY összesítő mondat áll a lap tetején (`defaultCount`).
 */
const SOURCE_NOTES: Partial<Record<WebshopPriceRuleSource, string>> = {
  env: "A webshop környezeti beállításából jön; csak akkor íródik felül, ha itt megváltoztatod.",
  row_invalid:
    "A tárolt érték a határokon kívül esik, ezért a webshop ezt használja helyette.",
  read_failed:
    "A webshop nem tudta olvasni a beállításait, ezért a beváltás ki van kapcsolva.",
};

type Draft = Record<WebshopPriceRuleField, string>;

const draftOf = (rules: WebshopPriceRules): Draft =>
  Object.fromEntries(
    WEBSHOP_PRICE_RULES.map(({ field }) => [
      field,
      rules.values[field] === null ? "" : String(rules.values[field]),
    ]),
  ) as Draft;

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function WebshopPriceRulesPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [rules, setRules] = useState<WebshopPriceRules | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = (next: WebshopPriceRules) => {
    setRules(next);
    setDraft(draftOf(next));
  };

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      apply(await webshopPriceRulesApi.get(token));
    } catch (cause) {
      setError(message(cause, "A beállítások nem tölthetők be."));
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (field: WebshopPriceRuleField, value: string) => {
    setSaved(null);
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const save = async () => {
    if (!draft) return;
    const parsed = parseWebshopPriceRulesInput(
      Object.fromEntries(
        WEBSHOP_PRICE_RULES.map(({ field }) => [
          field,
          draft[field].trim() === "" ? Number.NaN : Number(draft[field]),
        ]),
      ),
    );
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      apply(await webshopPriceRulesApi.save(token, parsed.value));
      setSaved("A beállítások mentve.");
    } catch (cause) {
      setError(message(cause, "A mentés nem sikerült."));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const defaultCount = rules
    ? WEBSHOP_PRICE_RULES.filter(
        (rule) =>
          rules.values[rule.field] !== null &&
          rules.sources[rule.field] === "default",
      ).length
    : 0;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Hűségpont és árszabályok"
        description="A hűségpont beváltása a pénztárban, és hogy mikor mutat a webshop áthúzott árat."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed a webshop árszabályaihoz
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

      {defaultCount > 0 ? (
        <p role="note" className="text-sm text-pilot-grey-600">
          {defaultCount} mező a webshop alapértékén áll; a webshopba csak a
          megváltoztatott érték íródik.
        </p>
      ) : null}

      {canManage && !rules && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}

      {rules && draft
        ? WEBSHOP_PRICE_RULE_SECTIONS.map((section) => (
            <PilotCard key={section.id} className="space-y-4 p-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-pilot-grey-900">
                  {section.title}
                </h2>
                <p className="text-sm text-pilot-grey-600">
                  {section.description}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {WEBSHOP_PRICE_RULES.filter(
                  (rule) => rule.section === section.id,
                ).map((rule) => (
                  <div
                    key={rule.field}
                    className="flex flex-col gap-1 text-sm text-pilot-grey-700"
                  >
                    {rule.kind === "switch" ? (
                      <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
                        <input
                          type="checkbox"
                          aria-label={rule.label}
                          checked={draft[rule.field] === "1"}
                          onChange={(event) =>
                            change(rule.field, event.target.checked ? "1" : "0")
                          }
                        />
                        {rule.label}
                      </label>
                    ) : (
                      <label className="flex flex-col gap-1">
                        {rule.label}
                        {rule.unit ? ` (${rule.unit})` : ""}
                        <PilotInput
                          type="number"
                          min={rule.min}
                          max={rule.max}
                          aria-label={rule.label}
                          value={draft[rule.field]}
                          onChange={(value) => change(rule.field, value)}
                        />
                      </label>
                    )}
                    {rules.values[rule.field] === null ? (
                      <span className="text-xs text-pilot-grey-500">
                        A webshopban nincs beállítva.
                      </span>
                    ) : SOURCE_NOTES[rules.sources[rule.field]] ? (
                      <span
                        className={
                          rules.sources[rule.field] === "row_invalid" ||
                          rules.sources[rule.field] === "read_failed"
                            ? "text-xs text-pilot-red-700"
                            : "text-xs text-pilot-grey-500"
                        }
                      >
                        {SOURCE_NOTES[rules.sources[rule.field]]}
                      </span>
                    ) : null}
                    {fieldErrors[rule.field] ? (
                      <span className="text-xs text-pilot-red-700">
                        {fieldErrors[rule.field]}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </PilotCard>
          ))
        : null}

      {rules && draft ? (
        <PilotButton disabled={busy} onClick={() => void save()}>
          Mentés
        </PilotButton>
      ) : null}
    </PilotThemeRoot>
  );
}
