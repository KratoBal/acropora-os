"use client";

import {
  Alert,
  ConfirmDialog,
  PageHeader,
  PilotButton,
  PilotCard,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  shippingFillApi,
  type ShippingFillApplyResult,
  type ShippingFillFlag,
  type ShippingFillPreview,
} from "@/lib/api/shipping-fill";

const FLAG_LABELS: Record<ShippingFillFlag, string> = {
  pickupOnly: "Csak üzletben vehető át",
  foxpostForbidden: "Foxpost nem ajánlható",
  isHeavy: "Nehéz áru",
  isFrozen: "Fagyasztott",
};

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

/**
 * A SZÁLLÍTÁSI JELZŐK EGYSZERI FELTÖLTÉSE (a82ed229; acrobot 43016: élesen Balázs nyomja, a flotta fiókjának nincs
 * `settings.manage` joga). Két lépés, ahogy a végpont: a PRÓBA csak olvas, és megmutatja a számokat, a cél-adatbázist
 * és az eltérő kézi jelzők számát; a FELTÖLTÉS a próba lenyomatával megy, és ha közben bármi változott, a szerver
 * elutasítja (akkor újra kell próbálni). A kézzel állított jelzőhöz a feltöltés nem nyúl.
 */
export function ShippingFillPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [preview, setPreview] = useState<ShippingFillPreview | null>(null);
  const [result, setResult] = useState<ShippingFillApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed"
        description="A szállítási jelzők feltöltéséhez settings.manage jogosultság szükséges."
      />
    );

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await shippingFillApi.preview(token));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await shippingFillApi.apply(token, preview.fingerprint));
      setPreview(null);
    } catch (cause) {
      // a 409 a lenyomat-eltérés: a próbát újra kell futtatni
      setError(errorText(cause));
      setPreview(null);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const report = preview?.report;
  const changes = report ? report.create + report.update : 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Szállítási jelzők feltöltése"
        description="Egyszeri feltöltés a UNAS-ból: minden UNAS-os termék megkapja a szállítási jelzőit, UNAS forrással. A kézzel állított jelzőhöz nem nyúl. Előbb próba, utána írás."
      />
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {result ? (
        <Alert
          variant="info"
          title="Kész"
          description={`${result.created} új sor, ${result.updated} frissített (${result.target}).`}
        />
      ) : null}
      <PilotCard>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => void runPreview()}
            >
              Próba
            </PilotButton>
            <PilotButton
              disabled={busy || !preview || changes === 0}
              onClick={() => setConfirming(true)}
            >
              Feltöltés
            </PilotButton>
          </div>
          {preview && report ? (
            <dl
              className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2"
              data-testid="shipping-fill-preview"
            >
              <dt className="text-pilot-grey-600">Cél-adatbázis</dt>
              <dd className="font-mono">{preview.target}</dd>
              <dt className="text-pilot-grey-600">Termék a UNAS-tükörrel</dt>
              <dd>{report.products}</dd>
              <dt className="text-pilot-grey-600">Új sor</dt>
              <dd>{report.create}</dd>
              {report.createdFlags
                ? (Object.keys(FLAG_LABELS) as ShippingFillFlag[]).map(
                    (flag) => (
                      <div key={flag} className="contents">
                        <dt className="pl-3 text-pilot-grey-500">
                          {FLAG_LABELS[flag]}
                        </dt>
                        <dd data-testid={`shipping-fill-created-${flag}`}>
                          {report.createdFlags![flag]}
                        </dd>
                      </div>
                    ),
                  )
                : null}
              <dt className="text-pilot-grey-600">Frissül</dt>
              <dd>{report.update}</dd>
              {(Object.keys(FLAG_LABELS) as ShippingFillFlag[]).map((flag) => (
                <div key={flag} className="contents">
                  <dt className="pl-3 text-pilot-grey-500">
                    {FLAG_LABELS[flag]}
                  </dt>
                  <dd>{report.updatedFlags[flag]}</dd>
                </div>
              ))}
              <dt className="text-pilot-grey-600">Változatlan</dt>
              <dd>{report.unchanged}</dd>
              <dt className="text-pilot-grey-600">
                Kézi jelző, ami eltér a UNAS-étól (marad a kézi)
              </dt>
              <dd>{report.manualDiffersTotal}</dd>
            </dl>
          ) : (
            <p className="text-sm text-pilot-grey-500">
              A próba csak olvas: megmutatja, mi változna.
            </p>
          )}
        </div>
      </PilotCard>
      <ConfirmDialog
        open={confirming}
        title="Feltöltöd a szállítási jelzőket?"
        consequence={`${report?.create ?? 0} új sor és ${report?.update ?? 0} frissítés kerül ide: ${preview?.target ?? ""}.`}
        recovery="A kézzel állított jelzőkhöz nem nyúl. Ha a próba óta bármi változott, a szerver elutasítja, és újra kell próbálni."
        confirmLabel="Feltöltöm"
        busy={busy}
        onConfirm={() => void runApply()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
