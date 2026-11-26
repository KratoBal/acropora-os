"use client";

import { Alert, ConfirmDialog } from "@acropora/ui";
import {
  worksheetListLines,
  type ServiceJobLinkableWorksheet,
  type ServiceJobLinkedWorksheetsResponse,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotInput,
} from "@/components/pilot/pilot-ui";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import {
  formatDateTime,
  formatDay,
  worksheetDisplayPilotVariant,
  worksheetVersionText,
} from "@/components/worksheets/worksheet-labels";

/**
 * THE "KAPCSOLÓDÓ MUNKALAPOK" CARD OF A MAINTENANCE SHEET (card 5b366f5d, Luca 2026-11-19): existing worksheets, mostly done by
 * a colleague elsewhere, that the settlement of this sheet refers to. A REFERENCE, NOT A MOVE, and the card says so in
 * words, because a list of worksheets under a sheet invites the reading "their hours are part of it": the worksheet stays
 * where it is, and its hours and price count into no sum, settlement or invoice of this sheet.
 *
 * Reading is open to everyone who sees the sheet (the server narrows a partner to their own units); the picker and the
 * unlink are for `canManage` only, and the server enforces the same (404 for a partner).
 */
export const LINKED_WORKSHEETS_NOTICE =
  "A hozzákapcsolás csak hivatkozás: a munkalap a helyén marad, a munkaórája és az ára semmilyen összegbe, elszámolásba vagy számlába nem számít bele.";

export function PilotLinkedWorksheetsCard({
  token,
  jobId,
  canManage,
  embedded = false,
}: {
  token: string;
  jobId: string;
  canManage: boolean;
  /**
   * A MUNKALAPOK KÁRTYA ALSÓ SZAKASZAKÉNT (picasso képernyő-leltár 3.3): a karbantartási lapon a saját és a hozzákapcsolt munkalapok
   * egy szakaszban állnak, nem két külön kártyában. Ilyenkor nincs saját keret, csak egy elválasztó és egy alcím; a tartalom ugyanaz.
   */
  embedded?: boolean;
}) {
  const [data, setData] = useState<ServiceJobLinkedWorksheetsResponse | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toUnlink, setToUnlink] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await serviceJobsApi.linkedWorksheets(token, jobId));
      setLoadError(null);
    } catch (cause) {
      setLoadError(
        cause instanceof Error
          ? cause.message
          : "A kapcsolódó munkalapok nem töltődtek be.",
      );
    }
  }, [token, jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const link = async (worksheetId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await serviceJobsApi.linkWorksheet(token, jobId, worksheetId);
      await load();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "A hozzákapcsolás nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (worksheetId: string) => {
    setToUnlink(null);
    setBusy(true);
    setActionError(null);
    try {
      await serviceJobsApi.unlinkWorksheet(token, jobId, worksheetId);
      await load();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "A kapcsolat levétele nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];
  const history = data?.history ?? [];
  const unlinkTarget = items.find((item) => item.worksheetId === toUnlink);

  const action = canManage ? (
    <PilotButton
      variant="secondary"
      disabled={busy}
      onClick={() => setPicking((open) => !open)}
    >
      {picking ? "Bezárás" : "Munkalap hozzákapcsolása"}
    </PilotButton>
  ) : undefined;
  const body = (
    <>
      <p
        className="border-b border-pilot-grey-50 px-5 py-3 text-xs text-pilot-grey-500"
        data-testid="linked-worksheets-notice"
      >
        {LINKED_WORKSHEETS_NOTICE}
      </p>
      {loadError ? (
        <div className="px-5 py-3">
          <Alert
            variant="danger"
            title="A lista nem töltődött be"
            description={loadError}
          />
        </div>
      ) : null}
      {actionError ? (
        <div className="px-5 py-3">
          <Alert
            variant="danger"
            title="A művelet nem ment"
            description={actionError}
          />
        </div>
      ) : null}
      {data !== null && items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-pilot-grey-400">
          Még nincs kapcsolódó munkalap.
        </p>
      ) : (
        <div className="divide-y divide-pilot-grey-50">
          {items.map((item) => {
            const lines = worksheetListLines(item);
            return (
              <div
                key={item.worksheetId}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3"
                data-testid="linked-worksheet"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/szerviz/munkalapok/${item.worksheetId}`}
                    className="break-words text-sm font-semibold text-pilot-grey-900 hover:text-pilot-aqua-700"
                  >
                    {lines.main}
                  </Link>
                  {lines.detail ? (
                    <p
                      className={`text-xs ${item.number ? "font-mono text-pilot-grey-600" : "text-pilot-grey-500"}`}
                    >
                      {lines.detail}
                    </p>
                  ) : null}
                  <p className="text-xs text-pilot-grey-500">
                    {item.departmentPath?.join(" / ") ?? "Helyszín nélkül"}
                    {" · "}
                    megnyitva: {formatDay(item.createdAt)}
                    {item.homeJobNumber
                      ? ` · a(z) ${item.homeJobNumber} alatt áll`
                      : ""}
                  </p>
                </div>
                <PilotBadge
                  variant={worksheetDisplayPilotVariant(item.status, 1)}
                >
                  {worksheetVersionText(item.status)}
                </PilotBadge>
                <div className="flex items-center gap-3 text-xs text-pilot-grey-400">
                  {item.linkedByName ? (
                    <span>Hozzákapcsolta: {item.linkedByName}</span>
                  ) : null}
                  {canManage ? (
                    <button
                      type="button"
                      className="cursor-pointer underline hover:text-pilot-aqua-700"
                      disabled={busy}
                      onClick={() => setToUnlink(item.worksheetId)}
                    >
                      Levétel
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canManage && picking ? (
        <Picker
          token={token}
          jobId={jobId}
          busy={busy}
          onLink={(worksheetId) => void link(worksheetId)}
          linkedVersion={items.length}
        />
      ) : null}
      {history.length > 0 ? (
        <div className="border-t border-pilot-grey-100 px-5 py-3">
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-pilot-aqua-600 hover:text-pilot-aqua-800"
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory ? "Napló elrejtése" : `Napló (${history.length})`}
          </button>
          {showHistory ? (
            <ul className="mt-2 space-y-1 text-xs text-pilot-grey-600">
              {history.map((event) => (
                <li key={event.id}>
                  {formatDateTime(event.createdAt)}{" "}
                  {event.kind === "LINKED" ? "hozzákapcsolva" : "levéve"}:{" "}
                  {event.note ?? "munkalap"}
                  {event.actorName ? ` (${event.actorName})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={toUnlink !== null}
        title="Leveszed a kapcsolatot?"
        consequence={
          unlinkTarget
            ? `A(z) ${worksheetListLines(unlinkTarget).main} többé nem szerepel a karbantartási lap kapcsolódó munkalapjai között. A munkalap maga nem változik.`
            : ""
        }
        recovery="Visszatehető: a munkalap újra felkínálódik, és bármikor újra hozzákapcsolható. A levétel bekerül a naplóba."
        confirmLabel="Levétel"
        busy={busy}
        onConfirm={() => {
          if (toUnlink !== null) void unlink(toUnlink);
        }}
        onCancel={() => setToUnlink(null)}
      />
    </>
  );

  return embedded ? (
    <section
      aria-label="Kapcsolódó munkalapok"
      className="border-t border-pilot-grey-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Kapcsolódó munkalapok
        </h3>
        {action}
      </div>
      {body}
    </section>
  ) : (
    <PilotCard>
      <PilotCardHeader title="Kapcsolódó munkalapok" action={action} />
      {body}
    </PilotCard>
  );
}

/**
 * THE PICKER: the sheet's own location first (and the units below it), then any other worksheet of the partner, so a
 * neighbouring location is still choosable by hand. The search and the day range run on the server.
 */
function Picker({
  token,
  jobId,
  busy,
  onLink,
  linkedVersion,
}: {
  token: string;
  jobId: string;
  busy: boolean;
  onLink: (worksheetId: string) => void;
  /** Changes when a link was made or removed, so the offer reloads without the just linked row. */
  linkedVersion: number;
}) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<ServiceJobLinkableWorksheet[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The search box types fast: a short delay keeps one request per pause instead of one per key.
    const timer = setTimeout(() => {
      serviceJobsApi
        .linkableWorksheets(
          token,
          jobId,
          { q, createdFrom: from, createdTo: to },
          controller.signal,
        )
        .then((response) => {
          setRows(response.items);
          setTruncated(response.truncated);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "A választék nem töltődött be.",
          );
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, jobId, q, from, to, linkedVersion]);

  const near = rows?.filter((row) => row.inSameLocation) ?? [];
  const far = rows?.filter((row) => !row.inSameLocation) ?? [];

  return (
    <div
      className="space-y-3 border-t border-pilot-grey-100 px-5 py-4"
      data-testid="linkable-picker"
    >
      <div className="flex flex-wrap gap-2">
        <PilotInput
          aria-label="Keresés szám vagy tárgy szerint"
          placeholder="Keresés szám vagy tárgy szerint"
          value={q}
          onChange={setQ}
          maxLength={100}
        />
        <PilotInput
          aria-label="Megnyitva ettől"
          type="date"
          value={from}
          onChange={setFrom}
        />
        <PilotInput
          aria-label="Megnyitva eddig"
          type="date"
          value={to}
          onChange={setTo}
        />
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="A választék nem töltődött be"
          description={error}
        />
      ) : null}
      {rows !== null && rows.length === 0 ? (
        <p className="text-sm text-pilot-grey-400">
          Nincs a keresésnek megfelelő, még hozzá nem kapcsolt munkalap ennél a
          partnernél.
        </p>
      ) : null}
      <Group
        title="Ugyanezen a helyszínen (és alatta)"
        rows={near}
        busy={busy}
        onLink={onLink}
      />
      <Group
        title="A partner többi munkalapja"
        rows={far}
        busy={busy}
        onLink={onLink}
      />
      {truncated ? (
        <p className="text-xs text-pilot-grey-500">
          Több találat van, mint amennyit a lista mutat: szűkítsd a keresést
          vagy a napok körét.
        </p>
      ) : null}
    </div>
  );
}

function Group({
  title,
  rows,
  busy,
  onLink,
}: {
  title: string;
  rows: ServiceJobLinkableWorksheet[];
  busy: boolean;
  onLink: (worksheetId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-pilot-grey-700">{title}</p>
      <ul className="divide-y divide-pilot-grey-50 rounded-lg border border-pilot-grey-100">
        {rows.map((row) => {
          const lines = worksheetListLines(row);
          return (
            <li
              key={row.worksheetId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
              data-testid="linkable-worksheet"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-pilot-grey-900">
                  {lines.main}
                </p>
                <p className="text-xs text-pilot-grey-500">
                  {lines.detail ? `${lines.detail} · ` : ""}
                  {row.departmentPath?.join(" / ") ?? "Helyszín nélkül"}
                  {" · "}
                  {formatDay(row.createdAt)}
                  {row.homeJobNumber
                    ? ` · a(z) ${row.homeJobNumber} alatt áll`
                    : ""}
                </p>
              </div>
              <PilotBadge variant={worksheetDisplayPilotVariant(row.status, 1)}>
                {worksheetVersionText(row.status)}
              </PilotBadge>
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={() => onLink(row.worksheetId)}
              >
                Hozzákapcsolás
              </PilotButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
