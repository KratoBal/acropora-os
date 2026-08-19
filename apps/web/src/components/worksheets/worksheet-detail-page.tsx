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
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetDetail,
  type WorksheetSignatureDecision,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";
import { WorksheetAssigneeEditor } from "./worksheet-assignee-editor";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusVariant,
} from "./worksheet-labels";

export function WorksheetDetailPage({ worksheetId }: { worksheetId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );

  const [worksheet, setWorksheet] = useState<WorksheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState({
    decision: "ACCEPTED" as WorksheetSignatureDecision,
    signerName: "",
    note: "",
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setWorksheet(await worksheetsApi.detail(token, worksheetId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalap nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, token, worksheetId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (action: () => Promise<WorksheetDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setWorksheet(await action());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a munkalapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !worksheet)
    return (
      <div className="space-y-3" aria-label="Munkalap betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  if (!worksheet)
    return (
      <Alert
        variant="danger"
        title="A munkalap nem tölthető be"
        description={error ?? "Ismeretlen hiba."}
      />
    );

  const current = worksheet.currentVersion;
  const isDraft = current.status === "DRAFT";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz / Munkalap"
        title={worksheetLabelOrDraft(current.label)}
        description={current.subject}
        actions={
          <div className="flex gap-2">
            <Link href="/szerviz/munkalapok">
              <Button variant="secondary">Vissza a listához</Button>
            </Link>
            {canManage && isDraft ? (
              <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
                <Button variant="secondary">Szerkesztés</Button>
              </Link>
            ) : null}
            {canManage && isDraft ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => worksheetsApi.close(token, worksheet.id))
                }
              >
                Lezárás
              </Button>
            ) : null}
          </div>
        }
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={worksheetStatusVariant(current.status)}>
              {worksheetStatusLabel[current.status]}
            </Badge>
            <span className="text-sm text-slate-500">
              {worksheet.versions.length} verzió
            </span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Partner</dt>
              <dd className="font-medium">{worksheet.customer.displayName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Alegység</dt>
              <dd className="font-medium">
                {worksheet.department.code} — {current.unitName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Keltezés</dt>
              <dd>{formatDate(current.issueDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Teljesítés</dt>
              <dd>{formatDate(current.fulfillmentDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Határidő</dt>
              <dd>{formatDate(current.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Felvette</dt>
              <dd>{worksheet.createdByName ?? "—"}</dd>
            </div>
          </dl>
          {current.description ? (
            <p className="whitespace-pre-line text-sm text-slate-700">
              {current.description}
            </p>
          ) : null}
        </Card>

        <WorksheetAssigneeEditor
          worksheetId={worksheet.id}
          token={token}
          assignees={worksheet.assignees}
          canManage={canManage}
          onSaved={setWorksheet}
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">#</th>
              <th>Megnevezés</th>
              <th className="text-right">Mennyiség</th>
              <th>Egység</th>
              <th className="text-right">Egységár</th>
              <th className="text-right">ÁFA %</th>
              <th className="p-3 text-right">Nettó</th>
            </tr>
          </thead>
          <tbody>
            {current.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="p-3">{line.position}</td>
                <td>
                  <div className="font-medium">{line.description}</div>
                  {line.detail ? (
                    <div className="text-xs text-slate-500">{line.detail}</div>
                  ) : null}
                  {line.assetNumber ? (
                    <div className="font-mono text-xs text-slate-500">
                      {line.assetNumber}
                    </div>
                  ) : null}
                </td>
                <td className="text-right tabular-nums">{line.quantity}</td>
                <td>{line.unit}</td>
                <td className="text-right tabular-nums">
                  {formatAmount(line.unitNet, current.currency)}
                </td>
                <td className="text-right tabular-nums">
                  {line.vatRatePercent}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {formatAmount(line.netAmount, current.currency)}
                </td>
              </tr>
            ))}
            {current.lines.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  Nincs tétel. Tétel nélküli munkalap nem zárható le.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="border-t bg-slate-50 text-sm">
            <tr>
              <td className="p-3" colSpan={6}>
                Nettó / ÁFA / Bruttó
              </td>
              <td className="p-3 text-right tabular-nums">
                {formatAmount(current.netAmount, current.currency)} /{" "}
                {formatAmount(current.vatAmount, current.currency)} /{" "}
                <strong>
                  {formatAmount(current.grossAmount, current.currency)}
                </strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {canManage && current.status === "AWAITING_SIGNATURE" ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            Ügyfél döntésének rögzítése
          </h2>
          <p className="text-xs text-slate-500">
            Ez a belső rögzítés. Az e-mailes aláírás-lánc külön szelet, itt most
            az ügyfél döntését jegyezzük fel.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Döntés">
              <Select
                aria-label="Döntés"
                value={signature.decision}
                onChange={(event) =>
                  setSignature((current) => ({
                    ...current,
                    decision: event.target.value as WorksheetSignatureDecision,
                  }))
                }
              >
                <option value="ACCEPTED">Elfogadta</option>
                <option value="REJECTED">Elutasította</option>
              </Select>
            </FormField>
            <FormField label="Aláíró neve" className="md:col-span-2">
              <Input
                aria-label="Aláíró neve"
                value={signature.signerName}
                onChange={(event) =>
                  setSignature((current) => ({
                    ...current,
                    signerName: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Megjegyzés" className="md:col-span-3">
              <Textarea
                aria-label="Aláírás megjegyzése"
                rows={2}
                value={signature.note}
                onChange={(event) =>
                  setSignature((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
              />
            </FormField>
          </div>
          <Button
            disabled={busy || signature.signerName.trim().length < 2}
            onClick={() =>
              void run(() =>
                worksheetsApi.sign(token, worksheet.id, {
                  decision: signature.decision,
                  signerName: signature.signerName.trim(),
                  note: signature.note.trim() ? signature.note.trim() : null,
                }),
              )
            }
          >
            Döntés rögzítése
          </Button>
        </Card>
      ) : null}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Verzió</th>
              <th>Állapot</th>
              <th>Készítette</th>
              <th>Lezárta</th>
              <th>Indoklás</th>
              <th className="p-3">Aláírás</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.versions.map((version) => (
              <tr key={version.id} className="border-b last:border-0">
                <td className="p-3">
                  {version.label ?? `${version.version}. verzió`}
                </td>
                <td>
                  <Badge variant={worksheetStatusVariant(version.status)}>
                    {worksheetStatusLabel[version.status]}
                  </Badge>
                </td>
                <td>
                  {version.createdByName ?? "—"}
                  <div className="text-xs text-slate-500">
                    {formatDateTime(version.createdAt)}
                  </div>
                </td>
                <td>
                  {version.closedByName ?? "—"}
                  <div className="text-xs text-slate-500">
                    {formatDateTime(version.closedAt)}
                  </div>
                </td>
                <td className="max-w-xs whitespace-pre-line">
                  {version.changeReason ?? "—"}
                </td>
                <td className="p-3">
                  {version.signature
                    ? `${version.signature.signerName} (${
                        version.signature.decision === "ACCEPTED"
                          ? "elfogadta"
                          : "elutasította"
                      })`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
