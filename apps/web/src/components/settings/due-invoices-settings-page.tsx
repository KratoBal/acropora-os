"use client";

import {
  hasPermission,
  PERMISSIONS,
  type DueInvoicesMailSettingsView,
} from "@acropora/types";
import {
  PilotButton,
  PilotCard,
  PilotFormField,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { dueInvoicesSettingsApi } from "@/lib/api/due-invoices";
import { formatDayHu } from "@/lib/format/date";

const WEEKDAYS = [
  "Hétfő",
  "Kedd",
  "Szerda",
  "Csütörtök",
  "Péntek",
  "Szombat",
  "Vasárnap",
];

/** A címzettek szövege: soronként egy cím, de a vessző, a pontosvessző és a szóköz is elválaszt. */
export const splitRecipients = (text: string): string[] =>
  text.split(/[\s,;]+/).filter(Boolean);

/**
 * BEÁLLÍTÁSOK > LEJÁRÓ SZÁMLÁK LEVELE (Balázs, 2026-11-20; acrobot 58227, 58274): kinek megy a heti levél (több cím), mikor (a nap, a LEGKORÁBBI és a
 * LEGKÉSŐBBI időpont), ki a feladó (alapból a környezeti alapértelmezés, info@), és kikapcsolható. A tartalmi ellenőrzés a szerveré: a hibát
 * a szerver mondja ki, ez a lap kiírja.
 */
export function DueInvoicesSettingsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [loaded, setLoaded] = useState<DueInvoicesMailSettingsView | null>(
    null,
  );
  const [enabled, setEnabled] = useState(true);
  const [recipients, setRecipients] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [earliest, setEarliest] = useState("07:00");
  const [latest, setLatest] = useState("12:00");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((view: DueInvoicesMailSettingsView) => {
    setLoaded(view);
    setEnabled(view.enabled);
    setRecipients(view.recipients.join("\n"));
    setFromAddress(view.fromAddress ?? "");
    setWeekday(String(view.weekday));
    setEarliest(view.earliest);
    setLatest(view.latest);
  }, []);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      apply(await dueInvoicesSettingsApi.read(token));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A beállítás nem tölthető be.",
      );
    }
  }, [apply, canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      apply(
        await dueInvoicesSettingsApi.save(token, {
          enabled,
          recipients: splitRecipients(recipients),
          fromAddress: fromAddress.trim() === "" ? null : fromAddress.trim(),
          weekday: Number(weekday),
          earliest,
          latest,
        }),
      );
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setSaved(false);
      set(value);
    };

  if (!canManage)
    return (
      <PilotThemeRoot className="space-y-6">
        <p className="text-sm text-pilot-grey-600">
          A Lejáró számlák levelének beállításához finance.manage jog kell.
        </p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások"
        title="Lejáró számlák levele"
        description="A heti „Lejáró számlák - Utalási jegyzék” PDF kinek megy, mikor, és ki a feladó."
      />
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
      {!loaded && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {loaded ? (
        <PilotCard className="space-y-5 p-5">
          <label className="flex items-center gap-2 text-sm text-pilot-grey-900">
            <input
              type="checkbox"
              aria-label="A heti levél be van kapcsolva"
              checked={enabled}
              onChange={(event) => change(setEnabled)(event.target.checked)}
            />
            A heti levél be van kapcsolva
          </label>
          <PilotFormField
            label="Címzettek"
            htmlFor="due-recipients"
            help="Soronként egy cím (vesszővel vagy szóközzel is elválasztható). Címzett nélkül nem megy levél."
          >
            <textarea
              id="due-recipients"
              className="w-full rounded-lg border border-pilot-grey-200 px-3 py-2 text-sm"
              rows={4}
              value={recipients}
              onChange={(event) => change(setRecipients)(event.target.value)}
            />
          </PilotFormField>
          <PilotFormField
            label="Feladó"
            htmlFor="due-from"
            help={
              loaded.defaultFromAddress
                ? `Üresen az alapértelmezés megy: ${loaded.defaultFromAddress}.`
                : "Nincs alapértelmezett feladó beállítva: üresen a levélküldő saját alapértelmezett feladója (a ticket@ cím) menne, aminek a válaszaiból jegy-vázlat lehet. Adj meg egy címet."
            }
          >
            <PilotInput
              aria-label="Feladó"
              value={fromAddress}
              placeholder={loaded.defaultFromAddress ?? "feladó cím"}
              onChange={change(setFromAddress)}
            />
          </PilotFormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PilotFormField label="Nap">
              <PilotSelect
                chevron
                aria-label="Nap"
                value={weekday}
                onChange={change(setWeekday)}
              >
                {WEEKDAYS.map((name, index) => (
                  <option key={name} value={String(index + 1)}>
                    {name}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
            <PilotFormField
              label="Legkorábban"
              help="Ennél korábban nem megy levél."
            >
              <PilotInput
                aria-label="Legkorábbi időpont"
                type="time"
                value={earliest}
                onChange={change(setEarliest)}
              />
            </PilotFormField>
            <PilotFormField
              label="Legkésőbb"
              help="Eddig a pillanatig megy, akkor is, ha nem jött új banki adat."
            >
              <PilotInput
                aria-label="Legkésőbbi időpont"
                type="time"
                value={latest}
                onChange={change(setLatest)}
              />
            </PilotFormField>
          </div>
          <p className="text-xs text-pilot-grey-600" data-testid="due-rule">
            A levél a legkorábbi időpont után indul, amikor aznap már bejött az
            első új banki betöltés; ha a legkésőbbi időpontig nem jön, akkor is
            kimegy, és a PDF tetején áll az utolsó banki adat ideje. Naponta
            legfeljebb egyszer megy.
          </p>
          {loaded.claimedWithoutSend ? (
            <p
              role="status"
              data-testid="due-claimed"
              className="rounded-lg bg-pilot-amber-50 p-3 text-sm text-pilot-amber-700"
            >
              A(z) {formatDayHu(loaded.claimedWithoutSend)} nap foglalt, de a
              levél nem ment ki (a folyamat a foglalás és a küldés között állt
              le, vagy a küldés nem sikerült). Aznap már nem megy levél.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <PilotButton disabled={busy} onClick={() => void save()}>
              Mentés
            </PilotButton>
            {saved ? (
              <span role="status" className="text-sm text-pilot-grey-600">
                Mentve.
              </span>
            ) : null}
            <span
              className="text-xs text-pilot-grey-500"
              data-testid="due-last-sent"
            >
              {loaded.lastSent
                ? `Utolsó küldés: ${formatDayHu(loaded.lastSent.day)}, ${loaded.lastSent.recipients} címzettnek.`
                : "Még nem ment levél."}
            </span>
          </div>
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
