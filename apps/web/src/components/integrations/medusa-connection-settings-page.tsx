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
  type MedusaConnectionView,
  type MedusaIntegrationStateKind,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { medusaConnectionApi } from "@/lib/api/medusa-connection";

/**
 * Az ÁLLAPOTOK feliratai.
 *
 * A kulcsok a szerver oldali állapotnevek, nem a felület saját fogalmai: ha itt
 * új nevet adnánk, ugyanannak a dolognak két neve lenne, és fél év múlva senki
 * nem tudná, melyik a mérvadó.
 *
 * Az elutasításnál a felirat sem állítja, hogy a kulcs rossz. A részletes
 * magyarázat a szervertől jön, és az mondja ki, hogy más ok is adhatja
 * ugyanazt a választ.
 */
const STATE_LABEL: Record<MedusaIntegrationStateKind, string> = {
  ready: "Működik",
  "not-configured": "Nincs beállítva",
  "credential-corrupt": "A tárolt kulcs sérült",
  unreachable: "A Medusa nem érhető el",
  "auth-or-permission-failure": "A Medusa elutasította a kérést",
};

const STATE_VARIANT: Record<
  MedusaIntegrationStateKind,
  "success" | "neutral" | "danger" | "warning"
> = {
  ready: "success",
  "not-configured": "neutral",
  "credential-corrupt": "danger",
  unreachable: "warning",
  "auth-or-permission-failure": "warning",
};

/**
 * AMIT AZ ELLENŐRZÉS UTÁN KIÍRUNK, A TÉNYLEGES EREDMÉNYBŐL.
 *
 * A mért hiba (2026-08-26): a felület a HTTP hívás sikerét jelentette be
 * ellenőrzésként. A végpont viszont akkor is 200-zal tér vissza, ha a próba
 * elbukott -- az eredmény az állapotban van, nem a státuszkódban. Így a
 * „Kapcsolat ellenőrizve" mondat megjelenhetett egy „A Medusa nem érhető el"
 * jelvény mellett, ugyanazon a képernyőn.
 *
 * Ezért a mondat innentől az ÁLLAPOTBÓL származik, és csak a `ready` ág
 * állítja, hogy az ellenőrzés sikerült.
 */
function verificationNotice(view: MedusaConnectionView): string {
  return view.state.kind === "ready"
    ? "A kapcsolat ellenőrizve: a Medusa válaszolt."
    : "Az ellenőrzés lefutott, de nem sikerült. Az eredmény az állapotnál látszik.";
}

function friendlyMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.message.includes("MEDUSA_CONNECTION_COOLDOWN"))
      return "Túl gyakori próbálkozás. Várj egy kicsit, és próbáld újra.";
    if (cause.message.includes("MEDUSA_CREDENTIAL_INPUT_INVALID"))
      return "A megadott kulcs alakja nem megfelelő.";
    return cause.message;
  }
  return "A művelet nem sikerült.";
}

export function MedusaConnectionSettingsPage() {
  const { session } = useAuth();
  const [view, setView] = useState<MedusaConnectionView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        setView(await medusaConnectionApi.get(token, signal));
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
        title="Nincs hozzáférésed a Medusa kapcsolat beállításaihoz"
        description="settings.manage jogosultság szükséges."
      />
    );

  const handleSave = async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await medusaConnectionApi.replaceCredential(token, {
        apiKey,
      });
      setView(saved);
      // A beírt érték azonnal eltűnik: nincs miért a memóriában maradnia.
      setApiKey("");
      setNotice(`A kulcs elmentve. ${verificationNotice(saved)}`);
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
      const tested = await medusaConnectionApi.test(token);
      setView(tested);
      setNotice(verificationNotice(tested));
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setTesting(false);
    }
  };

  const handleDisable = async () => {
    if (disabling) return;
    setDisabling(true);
    setError(null);
    setNotice(null);
    try {
      setView(await medusaConnectionApi.disable(token));
      setNotice("A kapcsolat letiltva, a tárolt kulcs törölve.");
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medusa kapcsolat"
        description="A webshop-motor admin kulcsának beállítása és ellenőrzése."
      />

      {error ? <Alert variant="danger" title={error} /> : null}
      {notice ? <Alert variant="info" title={notice} /> : null}

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : view ? (
        <Card>
          <CardHeader>
            <span className="font-medium">Állapot</span>
            <Badge variant={STATE_VARIANT[view.state.kind]}>
              {STATE_LABEL[view.state.kind]}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Tárolt kulcs</dt>
                <dd>{view.masked ?? "nincs"}</dd>
              </div>
              {view.modifiedAt ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Utoljára módosítva</dt>
                  <dd>{new Date(view.modifiedAt).toLocaleString("hu-HU")}</dd>
                </div>
              ) : null}
              {/*
                EZ A SOR MINDIG LÁTSZIK, akkor is, ha még nem volt ellenőrzés.
                A fenti jelvény a TÁROLT kulcs épségéről szól, és a lap
                betöltésekor hálózat nélkül készül -- vagyis a „Működik" felirat
                nem jelenti azt, hogy bárki megkérdezte volna a Medusát. Amíg ez
                a sor elrejtőzött, a két dolog egybeolvadt, és pontosan az a
                félrevezetés állt elő, amit a Medusa `last_used_at` mezőjénél
                leletként neveztünk meg.
              */}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Utolsó ellenőrzés</dt>
                <dd>
                  {view.verification.checkedAt
                    ? new Date(view.verification.checkedAt).toLocaleString(
                        "hu-HU",
                      )
                    : "még nem volt ellenőrizve"}
                </dd>
              </div>
            </dl>

            {/*
              A TARTALÉK ÚT nem egészséges alapértelmezés, hanem átmeneti
              állapot: egy tartalék, ami működik, észrevétlenül állandósul.
              Ezért kap saját, figyelmeztető dobozt, és nem csak egy címkét.
            */}
            {view.state.source === "env" ? (
              <Alert
                variant="info"
                title="A kulcs a környezeti változóból jön (tartalék út)"
                description="Ez átmeneti állapot: a titok a futó folyamat környezetében él. Állíts be tárolt kulcsot, hogy a tartalékra ne legyen szükség."
              />
            ) : null}

            {view.state.source === "database" ? (
              <Alert
                variant="info"
                title="A kulcs a tárolóból jön"
                description="A titok titkosítva áll az adatbázisban, és nem olvasható vissza."
              />
            ) : null}

            {view.state.detail ? (
              <Alert
                variant="danger"
                title="Részletek"
                description={view.state.detail}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={testing}
                onClick={() => void handleTest()}
              >
                {testing ? "Ellenőrzés..." : "Kapcsolat ellenőrzése"}
              </Button>
              <Button
                variant="ghost"
                disabled={disabling || !view.configured}
                onClick={() => void handleDisable()}
              >
                {disabling ? "Letiltás..." : "Kapcsolat letiltása"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <span className="font-medium">
            {view?.configured ? "Kulcs cseréje" : "Kulcs beállítása"}
          </span>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <FormField label="Titkos admin kulcs" htmlFor="medusa-api-key">
              <Input
                id="medusa-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={
                  view?.configured
                    ? "A meglévő kulcs nem olvasható vissza"
                    : "sk_..."
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
            </FormField>
            <p className="text-sm text-muted-foreground">
              A beállított kulcs soha nem olvasható vissza: csak felülírni,
              ellenőrizni vagy letiltani lehet.
            </p>
            <Button type="submit" disabled={!apiKey.trim() || saving}>
              {saving ? "Mentés..." : "Mentés"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
