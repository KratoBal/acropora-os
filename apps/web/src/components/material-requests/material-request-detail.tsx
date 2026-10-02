"use client";

import { ConfirmDialog } from "@acropora/ui";
import type {
  MaterialRequestFullDetail,
  MaterialRequestHandlerOption,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotInput,
  PilotSelect,
} from "@/components/pilot/pilot-ui";
import { ApiError } from "@/lib/api/client";
import { materialRequestsApi } from "@/lib/api/material-requests";

import {
  MaterialItemRow,
  MetaRow,
  Panel,
  PanelTitle,
  RequestPill,
  StatusPill,
  Timeline,
} from "./material-request-parts";
import {
  PRIORITY_LABEL,
  formatNeededBy,
  formatWhen,
  timeline,
} from "./material-request-v2-presentation";

/**
 * HOW OFTEN AN OPEN SCREEN RE-READS THE REQUEST. Someone else may claim it at
 * any moment; the brief asks that nobody keeps seeing "Nincs felelős" for
 * long. No WebSocket exists, so a re-read every 30 s while the tab is
 * visible, plus on focus and after every own action, is the mechanism.
 */
export const MATERIAL_REQUEST_REFRESH_MS = 30_000;

/** Re-runs `refresh` every 30 s while visible, and when the tab comes back. */
export function useLiveRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = window.setInterval(tick, MATERIAL_REQUEST_REFRESH_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
}

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: MaterialRequestFullDetail };

/**
 * ONE REQUEST, READ FROM THE SERVER, WITH ITS ACTIONS. Every button comes
 * from `detail.actions`, which the server computes with the same rules it
 * enforces, so a button is never shown that the server would refuse
 * (and hiding is still not the authorization: the server checks again).
 *
 * `variant`: "panel" is the overview's right column (Figma 404:178), "page"
 * the two-column detail page (Figma 404:221).
 */
export function MaterialRequestDetail({
  id,
  variant,
  onChanged,
  now = new Date(),
}: {
  id: string;
  variant: "panel" | "page";
  /** After an own action: the overview re-reads its list and counts. */
  onChanged?: () => void;
  now?: Date;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const hasSession = Boolean(session);
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!hasSession) return;
    try {
      const detail = await materialRequestsApi.detail(token, id);
      setState({ kind: "ready", detail });
    } catch (cause) {
      setState({
        kind: "error",
        message:
          cause instanceof ApiError && cause.status === 404
            ? "Az anyagigény nem található, vagy nincs jogosultságod megnézni."
            : "Az anyagigény jelenleg nem tölthető be.",
      });
    }
    // `token` is read, not watched: the session object changes identity
  }, [hasSession, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setState({ kind: "loading" });
    setActionError(null);
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  /**
   * Every action: send, take the authoritative answer, tell the overview.
   * On any failure (a lost race is 409) the request is re-read, so the
   * screen shows what is true now, with the reason above it.
   */
  const run = async (
    step: () => Promise<MaterialRequestFullDetail>,
  ): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      const detail = await step();
      setState({ kind: "ready", detail });
      return true;
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
      await load();
      return false;
    } finally {
      setBusy(false);
      onChanged?.();
    }
  };

  if (state.kind === "loading")
    return (
      <Panel label="Anyagigény">
        <div
          aria-busy="true"
          className="h-40 animate-pulse rounded-[9px] bg-pilot-grey-100"
        />
      </Panel>
    );
  if (state.kind === "error")
    return (
      <Panel label="Anyagigény">
        <p role="alert" className="text-sm leading-5 text-pilot-red-700">
          {state.message}
        </p>
      </Panel>
    );

  const detail = state.detail;
  const steps = timeline(detail.status, detail.events, now);
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="break-words text-sm font-semibold leading-5 text-pilot-grey-900">
          {detail.customerDisplayName}
        </p>
        <p className="text-xs leading-4 text-pilot-grey-500">
          {detail.departmentName} ·{" "}
          {detail.worksheetNumber ?? "piszkozat munkalap"}
        </p>
      </div>
      <StatusPill status={detail.status} />
    </div>
  );
  const meta = (
    <dl className="flex flex-col gap-2.5">
      <MetaRow label="Igénylő" value={detail.requestedByName ?? "—"} />
      <MetaRow
        label="Beküldve"
        value={detail.submittedAt ? formatWhen(detail.submittedAt, now) : "—"}
      />
      <MetaRow
        label="Szükséges"
        value={detail.neededBy ? formatNeededBy(detail.neededBy) : "—"}
      />
      <MetaRow
        label="Prioritás"
        value={detail.priority ? PRIORITY_LABEL[detail.priority] : "—"}
      />
    </dl>
  );
  const error = actionError ? (
    <p
      role="alert"
      className="rounded-[9px] bg-pilot-red-50 px-3 py-2 text-sm leading-5 text-pilot-red-700"
    >
      {actionError}
    </p>
  ) : null;
  const owner = (
    <OwnerBox
      detail={detail}
      busy={busy}
      onClaim={() => void run(() => materialRequestsApi.claim(token, id))}
    />
  );
  const items = (
    <ul className="flex flex-col gap-2.5">
      {detail.items.map((item) => (
        <MaterialItemRow key={item.id} status={detail.status} item={item} />
      ))}
    </ul>
  );
  const procurement = (
    <ProcurementActions detail={detail} busy={busy} run={run} token={token} />
  );
  const note = detail.note ? (
    <p className="whitespace-pre-line break-words text-sm leading-5 text-pilot-grey-600">
      {detail.note}
    </p>
  ) : null;
  const comments = (
    <Comments
      detail={detail}
      busy={busy}
      now={now}
      onAdd={(body) => run(() => materialRequestsApi.comment(token, id, body))}
    />
  );

  if (variant === "panel")
    return (
      <Panel label="Kiválasztott anyagigény">
        {header}
        {error}
        {meta}
        {owner}
        <PanelTitle>Tételek</PanelTitle>
        {items}
        {procurement}
        {note ? (
          <>
            <PanelTitle>Megjegyzés</PanelTitle>
            {note}
          </>
        ) : null}
        <PanelTitle>Státusztörténet</PanelTitle>
        <Timeline steps={steps} />
        <Link
          href={`/szerviz/anyagigenyek/${encodeURIComponent(detail.id)}`}
          className="text-sm font-medium text-pilot-aqua-700 hover:underline"
        >
          Részletek és megjegyzések
        </Link>
      </Panel>
    );

  return (
    <div className="flex flex-col gap-3.5">
      <Panel label="Anyagigény">
        {header}
        <Link
          href={detail.worksheetHref}
          className="self-start text-sm font-medium text-pilot-aqua-700 hover:underline"
        >
          Munkalap megnyitása
        </Link>
      </Panel>
      {error}
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_410px]">
        <div className="flex min-w-0 flex-col gap-3">
          {owner}
          <Panel label="Igényelt tételek">
            <PanelTitle>Igényelt tételek</PanelTitle>
            {items}
          </Panel>
          {procurement}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Panel label="Igény adatai">
            <PanelTitle>Igény adatai</PanelTitle>
            {meta}
            {note ? (
              <>
                <p className="text-xs leading-4 text-pilot-grey-500">
                  Megjegyzés
                </p>
                {note}
              </>
            ) : null}
          </Panel>
          <Panel label="Státusztörténet">
            <PanelTitle>Státusztörténet</PanelTitle>
            <Timeline steps={steps} />
          </Panel>
          {comments}
        </div>
      </div>
    </div>
  );
}

/**
 * "Én intézem a beszerzést" (Figma 404:197), or who handles it (404:298).
 * The claim button exists only when the server says this caller may claim.
 */
function OwnerBox({
  detail,
  busy,
  onClaim,
}: {
  detail: MaterialRequestFullDetail;
  busy: boolean;
  onClaim: () => void;
}) {
  if (detail.status === "DRAFT" || detail.status === "CANCELLED") return null;
  if (detail.handlerId === null) {
    if (detail.status !== "OPEN") return null;
    return (
      <div className="flex flex-col items-start gap-1.5 rounded-[10px] bg-pilot-amber-50 px-3 py-2.5">
        <p className="text-sm font-semibold leading-5 text-pilot-amber-700">
          Még senki nem vállalta a beszerzést
        </p>
        {detail.actions.claim ? (
          <>
            <p className="text-xs leading-4 text-pilot-grey-600">
              Ha átveszed, a többiek azonnal látják, hogy te intézed.
            </p>
            <PilotButton
              variant="primary"
              size="regular"
              disabled={busy}
              onClick={onClaim}
            >
              Én intézem a beszerzést
            </PilotButton>
          </>
        ) : (
          <p className="text-xs leading-4 text-pilot-grey-600">
            A beszerzést a beszerzési joggal rendelkező kollégák vállalhatják.
          </p>
        )}
      </div>
    );
  }
  return (
    <Panel label="Beszerzési felelős">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Beszerzési felelős</PanelTitle>
          <p className="text-xs leading-4 text-pilot-grey-500">
            {detail.handlerName ?? "ismeretlen kolléga"}
            {detail.handlerAssignedAt
              ? ` · átvette ${formatWhen(detail.handlerAssignedAt, new Date())}`
              : ""}
          </p>
        </div>
        <RequestPill tone="accent">Ő INTÉZI</RequestPill>
      </div>
    </Panel>
  );
}

/**
 * "Beszerzés állapota" (Figma 404:317): Megrendeltem, Részben beérkezett,
 * Beérkezett, plus the handover and the withdrawal. Only what `actions`
 * allows is rendered.
 */
function ProcurementActions({
  detail,
  busy,
  run,
  token,
}: {
  detail: MaterialRequestFullDetail;
  busy: boolean;
  run: (step: () => Promise<MaterialRequestFullDetail>) => Promise<boolean>;
  token: string;
}) {
  const { actions } = detail;
  const [partialOpen, setPartialOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const any =
    actions.order ||
    actions.receiveItems ||
    actions.receive ||
    actions.reassign ||
    actions.cancel;
  if (!any) return null;
  return (
    <Panel label="Beszerzés állapota">
      <PanelTitle>Beszerzés állapota</PanelTitle>
      {actions.order || actions.receive ? (
        <p className="text-sm leading-5 text-pilot-grey-600">
          Ha a rendelést leadtad, rögzítsd az állapotot. A szervizes kolléga ezt
          azonnal látni fogja.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.order ? (
          <PilotButton
            variant="primary"
            size="regular"
            disabled={busy}
            onClick={() =>
              void run(() => materialRequestsApi.order(token, detail.id))
            }
          >
            Megrendeltem
          </PilotButton>
        ) : null}
        {actions.receiveItems ? (
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={busy}
            onClick={() => setPartialOpen((open) => !open)}
          >
            Részben beérkezett
          </PilotButton>
        ) : null}
        {actions.receive ? (
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={busy}
            onClick={() =>
              void run(() => materialRequestsApi.receiveAll(token, detail.id))
            }
          >
            Beérkezett
          </PilotButton>
        ) : null}
        {actions.cancel ? (
          <PilotButton
            variant="ghost"
            size="regular"
            disabled={busy}
            onClick={() => setConfirmCancel(true)}
          >
            Visszavonás
          </PilotButton>
        ) : null}
      </div>
      {partialOpen && actions.receiveItems ? (
        <PartialReceiveForm
          detail={detail}
          busy={busy}
          onSubmit={(items) =>
            void run(() =>
              materialRequestsApi.receiveItems(token, detail.id, { items }),
            ).then((ok) => (ok ? setPartialOpen(false) : undefined))
          }
        />
      ) : null}
      {actions.reassign ? (
        <Reassign detail={detail} busy={busy} run={run} token={token} />
      ) : null}
      <ConfirmDialog
        open={confirmCancel}
        title="Visszavonod az anyagigényt?"
        consequence={
          detail.handlerId
            ? `A beszerzést ${detail.handlerName ?? "a felelős kolléga"} intézi; értesítést kap, hogy nincs vele további teendő.`
            : "Az igény kikerül az aktív listából, és senki nem kezdi el intézni."
        }
        recovery="A visszavont igény a történetével együtt megmarad, de nem állítható vissza: ha mégis kell, új igényt kell küldeni a munkalapról."
        confirmLabel="Visszavonás"
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void run(() => materialRequestsApi.cancel(token, detail.id));
        }}
      />
    </Panel>
  );
}

/**
 * Per item: a numeric item takes the new TOTAL that arrived (it may not go
 * down; the server checks), a text item the "Megjött" mark. Only changed
 * items are sent.
 */
function PartialReceiveForm({
  detail,
  busy,
  onSubmit,
}: {
  detail: MaterialRequestFullDetail;
  busy: boolean;
  onSubmit: (
    items: { itemId: string; receivedQuantity?: string; arrived?: boolean }[],
  ) => void;
}) {
  const open = detail.items.filter((item) => !item.arrived);
  const [totals, setTotals] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((item) => [item.id, item.receivedQuantity ?? ""]),
    ),
  );
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  type Change = {
    itemId: string;
    receivedQuantity?: string;
    arrived?: boolean;
  };
  const changes = open.flatMap((item): Change[] => {
    if (item.quantityValue !== null) {
      const total = (totals[item.id] ?? "").trim();
      return total && total !== (item.receivedQuantity ?? "")
        ? [{ itemId: item.id, receivedQuantity: total }]
        : [];
    }
    return marks[item.id] ? [{ itemId: item.id, arrived: true }] : [];
  });
  return (
    <form
      aria-label="Részben beérkezett"
      className="flex flex-col gap-2 rounded-[10px] bg-pilot-grey-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (changes.length) onSubmit(changes);
      }}
    >
      {open.map((item) =>
        item.quantityValue !== null ? (
          <label
            key={item.id}
            className="flex items-center justify-between gap-3 text-sm text-pilot-grey-900"
          >
            <span className="min-w-0 break-words">
              {item.name}{" "}
              <span className="text-xs text-pilot-grey-500">
                (kért: {item.quantity} {item.unit})
              </span>
            </span>
            <PilotInput
              aria-label={`${item.name}: beérkezett összesen`}
              inputMode="decimal"
              value={totals[item.id] ?? ""}
              onChange={(value) =>
                setTotals((all) => ({ ...all, [item.id]: value }))
              }
              className="w-24"
            />
          </label>
        ) : (
          <label
            key={item.id}
            className="flex items-center justify-between gap-3 text-sm text-pilot-grey-900"
          >
            <span className="min-w-0 break-words">
              {item.name}{" "}
              <span className="text-xs text-pilot-grey-500">
                ({item.quantity} {item.unit})
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-pilot-grey-600">
              <input
                type="checkbox"
                checked={marks[item.id] ?? false}
                onChange={(event) =>
                  setMarks((all) => ({
                    ...all,
                    [item.id]: event.target.checked,
                  }))
                }
              />
              Megjött
            </span>
          </label>
        ),
      )}
      <div>
        <PilotButton
          type="submit"
          variant="primary"
          size="regular"
          disabled={busy || changes.length === 0}
        >
          Rögzítés
        </PilotButton>
      </div>
    </form>
  );
}

/** "Felelős módosítása": a leader or the handler hands it to another purchaser. */
function Reassign({
  detail,
  busy,
  run,
  token,
}: {
  detail: MaterialRequestFullDetail;
  busy: boolean;
  run: (step: () => Promise<MaterialRequestFullDetail>) => Promise<boolean>;
  token: string;
}) {
  const [options, setOptions] = useState<MaterialRequestHandlerOption[] | null>(
    null,
  );
  const [choice, setChoice] = useState("");
  useEffect(() => {
    let alive = true;
    materialRequestsApi
      .handlerOptions(token)
      .then((response) => alive && setOptions(response.items))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
    // read once per request; `token` changes identity, not value
  }, [detail.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = (options ?? []).filter(
    (option) => option.id !== detail.handlerId,
  );
  if (options !== null && others.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-pilot-grey-200 pt-2.5">
      <span className="w-full text-xs leading-4 text-pilot-grey-500">
        Felelős módosítása
      </span>
      <div className="min-w-[200px] flex-1">
        <PilotSelect
          aria-label="Új felelős"
          value={choice}
          onChange={setChoice}
          disabled={busy || options === null}
        >
          <option value="">Válassz kollégát</option>
          {others.map((option) => (
            <option key={option.id} value={option.id}>
              {option.displayName}
            </option>
          ))}
        </PilotSelect>
      </div>
      <PilotButton
        variant="secondary"
        size="regular"
        disabled={busy || !choice}
        onClick={() =>
          void run(() =>
            materialRequestsApi.reassign(token, detail.id, choice),
          ).then((ok) => (ok ? setChoice("") : undefined))
        }
      >
        Átadás
      </PilotButton>
    </div>
  );
}

/** Figma 404:364: the comment list (text, author, time) and a simple add form. */
function Comments({
  detail,
  busy,
  now,
  onAdd,
}: {
  detail: MaterialRequestFullDetail;
  busy: boolean;
  now: Date;
  onAdd: (body: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Panel label="Megjegyzések">
      <PanelTitle>Megjegyzések</PanelTitle>
      {detail.comments.length === 0 ? (
        <p className="text-sm leading-5 text-pilot-grey-500">
          Még nincs megjegyzés.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-0.5">
              <p className="whitespace-pre-line break-words text-sm leading-5 text-pilot-grey-600">
                <span className="font-semibold text-pilot-grey-900">
                  {comment.authorName ?? "Kolléga"}:
                </span>{" "}
                {comment.body}
              </p>
              <p className="text-xs leading-4 text-pilot-grey-500">
                {formatWhen(comment.createdAt, now)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {detail.actions.comment ? (
        open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = draft.trim();
              if (!body) return;
              void onAdd(body).then((ok) => {
                if (!ok) return;
                setDraft("");
                setOpen(false);
              });
            }}
          >
            <textarea
              aria-label="Új megjegyzés"
              value={draft}
              maxLength={2000}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              className="rounded-[9px] border border-pilot-grey-300 px-3 py-2 text-sm leading-5 text-pilot-grey-900 outline-none focus:border-pilot-aqua-500"
            />
            <div className="flex gap-2">
              <PilotButton
                type="submit"
                variant="primary"
                size="regular"
                disabled={busy || !draft.trim()}
              >
                Mentés
              </PilotButton>
              <PilotButton
                variant="ghost"
                size="regular"
                onClick={() => setOpen(false)}
              >
                Mégse
              </PilotButton>
            </div>
          </form>
        ) : (
          <div>
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() => setOpen(true)}
            >
              Megjegyzés hozzáadása
            </PilotButton>
          </div>
        )
      ) : null}
    </Panel>
  );
}
