"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  CONTENT_TEMPLATE_EVENT_KINDS,
  CONTENT_TEMPLATE_EVENT_KIND_LABELS,
  CONTENT_CALENDAR_SETTING_LIMITS,
  CONTENT_TEMPLATE_LIMITS,
  CONTENT_TEMPLATE_ONE_DAY_KINDS,
  hasPermission,
  PERMISSIONS,
  type ContentCalendarSettings,
  type ContentChannel,
  type ContentTemplateEventKind,
  type ContentTemplateRule,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import {
  contentCalendarApi,
  type ContentTemplateRuleInput,
} from "@/lib/api/content-calendar";
import { CHANNEL_LABELS } from "./content-history";

const L = CONTENT_TEMPLATE_LIMITS;

/** Mikor nyílik a tartalom, emberi mondatban: „7 nappal az érkezés előtt", „az utolsó napon". Az egynapos esemény érkezés. */
export function templateTimingLabel(
  rule: Pick<ContentTemplateRule, "anchor" | "offsetDays" | "eventKind">,
): string {
  const oneDay = CONTENT_TEMPLATE_ONE_DAY_KINDS.includes(rule.eventKind);
  const point =
    rule.anchor === "END"
      ? "az utolsó nap"
      : oneDay
        ? "az érkezés"
        : "a kezdet";
  if (rule.offsetDays === 0)
    return rule.anchor === "END"
      ? "az utolsó napon"
      : oneDay
        ? "az érkezés napján"
        : "a kezdet napján";
  const days = Math.abs(rule.offsetDays);
  return `${days} nappal ${point} ${rule.offsetDays < 0 ? "előtt" : "után"}`;
}

type Editing =
  | { kind: "new"; eventKind: ContentTemplateEventKind }
  | { kind: "edit"; rule: ContentTemplateRule };

/**
 * A TARTALOMNAPTÁR SABLONJA (T5.5 S4, spec 2. és 7.): melyik eseményhez milyen tartalom tartozik, melyik csatornán, és
 * hány nappal a kezdete vagy a vége előtt vagy után. Adat, nem kód: Balázs és Luca itt állítja a napokat. Egy sort nem
 * törlünk, hanem kikapcsolunk: a tartalom-helyek (S5) rá hivatkoznak.
 */
export function ContentCalendarTemplatePage() {
  const { session } = useAuth();
  const [rules, setRules] = useState<ContentTemplateRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const user = session?.user ?? null;
  const canView = Boolean(
    user && hasPermission(user, PERMISSIONS.CONTENT_VIEW),
  );
  const canManage = Boolean(
    user && hasPermission(user, PERMISSIONS.CONTENT_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setRules(await contentCalendarApi.template(token, signal));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setRules(null);
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!user) return null;
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod a tartalomnaptárhoz"
        description="A sablont a tartalmat olvasó kollégák látják."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tartalomnaptár: sablon"
        description="Melyik eseményhez milyen tartalom tartozik, és mikor. A napok itt állíthatók, kódváltozás nélkül."
        actions={
          <Link
            href="/tartalom/naptar"
            className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            ← Naptár
          </Link>
        }
      />
      <NewsletterSetting token={token} canManage={canManage} />
      {error ? (
        <Alert
          variant="danger"
          title="A sablon nem elérhető"
          description={error}
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Újra
            </Button>
          }
        />
      ) : rules === null ? (
        <Skeleton className="h-64 w-full" data-testid="template-loading" />
      ) : (
        CONTENT_TEMPLATE_EVENT_KINDS.map((eventKind) => {
          const rows = rules.filter((rule) => rule.eventKind === eventKind);
          return (
            <Card key={eventKind} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-dusk-900">
                  {CONTENT_TEMPLATE_EVENT_KIND_LABELS[eventKind]}
                </h2>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing({ kind: "new", eventKind })}
                  >
                    Új sor
                  </Button>
                ) : null}
              </div>
              {editing?.kind === "new" && editing.eventKind === eventKind ? (
                <TemplateRuleForm
                  token={token}
                  eventKind={eventKind}
                  rule={null}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    void load();
                  }}
                />
              ) : null}
              {rows.length === 0 ? (
                <p className="text-sm text-dusk-500">
                  Ehhez az eseményhez nincs sablon-sor: nem nyílik hozzá
                  tartalom-hely.
                </p>
              ) : (
                <ul className="divide-y divide-dusk-100">
                  {rows.map((rule) =>
                    editing?.kind === "edit" && editing.rule.id === rule.id ? (
                      <li key={rule.id} className="py-3">
                        <TemplateRuleForm
                          token={token}
                          eventKind={eventKind}
                          rule={rule}
                          onCancel={() => setEditing(null)}
                          onSaved={() => {
                            setEditing(null);
                            void load();
                          }}
                        />
                      </li>
                    ) : (
                      <li
                        key={rule.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <span
                          className={`font-medium ${rule.active ? "text-dusk-900" : "text-dusk-400 line-through"}`}
                        >
                          {rule.label}
                        </span>
                        <span className="text-dusk-600">
                          {CHANNEL_LABELS[rule.channel]} ·{" "}
                          {templateTimingLabel(rule)}
                        </span>
                        {rule.active ? null : (
                          <Badge variant="neutral">kikapcsolva</Badge>
                        )}
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto"
                            aria-label={`${rule.label} szerkesztése`}
                            onClick={() => setEditing({ kind: "edit", rule })}
                          >
                            Szerkesztés
                          </Button>
                        ) : null}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

const CHANNELS = Object.keys(CHANNEL_LABELS) as ContentChannel[];

/** Egy sor űrlapja. Szerkesztéskor a sor `updatedAt`-je MINDIG megy: egy közben módosított sort a szerver nem ír felül. */
function TemplateRuleForm({
  token,
  eventKind,
  rule,
  onSaved,
  onCancel,
}: {
  token: string;
  eventKind: ContentTemplateEventKind;
  rule: ContentTemplateRule | null;
  onSaved(): void;
  onCancel(): void;
}) {
  const oneDay = CONTENT_TEMPLATE_ONE_DAY_KINDS.includes(eventKind);
  const [label, setLabel] = useState(rule?.label ?? "");
  const [channel, setChannel] = useState<ContentChannel>(
    rule?.channel ?? "FACEBOOK_POST",
  );
  const [anchor, setAnchor] = useState(rule?.anchor ?? "START");
  const [direction, setDirection] = useState<"before" | "on" | "after">(
    !rule || rule.offsetDays === 0
      ? "on"
      : rule.offsetDays < 0
        ? "before"
        : "after",
  );
  const [days, setDays] = useState(
    String(Math.abs(rule?.offsetDays ?? 1) || 1),
  );
  const [active, setActive] = useState(rule?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = Number(days);
  const validDays =
    direction === "on" ||
    (Number.isInteger(count) && count >= 1 && count <= L.offsetDays.max);
  const offsetDays =
    direction === "on" ? 0 : direction === "before" ? -count : count;

  async function save() {
    setBusy(true);
    setError(null);
    const input: ContentTemplateRuleInput = {
      label,
      channel,
      anchor: oneDay ? "START" : anchor,
      offsetDays,
      active,
    };
    try {
      if (rule)
        await contentCalendarApi.updateTemplateRule(
          token,
          rule.id,
          input,
          rule.updatedAt,
        );
      else await contentCalendarApi.createTemplateRule(token, eventKind, input);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "A sort közben valaki módosította. Zárd be az űrlapot, és nyisd meg újra: a mostani változtatásod nem került mentésre."
          : cause instanceof Error
            ? cause.message
            : "Ismeretlen hiba.",
      );
    } finally {
      setBusy(false);
    }
  }

  const id = rule?.id ?? `new-${eventKind}`;
  return (
    <div className="space-y-3 rounded-lg border border-dusk-200 bg-dusk-50 p-3">
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Tartalom" htmlFor={`${id}-label`}>
          <Input
            id={`${id}-label`}
            value={label}
            maxLength={L.label.max}
            onChange={(e) => setLabel(e.target.value)}
          />
        </FormField>
        <FormField label="Csatorna" htmlFor={`${id}-channel`}>
          <Select
            id={`${id}-channel`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as ContentChannel)}
          >
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Mikor" htmlFor={`${id}-direction`}>
          <Select
            id={`${id}-direction`}
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as "before" | "on" | "after")
            }
          >
            <option value="before">… nappal előtte</option>
            <option value="on">aznap</option>
            <option value="after">… nappal utána</option>
          </Select>
        </FormField>
        {direction === "on" ? null : (
          <FormField
            label="Hány nappal"
            htmlFor={`${id}-days`}
            error={
              validDays
                ? undefined
                : `1 és ${L.offsetDays.max} közötti egész szám.`
            }
          >
            <Input
              id={`${id}-days`}
              type="number"
              min={1}
              max={L.offsetDays.max}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </FormField>
        )}
        {oneDay ? null : (
          <FormField label="Melyik naphoz" htmlFor={`${id}-anchor`}>
            <Select
              id={`${id}-anchor`}
              value={anchor}
              onChange={(e) => setAnchor(e.target.value as "START" | "END")}
            >
              <option value="START">a kezdethez</option>
              <option value="END">az utolsó naphoz</option>
            </Select>
          </FormField>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-dusk-700">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Bekapcsolva (nyit tartalom-helyet)
      </label>
      <p className="text-xs text-dusk-600">
        {templateTimingLabel({
          anchor: oneDay ? "START" : anchor,
          offsetDays: validDays ? offsetDays : 0,
          eventKind,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={busy || !label.trim() || !validDays}
        >
          Mentés
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Mégse
        </Button>
      </div>
    </div>
  );
}

/**
 * A HÍRLEVÉL-GYAKORISÁG (spec 3., S6): Balázs értéke, hány nap teljen el legalább két hírlevél között. Üresen a szabály
 * nem jelez, és ezt ki is mondja: egy kitalált szám helyett a hiányát mutatja.
 */
function NewsletterSetting({
  token,
  canManage,
}: {
  token: string;
  canManage: boolean;
}) {
  const N = CONTENT_CALENDAR_SETTING_LIMITS.newsletterMinDays;
  const [settings, setSettings] = useState<ContentCalendarSettings | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    contentCalendarApi
      .settings(token, controller.signal)
      .then((loaded) => {
        setSettings(loaded);
        setValue(loaded.newsletterMinDays?.toString() ?? "");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      });
    return () => controller.abort();
  }, [token]);

  const trimmed = value.trim();
  const number = Number(trimmed);
  const valid =
    trimmed === "" ||
    (Number.isInteger(number) && number >= N.min && number <= N.max);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await contentCalendarApi.saveSettings(
        token,
        trimmed === "" ? null : number,
      );
      setSettings(saved);
      setValue(saved.newsletterMinDays?.toString() ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4" data-testid="newsletter-setting">
      <h2 className="text-base font-semibold text-dusk-900">
        Hírlevél-gyakoriság
      </h2>
      {error ? (
        <Alert
          variant="danger"
          title="A beállítás hibája"
          description={error}
        />
      ) : null}
      <p className="text-sm text-dusk-600">
        {settings === null
          ? "Betöltés…"
          : settings.newsletterMinDays === null
            ? "Nincs beállítva: a naptár nem figyelmeztet a túl sűrű hírlevélre."
            : `Két hírlevél között legalább ${settings.newsletterMinDays} nap.`}
      </p>
      {canManage && settings !== null ? (
        <div className="flex flex-wrap items-end gap-2">
          <FormField
            label="Legalább ennyi nap két hírlevél között"
            htmlFor="newsletter-min-days"
            error={
              valid
                ? undefined
                : `${N.min} és ${N.max} közötti egész szám, vagy üres.`
            }
          >
            <Input
              id="newsletter-min-days"
              type="number"
              min={N.min}
              max={N.max}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </FormField>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={busy || !valid}
          >
            Gyakoriság mentése
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
