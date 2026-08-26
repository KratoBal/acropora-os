"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type NavConnectionCredentialInput,
  type NavConnectionVerificationStatus,
  type NavConnectionView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { navConnectionApi } from "@/lib/api/nav-connection";

const STATUS_LABEL: Record<NavConnectionVerificationStatus, string> = {
  NEVER: "Nincs ellenőrizve",
  SUCCESS: "Sikeres",
  FAILED: "Sikertelen",
  STALE: "Elavult",
};
const STATUS_VARIANT: Record<
  NavConnectionVerificationStatus,
  "neutral" | "success" | "danger" | "warning"
> = {
  NEVER: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
  STALE: "warning",
};

const ERROR_MESSAGES: Record<string, string> = {
  NAV_CONNECTION_CONFIGURATION_MISSING:
    "A NAV kapcsolat alaprekordja hiányzik az adatbázisból. Fordulj a fejlesztőkhöz.",
  NAV_CONNECTION_NOT_CONFIGURED:
    "Nincs teljes NAV technikai felhasználói adatcsomag beállítva.",
  NAV_CONNECTION_DISABLED: "A NAV kapcsolat le van tiltva.",
  NAV_CREDENTIAL_INPUT_INVALID:
    "Ellenőrizd az összes mezőt. Az adószámok 8, a szoftverazonosító 18 karakteres legyen.",
  NAV_CONNECTION_RATE_LIMITED:
    "Túl sok kérés érkezett röviden belül. Várj egy kicsit, mielőtt újra próbálkozol.",
  NAV_CONNECTION_AUTH_REJECTED:
    "A NAV elutasította a hitelesítést. Ellenőrizd a technikai felhasználó adatait.",
  NAV_CONNECTION_API_REJECTED:
    "A NAV elutasította a lekérdezést. Ellenőrizd a technikai felhasználó Számla lekérdezés jogosultságát és az aláírókulcsot.",
  NAV_CONNECTION_NETWORK_FAILED:
    "A NAV Online Számla szolgáltatás nem érhető el hálózati hiba miatt.",
  NAV_CONNECTION_TIMEOUT:
    "A NAV Online Számla szolgáltatás nem válaszolt időben.",
  NAV_CONNECTION_HTTP_4XX: "A NAV elutasította a kérést.",
  NAV_CONNECTION_HTTP_5XX:
    "A NAV szolgáltatása szerverhiba miatt nem válaszolt.",
  NAV_CONNECTION_RESPONSE_INVALID: "A NAV válasza nem a várt formátumú.",
  NAV_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED:
    "Hiányzik a szerveroldali NAV titkosítási kulcs. Ezt a Coolifyban kell beállítani.",
  NAV_CREDENTIAL_MASTER_KEY_INVALID:
    "A szerveroldali NAV titkosítási kulcs érvénytelen.",
  NAV_CREDENTIAL_KEY_VERSION_UNKNOWN: "Ismeretlen NAV titkosítási kulcsverzió.",
  NAV_CREDENTIAL_ENVELOPE_INVALID: "A tárolt NAV hitelesítőadat-csomag sérült.",
  NAV_CREDENTIAL_DECRYPT_FAILED:
    "A tárolt NAV hitelesítőadat-csomag nem fejthető vissza.",
  NAV_CONNECTION_FAILED: "Ismeretlen NAV kapcsolati hiba történt.",
};

const emptyInput = (): NavConnectionCredentialInput => ({
  technicalUserLogin: "",
  technicalUserPassword: "",
  technicalUserTaxNumber: "",
  technicalUserSignKey: "",
  softwareId: "",
  softwareDevName: "",
  softwareDevContact: "",
  softwareDevTaxNumber: "",
});

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

export function NavConnectionSettingsPage() {
  const { session } = useAuth();
  const [view, setView] = useState<NavConnectionView | null>(null);
  const [input, setInput] = useState<NavConnectionCredentialInput>(emptyInput);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const token = session?.token ?? "";
  const complete = Object.values(input).every((value) => value.trim());

  const change =
    (key: keyof NavConnectionCredentialInput) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setInput((current) => ({ ...current, [key]: event.target.value }));

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setLoading(true);
      setError(null);
      try {
        setView(await navConnectionApi.get(token, signal));
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
        title="Nincs hozzáférésed a NAV kapcsolat beállításaihoz"
        description="settings.manage jogosultság szükséges."
      />
    );

  const handleSave = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      setView(await navConnectionApi.replaceCredential(token, input));
      setInput(emptyInput());
      setNotice(
        "A NAV technikai felhasználó adatai sikeresen elmentve és a bejövő számla lekérdezéssel ellenőrizve.",
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
      const updated = await navConnectionApi.test(token);
      setView(updated);
      setNotice(
        updated.verification.status === "SUCCESS"
          ? "A NAV kapcsolat és a bejövő számla lekérdezési jogosultság működik."
          : null,
      );
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  const handleDisable = async () => {
    if (disabling) return;
    setConfirmDisable(false);
    setDisabling(true);
    setError(null);
    setNotice(null);
    try {
      setView(await navConnectionApi.disable(token));
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
        title="NAV kapcsolat"
        description="A NAV Online Számla technikai felhasználójának biztonságos kezelése. Az adatok titkosítva tárolódnak, és soha nem olvashatók vissza."
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
        <div aria-label="NAV kapcsolat állapotának betöltése">
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
                  Hitelesítőadat-csomag
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
                onClick={() => setConfirmDisable(true)}
              >
                {disabling ? "Letiltás…" : "Kapcsolat letiltása"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Technikai felhasználó és szoftveradatok
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Mentéskor a rendszer valódi bejövő számla digest-lekérdezéssel
              ellenőrzi a hitelesítést és a Számla lekérdezés jogosultságot.
              Cserekulcs ehhez a funkcióhoz nem szükséges.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="Technikai felhasználó login"
                htmlFor="nav-technical-login"
              >
                <Input
                  id="nav-technical-login"
                  autoComplete="off"
                  maxLength={100}
                  value={input.technicalUserLogin}
                  onChange={change("technicalUserLogin")}
                />
              </FormField>
              <FormField
                label="Technikai felhasználó jelszó"
                htmlFor="nav-technical-password"
              >
                <Input
                  id="nav-technical-password"
                  type="password"
                  autoComplete="new-password"
                  maxLength={256}
                  value={input.technicalUserPassword}
                  onChange={change("technicalUserPassword")}
                />
              </FormField>
              <FormField
                label="Saját adószám törzsszáma"
                htmlFor="nav-technical-tax-number"
                description="Az Acropora Kft. adószámának első 8 számjegye."
              >
                <Input
                  id="nav-technical-tax-number"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  value={input.technicalUserTaxNumber}
                  onChange={change("technicalUserTaxNumber")}
                />
              </FormField>
              <FormField label="Aláírókulcs" htmlFor="nav-sign-key">
                <Input
                  id="nav-sign-key"
                  type="password"
                  autoComplete="off"
                  maxLength={512}
                  value={input.technicalUserSignKey}
                  onChange={change("technicalUserSignKey")}
                />
              </FormField>
            </div>

            <div className="grid gap-4 border-t border-slate-100 pt-6 md:grid-cols-2">
              <FormField
                label="Szoftverazonosító"
                htmlFor="nav-software-id"
                description="A NAV Online Számla kérésben használt 18 karakteres azonosító."
              >
                <Input
                  id="nav-software-id"
                  autoComplete="off"
                  minLength={18}
                  maxLength={18}
                  value={input.softwareId}
                  onChange={change("softwareId")}
                />
              </FormField>
              <FormField
                label="Szoftver fejlesztőjének neve"
                htmlFor="nav-software-dev-name"
              >
                <Input
                  id="nav-software-dev-name"
                  autoComplete="organization"
                  maxLength={512}
                  value={input.softwareDevName}
                  onChange={change("softwareDevName")}
                />
              </FormField>
              <FormField
                label="Fejlesztő kapcsolattartója"
                htmlFor="nav-software-dev-contact"
                description="Kapcsolattartó e-mail-címe vagy elérhetősége."
              >
                <Input
                  id="nav-software-dev-contact"
                  autoComplete="email"
                  maxLength={512}
                  value={input.softwareDevContact}
                  onChange={change("softwareDevContact")}
                />
              </FormField>
              <FormField
                label="Fejlesztő adószámának törzsszáma"
                htmlFor="nav-software-dev-tax-number"
              >
                <Input
                  id="nav-software-dev-tax-number"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  value={input.softwareDevTaxNumber}
                  onChange={change("softwareDevTaxNumber")}
                />
              </FormField>
            </div>

            <Button type="submit" disabled={saving || !complete}>
              {saving ? "Mentés és ellenőrzés…" : "Mentés és ellenőrzés"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDisable}
        title="Letiltod a NAV kapcsolatot?"
        consequence="Leáll az adószám-lekérdezés és a bejövő számlák szinkronja is: új NAV-számla nem érkezik be, amíg a kapcsolat le van tiltva."
        recovery="Visszakapcsolható, de csak a NAV technikai felhasználó adatainak újbóli megadásával: a mostani adatok a letiltással törlődnek."
        confirmLabel="Kapcsolat letiltása"
        busy={disabling}
        onConfirm={() => void handleDisable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </div>
  );
}
