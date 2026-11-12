"use client";

import {
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  AI_CHAT_SETTINGS_LIMITS,
  checkAiChatSettings,
  hasPermission,
  PERMISSIONS,
  type AiChatSettings,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { aiChatSettingsApi } from "@/lib/api/ai-chat-settings";
import { AiContactRequestsSection } from "./ai-contact-requests-section";

/**
 * AZ AI CSEVEGÉS BEÁLLÍTÁSAI (kártya f5b8f7ba, 4a szelet; Balázs 2026-11-11 08:51: a kapcsolatfelvétel címzettje, a tárolás és a
 * megőrzési idő a Beállításokban legyen állítható).
 *
 * A HATÁROKAT NEM EZ A LAP TUDJA, hanem a közös szabály (`checkAiChatSettings`, ugyanaz, amit a szerver futtat): a lap annak a
 * mondatát írja ki, és addig nem enged menteni. Semmit nem vág és nem kerekít: egy megőrzési idő, amit csendben a legközelebbi
 * érvényes értékre tennénk, mást törölne vagy tartana meg, mint amit a tulajdonos kért.
 *
 * AMIT A LAP NEM ÍG ÉR, és ezért áll rajta kimondva: az AI szolgáltatás ezeket az értékeket MÉG NEM olvassa (a megőrzési napokat a
 * saját környezetéből veszi), a kapcsolat-kérés és a felajánlás pedig a következő szeletekben készül. A mentett érték tehát
 * rögzített döntés, nem azonnali hatás.
 */
export function AiChatSettingsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AI_SETTINGS_MANAGE),
  );
  const [settings, setSettings] = useState<AiChatSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      setSettings(await aiChatSettingsApi.get(token));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A beállítások nem tölthetők be.",
      );
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (patch: Partial<AiChatSettings>) => {
    setSaved(false);
    setSettings((current) => (current ? { ...current, ...patch } : current));
  };
  const days = (value: string) => (value.trim() === "" ? NaN : Number(value));

  const checked = settings ? checkAiChatSettings(settings) : null;
  const problem = checked && !checked.ok ? checked.error : null;

  const save = async () => {
    if (!settings || !checked?.ok) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await aiChatSettingsApi.save(token, checked.value));
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const {
    messageRetentionDays: messageLimits,
    contactRetentionDays: requestLimits,
    offTopicFirmAt: offTopicLimits,
  } = AI_CHAT_SETTINGS_LIMITS;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="AI csevegés"
        description="A vevői csevegés felajánlása, a kapcsolat-kérés és az adatok megőrzési ideje."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs jogosultságod az AI csevegés beállításaihoz.
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
      {canManage && !settings && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {settings ? (
        <PilotCard className="space-y-5 p-5">
          <p className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700">
            A mentett értékeket az AI szolgáltatás még nem olvassa: a megőrzési
            napokat ma a szolgáltatás saját beállításából veszi, a
            kapcsolat-kérés és a felajánlás pedig a következő változatokban
            készül. A mentés tehát rögzített döntés, nem azonnali hatás.
          </p>

          <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
            <input
              type="checkbox"
              aria-label="Kollégai felajánlás"
              checked={settings.offerEnabled}
              onChange={(event) =>
                change({ offerEnabled: event.target.checked })
              }
            />
            Kollégai felajánlás a negyedik kör után
          </label>

          <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
            <input
              type="checkbox"
              aria-label="Kapcsolat-kérés"
              checked={settings.contactRequestEnabled}
              onChange={(event) =>
                change({ contactRequestEnabled: event.target.checked })
              }
            />
            Kapcsolat-kérés: a vevő megadhatja az elérhetőségét, és a kérés a
            címzetthez kerül
          </label>

          <div className="space-y-1">
            <label
              htmlFor="ai-chat-recipient"
              className="text-sm font-medium text-pilot-grey-800"
            >
              A kapcsolat-kérések címzettje
            </label>
            <PilotInput
              id="ai-chat-recipient"
              type="email"
              aria-label="Címzett e-mail címe"
              placeholder="kolléga@acropora.hu"
              value={settings.contactRecipientEmail ?? ""}
              onChange={(value) =>
                change({
                  contactRecipientEmail: value.trim() === "" ? null : value,
                })
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-pilot-grey-800">
                Üzenetek megőrzése (nap)
                <PilotInput
                  type="number"
                  aria-label="Üzenetek megőrzése (nap)"
                  min={messageLimits.min}
                  max={messageLimits.max}
                  value={
                    Number.isNaN(settings.messageRetentionDays)
                      ? ""
                      : String(settings.messageRetentionDays)
                  }
                  onChange={(value) =>
                    change({ messageRetentionDays: days(value) })
                  }
                />
              </label>
              <p className="text-xs text-pilot-grey-500">
                {messageLimits.min} és {messageLimits.max} nap között.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-pilot-grey-800">
                Kezelt kérés megőrzése (nap)
                <PilotInput
                  type="number"
                  aria-label="Kezelt kérés megőrzése (nap)"
                  min={requestLimits.min}
                  max={requestLimits.max}
                  value={
                    Number.isNaN(settings.contactHandledRetentionDays)
                      ? ""
                      : String(settings.contactHandledRetentionDays)
                  }
                  onChange={(value) =>
                    change({ contactHandledRetentionDays: days(value) })
                  }
                />
              </label>
              <p className="text-xs text-pilot-grey-500">
                {requestLimits.min} és {requestLimits.max} nap között.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-pilot-grey-800">
                Kezeletlen kérés megőrzése (nap)
                <PilotInput
                  type="number"
                  aria-label="Kezeletlen kérés megőrzése (nap)"
                  min={requestLimits.min}
                  max={requestLimits.max}
                  value={
                    Number.isNaN(settings.contactUnhandledRetentionDays)
                      ? ""
                      : String(settings.contactUnhandledRetentionDays)
                  }
                  onChange={(value) =>
                    change({ contactUnhandledRetentionDays: days(value) })
                  }
                />
              </label>
              <p className="text-xs text-pilot-grey-500">
                Legfeljebb ennyi ideig, és nem rövidebb a kezeltnél.
              </p>
            </div>
          </div>

          <div className="space-y-1 sm:max-w-xs">
            <label className="text-sm font-medium text-pilot-grey-800">
              Témán kívüli kérdések küszöbe
              <PilotInput
                type="number"
                aria-label="Témán kívüli kérdések küszöbe"
                min={offTopicLimits.min}
                max={offTopicLimits.max}
                value={
                  Number.isNaN(settings.offTopicFirmAt)
                    ? ""
                    : String(settings.offTopicFirmAt)
                }
                onChange={(value) => change({ offTopicFirmAt: days(value) })}
              />
            </label>
            <p className="text-xs text-pilot-grey-500">
              Ennyi egymás utáni témán kívüli kérdéstől határozottabb a válasz (
              {offTopicLimits.min} és {offTopicLimits.max} között).
            </p>
          </div>

          {problem ? (
            <p role="alert" className="text-sm text-pilot-red-700">
              {problem}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <PilotButton
              disabled={busy || Boolean(problem)}
              onClick={() => void save()}
            >
              Mentés
            </PilotButton>
            {saved ? (
              <span role="status" className="text-sm text-pilot-grey-600">
                Mentve.
              </span>
            ) : null}
          </div>
        </PilotCard>
      ) : null}
      {canManage ? <AiContactRequestsSection token={token} /> : null}
    </PilotThemeRoot>
  );
}
