"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  PageHeader,
  Skeleton,
  PAGE_GUTTER_X,
  PILOT_FIELD_HINT_CLASS,
} from "@acropora/ui";
import type {
  ServiceDraftItem,
  ServiceDraftListResponse,
  ServiceDraftPlace,
  ServiceDraftSource,
  ServiceDraftStatus,
  ServiceDraftSyncStatus,
  TicketMailIntakeStatus,
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

/**
 * A TICKET@ VÁZLAT HONNAN-JELE A KÁRTYÁN (kártya ec7b947b, Balázs 2026-09-18: "ránézésre más és szűrhető"): a három bejövő ág ugyanabban a
 * listában áll, és ez a jel különbözteti meg őket. Az AI nélküli (bekapcsolt feladó, az AI nem válaszolt) és az ismeretlen feladó
 * kiemelt; a szabályalapú (Cápasuli) vázlaton nincs jel.
 */
export function draftIntakeBadge(
  item: Pick<ServiceDraftItem, "intakeState">,
): { label: string; variant: "teal" | "amber" | "grey" } | null {
  switch (item.intakeState) {
    case "AI_DRAFT":
      return { label: "AI vázlat", variant: "teal" };
    case "AI_UNAVAILABLE":
      return { label: "AI nélkül", variant: "amber" };
    case "WATCH_OFF":
      return { label: "Figyelés kikapcsolva", variant: "grey" };
    case "UNKNOWN_SENDER":
      return { label: "Ismeretlen feladó", variant: "amber" };
    default:
      return null;
  }
}

/** A kártya fejlécének forrás-szava. */
export function draftSourceLabel(source: ServiceDraftSource): string {
  return source === "TICKET_MAIL" ? "Ticket levél" : "Cápasuli";
}

/** A kiszűrés oka a "Kiszűrve" szakaszban. */
export function jevClassLabel(jevClass: string | null): string {
  if (jevClass === "NOT_OURS") return "Nem nekünk szól";
  if (jevClass === "NOT_A_FAULT") return "Nem hiba";
  return "Kiszűrve";
}

/**
 * EGY "... EZT ÍRTA:" SOR CSAK AKKOR IDÉZÉS-FEJLÉC, HA LEVÉL-FEJLÉCNEK LÁTSZIK (barracuda, #2915): a bejelentő a saját szövegében is írhat ilyet ("A szerelő
 * ezt írta:"), és az utána jövő SAJÁT sorai nem kerülhetnek az összecsukott részbe (a kezelő átsiklana a hiba leírásán). A levélprogramok fejléce mindig hordoz
 * évszámot vagy e-mail-címet ("2026. nov. 25., Sze, 10:12 időpontban Név <a@b.hu> ezt írta:", "On Tue, 25 Nov 2026, Bob <b@x.hu> wrote:").
 */
const QUOTE_HEADER_EVIDENCE = /\b(?:19|20)\d\d\b|<[^<>\s]+@[^<>\s]+>|\S+@\S+/;

/**
 * AZ IDÉZETT VÁLASZ-LEVÉL ÖSSZECSUKVA (Picasso 3.17, acrobot 61999): a levél szövege az ÚJ rész és a "... ezt írta:" fejlécű idézett lánc együtt jött, és
 * a kártyán az egész látszott. A fejléc az első sor, ami "ezt írta" (vagy "wrote") szóval ér véget, vagy egy "Eredeti üzenet" elválasztó; előtte az új
 * szöveg áll, utána az idézett rész. Ha a fejléc előtt nincs szöveg, nem bontunk (az egész levél idézet, és egy üres kártya rosszabb, mint egy hosszú).
 * Csak a megjelenítés változik: az elfogadás, az AI-vázlat és a helyszín-javaslat ugyanazt a teljes szöveget kapja.
 */
export function splitQuotedReply(text: string): {
  own: string;
  quoted: string | null;
} {
  const lines = text.split("\n");
  const header = lines.findIndex(
    (line) =>
      (/(?:\bezt írta|\bwrote)\s*:?\s*$/i.test(line) &&
        QUOTE_HEADER_EVIDENCE.test(line)) ||
      /^-{2,}\s*(?:Eredeti üzenet|Original Message)\s*-{2,}\s*$/i.test(line),
  );
  if (header <= 0) return { own: text, quoted: null };
  const own = lines.slice(0, header).join("\n").trimEnd();
  if (own.trim() === "") return { own: text, quoted: null };
  return { own, quoted: lines.slice(header).join("\n") };
}

function DraftOriginalText({ text }: { text: string }) {
  const { own, quoted } = splitQuotedReply(text);
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-pilot-grey-900">
        {own}
      </p>
      {quoted ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-pilot-aqua-700">
            Idézett levél megnyitása
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-pilot-grey-600">
            {quoted}
          </p>
        </details>
      ) : null}
    </>
  );
}

function DraftCard({
  item,
  data,
  places,
  token,
  onDecide,
  busy,
}: {
  item: ServiceDraftItem;
  data: ServiceDraftListResponse;
  /** A ticket@ vázlat helyszín-készlete (minden aktív helyszín); a Cápasuli vázlat a `data.locations`-t kapja. */
  places: readonly ServiceDraftPlace[] | undefined;
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
  const isTicket = item.source === "TICKET_MAIL";
  const intakeBadge = draftIntakeBadge(item);
  return (
    <PilotCard>
      <article aria-label={item.title} className="space-y-4 p-6">
        <h2 className="text-sm font-semibold text-pilot-grey-900">
          {item.title}
        </h2>
        <p className="text-xs text-pilot-grey-600">
          {draftSourceLabel(item.source)} · {item.reportDate} ·{" "}
          {item.mail.subject ?? (isTicket ? "Tárgy nélkül" : "Napi jelentő")}
        </p>
        {isTicket && (
          <p className="break-all text-xs text-pilot-grey-600">
            Feladó: {item.mail.fromAddress ?? "ismeretlen cím"}
          </p>
        )}
        {intakeBadge && (
          <PilotBadge variant={intakeBadge.variant}>
            {intakeBadge.label}
          </PilotBadge>
        )}
        {item.intakeState === "UNKNOWN_SENDER" && item.status === "PENDING" && (
          <p className="text-xs text-pilot-grey-500">
            A feladó nem ismert, vagy a címe nem igazolható: a helyszínt és a
            szerzőt te adod meg.
          </p>
        )}
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
        {item.aiSummary && (
          <div className="space-y-1 rounded-md bg-pilot-aqua-50 p-3">
            <p className="text-xs font-semibold text-pilot-aqua-700">
              AI összefoglaló (csak segítség: a levél szövege alatta áll)
            </p>
            {/* SZÖVEGKÉNT, soha nem HTML: a modell válasza egy idegen levél alapján készült */}
            <p className="whitespace-pre-wrap break-words text-sm text-pilot-grey-900">
              {item.aiSummary}
            </p>
          </div>
        )}
        <p className="text-xs font-semibold text-pilot-grey-600">
          {isTicket ? "A levél szövege" : "A kért javítás szövege"}
        </p>
        <DraftOriginalText text={item.originalProblem} />
        {item.attachments.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {item.attachments.map((f) => (
              <DraftAttachment key={f.id} file={f} token={token} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-pilot-grey-500">Nincs csatolmány</p>
        )}
        {item.mail.droppedAttachments > 0 && (
          <p className="text-xs text-pilot-amber-700">
            {item.mail.droppedAttachments} csatolmány kimaradt (típus, méret
            vagy darabszám miatt); a levélben megvan.
          </p>
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
              {isTicket
                ? (places ?? []).map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.customerName} · {place.name}
                    </option>
                  ))
                : data.locations.map((l) => (
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
            {isTicket
              ? "Teljes levél megnyitása"
              : "Teljes napi jelentő megnyitása"}
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-pilot-grey-600">
            {item.mail.originalText}
          </p>
        </details>
        {item.status === "PENDING" ? (
          <div className="flex flex-wrap items-center gap-3">
            <PilotButton
              disabled={busy || !department || (!isTicket && !data.openedBy)}
              onClick={() => onDecide(item, "accept", department, author)}
              aria-label={`Elfogadom: ${item.title}`}
              aria-describedby={
                department ? undefined : `accept-hint-${item.id}`
              }
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
            {/* MIÉRT HALVÁNY AZ ELFOGADOM (Picasso 3.17): amíg nincs helyszín, egy mondat megmondja; ugyanaz a súgó-stílus, mint az űrlapokon */}
            {department ? null : (
              <p
                id={`accept-hint-${item.id}`}
                className={PILOT_FIELD_HINT_CLASS}
              >
                Előbb válassz helyszínt.
              </p>
            )}
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
  const [ticketSync, setTicketSync] = useState<TicketMailIntakeStatus>();
  /** Forrás szerinti szűrés (kártya ec7b947b): minden vázlat, csak a ticket@ levelek, vagy csak a Cápasuli jelentők. */
  const [source, setSource] = useState<ServiceDraftSource | "ALL">("ALL");
  const [places, setPlaces] = useState<ServiceDraftPlace[]>();
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
          source === "ALL" ? undefined : source,
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
    [admin, session, status, source],
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
    void serviceDraftsApi
      .ticketMailStatus(session.token ?? "", abort.signal)
      .then(setTicketSync)
      .catch(() => {});
    return () => abort.abort();
  }, [load, admin, session]);
  // A ticket@ vázlat helyszín-készlete egyszer töltődik be, amint a listán van ilyen vázlat.
  const hasTicketDraft = !!data?.items.some(
    (item) => item.source === "TICKET_MAIL",
  );
  useEffect(() => {
    if (!admin || !session || !hasTicketDraft || places) return;
    const abort = new AbortController();
    serviceDraftsApi
      .places(session.token ?? "", abort.signal)
      .then((result) => setPlaces(result.items))
      .catch(() => {
        if (!abort.signal.aborted) setError("A helyszínek nem tölthetők be.");
      });
    return () => abort.abort();
  }, [admin, session, hasTicketDraft, places]);
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
    <PilotThemeRoot
      bleed
      className={`min-h-screen bg-pilot-grey-50 ${PAGE_GUTTER_X} py-8 space-y-6 [&_h1]:!font-[inherit] [&_h2]:!font-[inherit]`}
    >
      <PageHeader
        eyebrow="Szerviz"
        title="Piszkozatok"
        description="A napi jelentőből és a ticket@ címre érkezett levelekből kiemelt kérések. Hibajegy csak az elfogadás után jön létre."
      />
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
      {ticketSync && (
        <details className="text-xs text-pilot-grey-500">
          <summary className="cursor-pointer">
            Ticket postafiók feldolgozás:{" "}
            {ticketSync.enabled
              ? "bekapcsolva"
              : ticketSync.switchReason === "UNRECOGNISED"
                ? "ismeretlen kapcsolóérték"
                : "kikapcsolva"}
          </summary>
          <p className="mt-2 break-words">
            {ticketSync.mailbox} · {ticketSync.intervalMinutes} perc
          </p>
          {!ticketSync.configured && (
            <p>A ticket postafiók olvasó hozzáférése nincs beállítva.</p>
          )}
          {ticketSync.lastRunAt && (
            <p>
              Utolsó futás:{" "}
              {new Date(ticketSync.lastRunAt).toLocaleString("hu-HU")}
            </p>
          )}
          {ticketSync.lastError && <p role="alert">{ticketSync.lastError}</p>}
        </details>
      )}
      <div
        role="tablist"
        aria-label="Piszkozat forrása"
        className="flex flex-wrap gap-3"
      >
        {(
          [
            ["ALL", "Minden forrás"],
            ["TICKET_MAIL", "Ticket levelek"],
            ["CAPASULI_DAILY_REPORT", "Cápasuli jelentők"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={source === value}
            onClick={() => {
              setSource(value);
              setNotice(undefined);
            }}
            className={`rounded-md px-3 py-2 text-xs ${source === value ? "bg-pilot-aqua-50 text-pilot-aqua-700" : "bg-pilot-grey-100 text-pilot-grey-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
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
            className={`rounded-md px-3 py-2 text-xs ${status === value ? "bg-pilot-aqua-50 text-pilot-aqua-700" : "bg-pilot-grey-100 text-pilot-grey-600"}`}
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
      {data &&
        status === "PENDING" &&
        !data.openedBy &&
        data.items.some((item) => item.source !== "TICKET_MAIL") && (
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
          places={places}
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
