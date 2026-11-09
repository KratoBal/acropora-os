"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotCard,
  PilotSelect,
  PilotButton,
} from "@acropora/ui";
import type {
  PartnerMigrationPlan,
  PartnerMigrationRestorePreview,
  PartnerMigrationRunPreview,
} from "@acropora/types";
import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import { partnerMigrationApi } from "@/lib/api/partner-migration";

/**
 * AZ ÁTVEZETÉS FUTTATÁSA AZ OLDALRÓL (ugyanaz a mag, mint a `partner:migrate` parancs). A sorrend: PRÓBA (nem ír, kiírja a célzott
 * adatbázist és a lenyomatot), aztán az ÍRÁS megerősítő ablakkal, ami a próba lenyomatát küldi vissza. Ha a terv közben változott,
 * a szerver 409-et ad, és új próba kell. A VISSZAÁLLÍTÁS ugyanígy: próba, megerősítés, a próba lenyomatával.
 */
const RESULT_LABEL = { RESTORED: "visszaáll", KEPT: "marad" } as const;
const MODE_LABEL = {
  CREATED: "új vevő-sor készült",
  BOUND: "meglévő vevő-sorhoz kötve",
  SKIPPED: "kimaradt",
} as const;

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

export function PartnerMigrationRunSection({
  token,
  plan,
  onChanged,
}: {
  token: string;
  plan: PartnerMigrationPlan;
  onChanged: () => void;
}) {
  const [binds, setBinds] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PartnerMigrationRunPreview | null>(
    null,
  );
  const [restorePreview, setRestorePreview] =
    useState<PartnerMigrationRestorePreview | null>(null);
  const [confirming, setConfirming] = useState<"apply" | "restore" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  const ambiguous = plan.rows.filter(
    (row) => row.action === "BIND_AMBIGUOUS" && !row.linkedCustomer,
  );

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // a terv vagy a visszaállítandó halmaz közben változott: a lenyomat elavult, új próba kell
        setPreview(null);
        setRestorePreview(null);
      }
      setError(messageOf(cause, "A művelet nem sikerült."));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const chooseBind = (code: string, customerId: string) => {
    setBinds((current) => {
      const next = { ...current };
      if (customerId) next[code] = customerId;
      else delete next[code];
      return next;
    });
    // más döntés, más lenyomat: a régi próba nem érvényes
    setPreview(null);
  };

  const runPreview = () =>
    guard(async () => {
      setPreview(await partnerMigrationApi.preview(token, binds));
    });
  const runApply = () =>
    guard(async () => {
      if (!preview) return;
      const result = await partnerMigrationApi.apply(token, {
        fingerprint: preview.fingerprint,
        binds,
      });
      setPreview(null);
      // a sikeres írás után a régi visszaállítási próba elavult (más halmazt látott): új próba kell
      setRestorePreview(null);
      setDone(
        result.outcomes.map(
          (o) =>
            `${o.code}: ${MODE_LABEL[o.mode]}${o.detail ? ` (${o.detail})` : ""}`,
        ),
      );
      onChanged();
    });
  const runRestorePreview = () =>
    guard(async () => {
      setRestorePreview(await partnerMigrationApi.restorePreview(token));
    });
  const runRestore = () =>
    guard(async () => {
      if (!restorePreview) return;
      const result = await partnerMigrationApi.restoreApply(token, {
        fingerprint: restorePreview.fingerprint,
      });
      setRestorePreview(null);
      // és a visszaállítás után a régi átvezetési próba is elavult
      setPreview(null);
      setDone(
        result.outcomes.map(
          (o) =>
            `${o.supplierId}: ${RESULT_LABEL[o.result]}${o.detail ? ` (${o.detail})` : ""}`,
        ),
      );
      onChanged();
    });

  const writes = preview ? preview.counts.create + preview.counts.bind : 0;

  return (
    <PilotCard>
      <div className="space-y-4 px-5 py-4" data-testid="migration-run">
        <div>
          <h2 className="text-sm font-semibold text-pilot-grey-900">
            Átvezetés futtatása
          </h2>
          <p className="text-xs text-pilot-grey-600">
            Előbb Próba (semmi nem íródik, kiírja a célzott adatbázist és a
            lenyomatot), utána az Átvezetés, ami csak a próba lenyomatával fut.
          </p>
        </div>

        {ambiguous.length ? (
          <div className="space-y-2" data-testid="migration-binds">
            <p className="text-xs font-semibold text-pilot-grey-800">
              Több jelölt van, te döntöd el, melyik vevő-sorhoz kötődjön (döntés
              nélkül a partner kimarad):
            </p>
            {ambiguous.map((row) => (
              <label
                key={row.supplierId}
                className="flex flex-col gap-1 text-xs text-pilot-grey-700 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-48 font-semibold">{row.name}</span>
                <PilotSelect
                  className="w-full sm:w-96"
                  aria-label={`Vevő-sor a(z) ${row.name} partnerhez`}
                  value={binds[row.code] ?? ""}
                  onChange={(value) => chooseBind(row.code, value)}
                >
                  <option value="">(kimarad)</option>
                  {row.candidates.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.displayName} · {customer.customerNumber} ·{" "}
                      {customer.references} hivatkozás
                    </option>
                  ))}
                </PilotSelect>
              </label>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <PilotButton variant="secondary" disabled={busy} onClick={runPreview}>
            Próba
          </PilotButton>
          <PilotButton
            disabled={
              busy || !preview || preview.problems.length > 0 || writes === 0
            }
            title={
              !preview
                ? "Előbb futtass próbát"
                : writes === 0
                  ? "A próba szerint nincs mit átvezetni"
                  : undefined
            }
            onClick={() => setConfirming("apply")}
          >
            Átvezetés végrehajtása
          </PilotButton>
          <PilotButton
            variant="secondary"
            disabled={busy}
            onClick={runRestorePreview}
          >
            Visszaállítási próba
          </PilotButton>
          <PilotButton
            variant="danger"
            disabled={
              busy ||
              !restorePreview ||
              !restorePreview.outcomes.some((o) => o.result === "RESTORED")
            }
            title={
              !restorePreview
                ? "Előbb futtass visszaállítási próbát"
                : undefined
            }
            onClick={() => setConfirming("restore")}
          >
            Visszaállítás
          </PilotButton>
        </div>

        {error ? (
          <Alert
            variant="danger"
            title="A művelet nem futott le"
            description={error}
          />
        ) : null}

        {preview ? (
          <div className="space-y-2" data-testid="migration-preview">
            <p className="text-xs text-pilot-grey-700">
              Célzott adatbázis:{" "}
              <span className="font-mono font-semibold">{preview.target}</span>
            </p>
            <p className="text-sm text-pilot-grey-800">
              {preview.counts.create} új vevő-sor, {preview.counts.bind} kötés
              meglévőhöz, {preview.counts.skip} kimarad.
            </p>
            {preview.problems.map((problem) => (
              <Alert
                key={problem}
                variant="danger"
                title="Hibás döntés"
                description={problem}
              />
            ))}
            <ul className="divide-y divide-pilot-grey-100 text-xs text-pilot-grey-700">
              {preview.operations.map((op) => (
                <li key={op.supplierId} className="flex gap-2 py-1">
                  <span className="font-mono">{op.code}</span>
                  <PilotBadge variant={op.kind === "SKIP" ? "grey" : "blue"}>
                    {op.kind === "CREATE"
                      ? "új sor"
                      : op.kind === "BIND"
                        ? "kötés"
                        : "kimarad"}
                  </PilotBadge>
                  <span>{op.reason ?? ""}</span>
                </li>
              ))}
            </ul>
            <p className="font-mono text-[11px] text-pilot-grey-500">
              Lenyomat: {preview.fingerprint.slice(0, 16)}…
            </p>
          </div>
        ) : null}

        {restorePreview ? (
          <div className="space-y-2" data-testid="migration-restore-preview">
            <p className="text-xs text-pilot-grey-700">
              Célzott adatbázis:{" "}
              <span className="font-mono font-semibold">
                {restorePreview.target}
              </span>
            </p>
            {restorePreview.outcomes.length ? (
              <ul className="divide-y divide-pilot-grey-100 text-xs text-pilot-grey-700">
                {restorePreview.outcomes.map((o) => (
                  <li key={o.supplierId} className="py-1">
                    <span className="font-mono">{o.supplierId}</span>:{" "}
                    {RESULT_LABEL[o.result]}
                    {o.detail ? ` (${o.detail})` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-pilot-grey-600">
                Nincs visszaállítandó átvezetés.
              </p>
            )}
          </div>
        ) : null}

        {done ? (
          <Alert
            variant="info"
            title="Kész"
            description={done.join(" · ") || "Nem volt végrehajtandó sor."}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming === "apply" && preview !== null}
        title="Végrehajtod a partnerek átvezetését?"
        consequence={`A(z) ${preview?.target ?? ""} adatbázison: ${preview?.counts.create ?? 0} új vevő-sor készül, ${preview?.counts.bind ?? 0} partner meglévő vevő-sorhoz kötődik, ${preview?.counts.skip ?? 0} kimarad. Egy tranzakcióban fut: vagy minden megtörténik, vagy semmi.`}
        recovery="A Visszaállítási próba, majd a Visszaállítás a naplózott eseményekből visszaviszi: a létrehozott sorok törlődnek, ha azóta semmi nem hivatkozik rájuk."
        confirmLabel="Átvezetés végrehajtása"
        busy={busy}
        onConfirm={() => void runApply()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "restore" && restorePreview !== null}
        title="Visszaállítod az átvezetést?"
        consequence={`A(z) ${restorePreview?.target ?? ""} adatbázison ${restorePreview?.outcomes.filter((o) => o.result === "RESTORED").length ?? 0} partner átvezetése áll vissza (a próbán látott lista szerint), ${restorePreview?.outcomes.filter((o) => o.result === "KEPT").length ?? 0} marad.`}
        recovery="Az átvezetés újra végrehajtható a Próba és az Átvezetés végrehajtása gombbal; a törölt, hivatkozás nélküli vevő-sorok azonosítója új lesz."
        confirmLabel="Visszaállítás"
        busy={busy}
        onConfirm={() => void runRestore()}
        onCancel={() => setConfirming(null)}
      />
    </PilotCard>
  );
}
