"use client";

import {
  Alert,
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
  type SzamlazzConnectionView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { szamlazzConnectionApi } from "@/lib/api/szamlazz-connection";

/**
 * A SZÁMLÁZZ.HU AGENT KEY BEÁLLÍTÁSA (ADR-014, karbantartási piszkozat-számla).
 *
 * A Medusa kapcsolat-oldal mintája, EGY szándékos hiánnyal: nincs "Kapcsolat
 * ellenőrzése" gomb és nincs állapot-jelvény. A Számlázz.hu Agent API-nak
 * nincs ártalmatlan próba-végpontja -- az egyetlen mód a kulcs kipróbálására
 * egy VALÓDI előnézet-kérés, amit a karbantartási piszkozat-számla készítése
 * indít, nem ez az oldal (lásd az API oldali
 * `szamlazz-connection.service.ts` doc-commentjét).
 */
function friendlyMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.message.includes("SZAMLAZZ_CONNECTION_COOLDOWN"))
      return "Túl gyakori próbálkozás. Várj egy kicsit, és próbáld újra.";
    if (cause.message.includes("SZAMLAZZ_CREDENTIAL_INPUT_INVALID"))
      return "A megadott kulcs alakja nem megfelelő.";
    return cause.message;
  }
  return "A művelet nem sikerült.";
}

export function SzamlazzConnectionSettingsPage() {
  const { session } = useAuth();
  const [view, setView] = useState<SzamlazzConnectionView | null>(null);
  const [agentKey, setAgentKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
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
        setView(await szamlazzConnectionApi.get(token, signal));
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
        title="Nincs hozzáférésed a Számlázz.hu kapcsolat beállításaihoz"
        description="settings.manage jogosultság szükséges."
      />
    );

  const handleSave = async () => {
    if (!agentKey.trim() || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await szamlazzConnectionApi.replaceCredential(token, {
        agentKey,
      });
      setView(saved);
      // A beírt érték azonnal eltűnik: nincs miért a memóriában maradnia.
      setAgentKey("");
      setNotice(
        "Az Agent Key elmentve. A kulcs kipróbálása a piszkozat-számla első készítésekor történik meg.",
      );
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (disabling) return;
    setConfirmDisable(false);
    setDisabling(true);
    setError(null);
    setNotice(null);
    try {
      setView(await szamlazzConnectionApi.disable(token));
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
        title="Számlázz.hu kapcsolat"
        description="Az Agent Key beállítása a karbantartási piszkozat-számlához."
      />

      {error ? <Alert variant="danger" title={error} /> : null}
      {notice ? <Alert variant="info" title={notice} /> : null}

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : view ? (
        <Card>
          <CardHeader>
            <span className="font-medium">Állapot</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Tárolt kulcs</dt>
                <dd>{view.masked ?? "nincs"}</dd>
              </div>
              {view.modifiedAt ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Utoljára módosítva</dt>
                  <dd>{new Date(view.modifiedAt).toLocaleString("hu-HU")}</dd>
                </div>
              ) : null}
            </dl>

            <Alert
              variant="info"
              title="Nincs önálló ellenőrzés"
              description="A Számlázz.hu Agent API-nak nincs ártalmatlan próba-végpontja: a kulcs kipróbálása a karbantartási piszkozat-számla első készítésekor, egy VALÓDI előnézet-kéréssel történik."
            />

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={disabling || !view.configured}
                onClick={() => setConfirmDisable(true)}
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
            <FormField label="Agent Key" htmlFor="szamlazz-agent-key">
              <Input
                id="szamlazz-agent-key"
                type="password"
                autoComplete="off"
                value={agentKey}
                placeholder={
                  view?.configured
                    ? "A meglévő kulcs nem olvasható vissza"
                    : "Számlázz.hu Agent Key"
                }
                onChange={(event) => setAgentKey(event.target.value)}
              />
            </FormField>
            <p className="text-sm text-muted">
              A beállított kulcs soha nem olvasható vissza: csak felülírni vagy
              letiltani lehet.
            </p>
            <Button type="submit" disabled={!agentKey.trim() || saving}>
              {saving ? "Mentés..." : "Mentés"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDisable}
        title="Letiltod a Számlázz.hu kapcsolatot?"
        consequence="A tárolt Agent Key törlődik, és a karbantartási piszkozat-számla készítése leáll, amíg új kulcs nem kerül beállításra."
        recovery="Visszakapcsolható, de csak az Agent Key újbóli megadásával: a mostani kulcs a letiltással véglegesen törlődik, visszaolvasni nem lehet."
        confirmLabel="Kapcsolat letiltása"
        busy={disabling}
        onConfirm={() => void handleDisable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </div>
  );
}
