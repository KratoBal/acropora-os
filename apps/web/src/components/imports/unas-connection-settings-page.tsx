"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormField,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type UnasConnectionVerificationStatus,
  type UnasConnectionView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { unasConnectionApi } from "@/lib/api/unas-connection";

const STATUS_LABEL: Record<UnasConnectionVerificationStatus, string> = {
  NEVER: "Nincs ellenőrizve",
  SUCCESS: "Sikeres",
  FAILED: "Sikertelen",
  INDETERMINATE: "Bizonytalan",
  STALE: "Elavult",
};
const STATUS_VARIANT: Record<
  UnasConnectionVerificationStatus,
  "neutral" | "success" | "danger" | "warning"
> = {
  NEVER: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
  INDETERMINATE: "warning",
  STALE: "warning",
};

const ERROR_MESSAGES: Record<string, string> = {
  UNAS_CONNECTION_CONFIGURATION_MISSING:
    "A kapcsolat alaprekordja hiányzik az adatbázisból. Fordulj a fejlesztőkhöz.",
  UNAS_CONNECTION_NOT_CONFIGURED: "Nincs beállítva UNAS API-kulcs.",
  UNAS_CONNECTION_DISABLED: "A kapcsolat le van tiltva.",
  UNAS_CREDENTIAL_INPUT_INVALID: "Érvénytelen API-kulcs formátum.",
  UNAS_CONNECTION_RATE_LIMITED:
    "Túl sok kérés érkezett röviden belül. Várj egy kicsit, mielőtt újra próbálkozol.",
  UNAS_CONNECTION_AUTH_REJECTED:
    "Az UNAS elutasította a bejelentkezést – ellenőrizd az API-kulcsot.",
  UNAS_CONNECTION_PERMISSION_MISSING:
    "Az API-kulcshoz hiányzik a termék- vagy kategórialekérési jogosultság az UNAS oldalán.",
  UNAS_CONNECTION_RESPONSE_INVALID: "Az UNAS válasza nem a várt formátumú.",
  UNAS_CONNECTION_NETWORK_FAILED: "Az UNAS nem érhető el hálózati hiba miatt.",
  UNAS_CONNECTION_TIMEOUT: "Az UNAS nem válaszolt időben.",
  UNAS_CONNECTION_HTTP_4XX: "Az UNAS elutasította a kérést.",
  UNAS_CONNECTION_HTTP_5XX: "Az UNAS szerverhiba miatt nem válaszolt.",
  UNAS_CONNECTION_RATE_LIMITED_UPSTREAM:
    "Az UNAS oldali rate limitbe ütköztünk.",
  UNAS_CONNECTION_API_REJECTED: "Az UNAS elutasította a kérést.",
  UNAS_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED:
    "Hiányzik a szerveroldali titkosítási kulcs. Fordulj a fejlesztőkhöz.",
  UNAS_CREDENTIAL_MASTER_KEY_INVALID:
    "A szerveroldali titkosítási kulcs érvénytelen. Fordulj a fejlesztőkhöz.",
  UNAS_CREDENTIAL_KEY_VERSION_UNKNOWN:
    "Ismeretlen titkosítási kulcsverzió. Fordulj a fejlesztőkhöz.",
  UNAS_CREDENTIAL_ENVELOPE_INVALID:
    "A tárolt credential sérült. Fordulj a fejlesztőkhöz.",
  UNAS_CREDENTIAL_DECRYPT_FAILED:
    "A tárolt credential nem fejthető vissza. Fordulj a fejlesztőkhöz.",
  UNAS_CONNECTION_FAILED: "Ismeretlen hiba történt.",
};

function friendlyMessage(cause: unknown): string {
  if (cause instanceof ApiError)
    return ERROR_MESSAGES[cause.message] ?? cause.message;
  return cause instanceof Error
    ? (ERROR_MESSAGES[cause.message] ?? cause.message)
    : "Ismeretlen hiba történt.";
}

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";

export function UnasConnectionSettingsPage() {
  const { session } = useAuth();
  const [view, setView] = useState<UnasConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setLoading(true);
      setError(null);
      try {
        setView(await unasConnectionApi.get(token, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(friendlyMessage(cause));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, token],
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
        title="Nincs hozzáférésed az UNAS kapcsolat beállításaihoz"
        description="settings.manage jogosultság szükséges."
      />
    );

  const handleSave = async () => {
    const apiKey = apiKeyInput.trim();
    if (!apiKey || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await unasConnectionApi.replaceCredential(token, apiKey);
      setView(updated);
      setApiKeyInput("");
      setNotice(
        updated.verification.status === "INDETERMINATE"
          ? "Az API-kulcs elmentve. A jogosultság-ellenőrzés eredménye bizonytalan, lásd az állapotot lent."
          : "Az API-kulcs sikeresen elmentve és ellenőrizve.",
      );
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      setView(await unasConnectionApi.test(token));
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  const handleDisable = async () => {
    if (disabling) return;
    if (
      !window.confirm(
        "Biztosan letiltod az UNAS-kapcsolatot? Ezután a manuális és ütemezett szinkron sem fog működni, amíg új kulcsot nem mentesz.",
      )
    )
      return;
    setDisabling(true);
    setError(null);
    setNotice(null);
    try {
      setView(await unasConnectionApi.disable(token));
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Integráció"
        title="UNAS kapcsolat"
        description="Az UNAS API-kulcs adatbázisban, titkosítva tárolt kezelése. A kulcs soha nem olvasható vissza; csak fix maszk és ellenőrzési állapot jelenik meg."
        actions={
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            Frissítés
          </Button>
        }
      />

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}
      {notice ? <Alert variant="info" title={notice} /> : null}

      {loading && !view ? (
        <div aria-label="Kapcsolat állapotának betöltése" className="space-y-3">
          <Skeleton className="h-40" />
        </div>
      ) : null}

      {view ? (
        <Card>
          <CardHeader>
            <p className="text-sm font-semibold text-slate-800">Állapot</p>
            <Badge variant={view.configured ? "success" : "neutral"}>
              {view.configured ? "Beállítva" : "Nincs beállítva"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  API-kulcs
                </dt>
                <dd className="mt-1 font-mono text-sm text-slate-900">
                  {view.masked ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Utolsó módosítás
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {dateTime(view.modifiedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Ellenőrzés állapota
                </dt>
                <dd className="mt-1">
                  <Badge variant={STATUS_VARIANT[view.verification.status]}>
                    {STATUS_LABEL[view.verification.status]}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">
                  Utolsó ellenőrzés
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {dateTime(view.verification.checkedAt)}
                </dd>
              </div>
            </dl>
            {view.verification.code ? (
              <p className="font-mono text-xs text-rose-700">
                {view.verification.code}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                disabled={!view.configured || testing}
                onClick={() => void handleTest()}
              >
                {testing ? "Tesztelés…" : "Kapcsolat tesztelése"}
              </Button>
              <Button
                variant="danger"
                disabled={!view.configured || disabling}
                onClick={() => void handleDisable()}
              >
                {disabling ? "Letiltás…" : "Kapcsolat letiltása"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <p className="text-sm font-semibold text-slate-800">
            Új API-kulcs mentése
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <FormField
              label="UNAS API-kulcs"
              htmlFor="unas-api-key"
              description="A mentés előtt a rendszer egy read-only bejelentkezéssel ellenőrzi a kulcsot az UNAS-nál. A kulcs csak titkosítva kerül adatbázisba, és soha nem olvasható vissza."
            >
              <Input
                id="unas-api-key"
                type="password"
                autoComplete="off"
                maxLength={4096}
                placeholder="••••••••"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={saving || !apiKeyInput.trim()}>
              {saving ? "Mentés…" : "Mentés"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
