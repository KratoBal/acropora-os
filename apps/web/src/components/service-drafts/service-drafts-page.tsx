"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Skeleton } from "@acropora/ui";
import type {
  ServiceDraftItem,
  ServiceDraftListResponse,
  ServiceDraftStatus,
  ServiceDraftSyncStatus,
} from "@acropora/types";
import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotThemeRoot,
  PilotCard,
  PilotButton,
  PilotSelect,
  PilotBadge,
  PilotInput,
} from "@/components/pilot/pilot-ui";
import { serviceDraftsApi } from "@/lib/api/service-drafts";

function DraftAttachment({
  file,
  token,
}: {
  file: ServiceDraftItem["attachments"][number];
  token: string;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setError(false);
    setUrl(undefined);
    void serviceDraftsApi
      .attachment(token, file.id, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, token]);
  return (
    <div className="w-40 space-y-2 text-xs">
      {error ? (
        <p role="status">A csatolmány nem tölthető be.</p>
      ) : !url ? (
        <Skeleton className="h-24 w-40" />
      ) : (
        <a
          href={url}
          download={file.fileName}
          className="block break-all text-pilot-aqua-700 underline"
        >
          {file.contentType.startsWith("image/") && (
            <img
              src={url}
              alt={file.fileName}
              className="mb-2 h-24 w-40 rounded-md object-cover"
            />
          )}
          {file.fileName}
        </a>
      )}
    </div>
  );
}
/**
 * A JEV-SZŰRÉS JELE A KÁRTYÁN (Cápasuli, Balázs 2026-10-05): a bizonytalan és
 * a vissza hozott tétel mindig jelölt; a "nem szűrt" csak akkor, ha a szűrés be
 * van kapcsolva (kikapcsolva minden tétel szűretlen, és a jel csak zaj lenne).
 */
export function draftFilterBadge(
  item: Pick<ServiceDraftItem, "filterState">,
  filterEnabled: boolean,
): { label: string; variant: "amber" | "grey" } | null {
  if (item.filterState === "UNCERTAIN")
    return { label: "Bizonytalan", variant: "amber" };
  if (item.filterState === "PROMOTED")
    return { label: "Kiszűrtből visszahozva", variant: "grey" };
  if (item.filterState === "UNFILTERED" && filterEnabled)
    return { label: "Nem szűrt", variant: "grey" };
  return null;
}

/** A kiszűrés oka a "Kiszűrve" szakaszban. */
export function jevClassLabel(jevClass: string | null): string {
  if (jevClass === "NOT_OURS") return "Nem nekünk szól";
  if (jevClass === "NOT_A_FAULT") return "Nem hiba";
  return "Kiszűrve";
}

function DraftCard({
  item,
  data,
  token,
  onDecide,
  busy,
}: {
  item: ServiceDraftItem;
  data: ServiceDraftListResponse;
  token: string;
  onDecide: (
    item: ServiceDraftItem,
    decision: "accept" | "reject",
    departmentId: string,
    reporterPersonName: string,
  ) => void;
  busy: boolean;
}) {
  const [author, setAuthor] = useState(item.reporterPersonName ?? "");
  const [department, setDepartment] = useState(item.proposedDepartmentId ?? "");
  return (
    <PilotCard>
      <article aria-label={item.title} className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-pilot-grey-900">
          {item.title}
        </h2>
        <p className="text-xs text-pilot-grey-600">
          Cápasuli · {item.reportDate} · {item.mail.subject ?? "Napi jelentő"}
        </p>
        {draftFilterBadge(item, data.filterEnabled) && (
          <PilotBadge
            variant={draftFilterBadge(item, data.filterEnabled)!.variant}
          >
            {draftFilterBadge(item, data.filterEnabled)!.label}
          </PilotBadge>
        )}
        {item.occurrence > 1 && (
          <div className="space-y-2">
            <PilotBadge variant="amber">
              Újra jelezték · {item.occurrence}. alkalom
            </PilotBadge>
            {item.earlier.map((e) => (
              <p key={e.id} className="text-xs text-pilot-grey-600">
                {e.reportDate} —{" "}
                {e.acceptedServiceJobId ? (
                  <Link
                    href={`/szerviz/hibajegyek/${e.acceptedServiceJobId}`}
                    className="underline"
                  >
                    Korábbi hibajegy
                  </Link>
                ) : e.status === "REJECTED" ? (
                  "Elvetett piszkozat"
                ) : (
                  "Korábbi piszkozat"
                )}
              </p>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-sm text-pilot-grey-900">
          {item.originalProblem}
        </p>
        {item.attachments.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {item.attachments.map((f) => (
              <DraftAttachment key={f.id} file={f} token={token} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-pilot-grey-500">Nincs csatolmány</p>
        )}
        {item.status === "PENDING" && (
          <div className="max-w-sm">
            <label
              htmlFor={`location-${item.id}`}
              className="mb-1 block text-xs text-pilot-grey-600"
            >
              Helyszín
            </label>
            <PilotSelect
              id={`location-${item.id}`}
              value={department}
              onChange={setDepartment}
              chevron
              disabled={busy}
            >
              <option value="">Válassz helyszínt</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </PilotSelect>
          </div>
        )}
        {item.status === "PENDING" ? (
          <div className="max-w-sm">
            <label
              htmlFor={`author-${item.id}`}
              className="mb-1 block text-xs text-pilot-grey-600"
            >
              Jelentő szerzője
            </label>
            <PilotInput
              id={`author-${item.id}`}
              value={author}
              onChange={(value) => setAuthor(value.slice(0, 200))}
              disabled={busy}
            />
            <p className="mt-1 text-xs text-pilot-grey-500">
              A név az elfogadáskor kerül a jegyre.
            </p>
          </div>
        ) : item.reporterPersonName ? (
          <p className="text-xs text-pilot-grey-600">
            Jelentő szerzője: {item.reporterPersonName}
          </p>
        ) : null}
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-pilot-aqua-700">
            Teljes napi jelentő megnyitása
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-pilot-grey-600">
            {item.mail.originalText}
          </p>
        </details>
        {item.status === "PENDING" ? (
          <div className="flex flex-wrap gap-3">
            <PilotButton
              disabled={busy || !department || !data.openedBy}
              onClick={() => onDecide(item, "accept", department, author)}
              aria-label={`Elfogadom: ${item.title}`}
            >
              {busy ? "Mentés…" : "Elfogadom"}
            </PilotButton>
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => onDecide(item, "reject", department, author)}
              aria-label={`Elvetem: ${item.title}`}
            >
              Elvetem
            </PilotButton>
          </div>
        ) : (
          <p className="text-xs text-pilot-grey-600">
            {item.status === "ACCEPTED" ? "Elfogadva" : "Elvetve"} ·{" "}
            {item.decidedAt && new Date(item.decidedAt).toLocaleString("hu-HU")}
            {item.acceptedServiceJobId && (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/szerviz/hibajegyek/${item.acceptedServiceJobId}`}
                  className="underline"
                >
                  Hibajegy megnyitása
                </Link>
              </>
            )}
          </p>
        )}
      </article>
    </PilotCard>
  );
}
export function ServiceDraftsPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<ServiceDraftStatus>("PENDING");
  const [data, setData] = useState<ServiceDraftListResponse>();
  const [sync, setSync] = useState<ServiceDraftSyncStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const admin =
    !!session &&
    ["OWNER", "ADMIN"].includes(session.user.role) &&
    !session.user.customerId &&
    !session.user.supplierId;
  const load = useCallback(
    async (signal?: AbortSignal, cursor?: string) => {
      if (!admin || !session) return;
      setLoading(true);
      setError(undefined);
      try {
        const result = await serviceDraftsApi.list(
          session.token ?? "",
          status,
          cursor,
          signal,
        );
        if (signal?.aborted) return;
        setData((old) =>
          cursor && old
            ? { ...result, items: [...old.items, ...result.items] }
            : result,
        );
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error ? e.message : "A piszkozatok nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [admin, session, status],
  );
  useEffect(() => {
    if (!admin || !session) return;
    const abort = new AbortController();
    setData(undefined);
    void load(abort.signal);
    void serviceDraftsApi
      .status(session.token ?? "", abort.signal)
      .then(setSync)
      .catch(() => {});
    return () => abort.abort();
  }, [load, admin, session]);
  async function decide(
    item: ServiceDraftItem,
    decision: "accept" | "reject",
    departmentId: string,
    reporterPersonName: string,
  ) {
    if (!session || busy) return;
    setBusy(item.id);
    setError(undefined);
    try {
      if (decision === "accept") {
        const result = await serviceDraftsApi.accept(
          session.token ?? "",
          item.id,
          departmentId,
          reporterPersonName,
        );
        router.push(`/szerviz/hibajegyek/${result.serviceJobId}`);
      } else {
        await serviceDraftsApi.reject(session.token ?? "", item.id);
        setNotice("A piszkozatot elvetetted.");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "A döntés nem menthető.");
    } finally {
      setBusy(undefined);
    }
  }
  async function promote(id: string) {
    if (!session || busy) return;
    setBusy(id);
    setError(undefined);
    try {
      await serviceDraftsApi.promote(session.token ?? "", id);
      setNotice("A tétel visszakerült a piszkozatok közé.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "A tétel nem hozható vissza.");
    } finally {
      setBusy(undefined);
    }
  }
  if (!admin)
    return (
      <Alert variant="danger" title="Hiba">
        A piszkozatok csak belső adminisztrátoroknak érhetők el.
      </Alert>
    );
  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 px-8 py-8 space-y-6 [&_h1]:!font-[inherit] [&_h2]:!font-[inherit]">
      <header className="space-y-3">
        <p className="text-xs text-pilot-grey-500">Szerviz / Piszkozatok</p>
        <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
          Piszkozatok
        </h1>
        <p className="text-sm text-pilot-grey-600">
          A napi jelentőből kiemelt kérések. Hibajegy csak az elfogadás után jön
          létre.
        </p>
      </header>
      {sync && (
        <details className="text-xs text-pilot-grey-500">
          <summary className="cursor-pointer">
            Gmail feldolgozás:{" "}
            {sync.enabled
              ? "bekapcsolva"
              : sync.switchReason === "UNRECOGNISED"
                ? "ismeretlen kapcsolóérték"
                : "kikapcsolva"}
          </summary>
          <p className="mt-2 break-words">
            {sync.mailbox} · {sync.query} · {sync.intervalMinutes} perc
          </p>
          {!sync.configured && <p>A Gmail-hozzáférés nincs beállítva.</p>}
          {sync.lastRunAt && (
            <p>
              Utolsó futás: {new Date(sync.lastRunAt).toLocaleString("hu-HU")}
            </p>
          )}
          {sync.lastError && <p role="alert">{sync.lastError}</p>}
        </details>
      )}
      <div
        role="tablist"
        aria-label="Piszkozat állapota"
        className="flex flex-wrap gap-3"
      >
        {(
          [
            ["PENDING", "Elbírálásra vár"],
            ["ACCEPTED", "Elfogadott"],
            ["REJECTED", "Elvetett"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={status === value}
            onClick={() => {
              setStatus(value);
              setNotice(undefined);
            }}
            className={`rounded-md px-3 py-2 text-xs ${status === value ? "bg-pilot-amber-50 text-pilot-amber-700" : "bg-pilot-grey-100 text-pilot-grey-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <Alert variant="danger" title="Hiba">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert variant="info" title="Tájékoztatás">
          {notice}
        </Alert>
      )}
      {data && status === "PENDING" && !data.openedBy && (
        <Alert variant="info" title="Tájékoztatás">
          Az elfogadáshoz állítsd be a Cápasuli helyszínét és
          partnerfelhasználóját. A piszkozatokat addig is elvetheted.
        </Alert>
      )}
      {data?.openedBy && status === "PENDING" && (
        <p className="text-xs text-pilot-grey-500">
          A hibajegy nyitója: {data.openedBy.name}
        </p>
      )}
      {data?.items.map((item) => (
        <DraftCard
          key={item.id}
          item={item}
          data={data}
          token={session!.token ?? ""}
          onDecide={(...args) => void decide(...args)}
          busy={!!busy}
        />
      ))}
      {loading ? (
        <Skeleton className="h-36 w-full" />
      ) : data?.items.length === 0 ? (
        <PilotCard>
          <p className="p-6 text-sm text-pilot-grey-600">
            Nincs ilyen állapotú piszkozat.
          </p>
        </PilotCard>
      ) : null}
      {error && !loading && (
        <PilotButton variant="secondary" onClick={() => void load()}>
          Újrapróbálás
        </PilotButton>
      )}
      {/*
        A KISZŰRT TÉTELEK NEM TŰNNEK EL (brief 4. pont): a lap alján, csukva,
        egyenként visszahozhatók. A visszahozás a Jev döntését felülírja, és ez
        a javítás a tanító jel.
      */}
      {status === "PENDING" && data && data.filtered.length > 0 && (
        <details className="rounded-lg bg-white ring-1 ring-pilot-grey-100">
          <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-pilot-grey-700">
            Kiszűrve ({data.filtered.length})
          </summary>
          <ul className="divide-y divide-pilot-grey-100">
            {data.filtered.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start justify-between gap-3 px-6 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm text-pilot-grey-900">{f.title}</p>
                  <p className="text-xs text-pilot-grey-500">
                    {f.reportDate} · {jevClassLabel(f.jevClass)}
                    {f.jevConfidence !== null
                      ? ` · ${Math.round(f.jevConfidence * 100)}%`
                      : ""}
                  </p>
                </div>
                <PilotButton
                  variant="secondary"
                  size="action"
                  aria-label={`${f.title}: mégis piszkozat`}
                  disabled={!!busy}
                  onClick={() => void promote(f.id)}
                >
                  Mégis piszkozat
                </PilotButton>
              </li>
            ))}
          </ul>
        </details>
      )}
      {data?.nextCursor && (
        <PilotButton
          variant="secondary"
          disabled={loading}
          onClick={() => void load(undefined, data.nextCursor!)}
        >
          További piszkozatok
        </PilotButton>
      )}
    </PilotThemeRoot>
  );
}
