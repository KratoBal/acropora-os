"use client";

import type {
  ConversationContextCard,
  ConversationContextType,
  ConversationListItem,
  ConversationPerson,
} from "@acropora/types";
import { Button, ConfirmDialog, Icon, Input } from "@acropora/ui";
import { useEffect, useState } from "react";

import { ROLE_LABELS } from "@/components/users/role-labels";
import { messagesApi } from "@/lib/api/messages";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";

import {
  Monogram,
  assistantFirst,
  conversationName,
} from "./conversation-parts";
import {
  canManageMembers,
  contextCardParts,
  contextCardTitle,
  isPartnerConversation,
} from "./phase4";

const failure = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * A BESZÉLGETÉS TÖRLÉSE (fecbb1fe; Balázs, 2026-10-06 13:15:49 UTC): a
 * létrehozónak, az adminnak, és Sutyerák kettes beszélgetésében a dolgozónak.
 * Hogy a néző törölhet-e, a szerver mondja meg (`canDelete`); a gomb csak
 * akkor látszik. Megerősítő ablak a beszélgetés nevével.
 */
export function DeleteConversationSection({
  token,
  conversation,
  onDeleted,
}: {
  token: string;
  conversation: ConversationListItem;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = conversationName(conversation);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await messagesApi.deleteConversation(token, conversation.id);
      setConfirming(false);
      onDeleted();
    } catch (cause) {
      setConfirming(false);
      setError(failure(cause, "A törlés nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-pilot-grey-200 pt-3 text-xs">
      <button
        type="button"
        disabled={busy}
        className="text-pilot-red-700 hover:underline"
        onClick={() => setConfirming(true)}
      >
        Beszélgetés törlése
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-pilot-red-700">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Törlöd a(z) „${name}” beszélgetést?`}
        consequence="Mindenki elől eltűnik, az üzeneteivel és a csatolmányaival együtt. A többiek nem kapnak róla értesítést."
        recovery="A törlés nem vonható vissza a felületen."
        confirmLabel="Törlés"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/**
 * A „BESZÉLGETÉS ADATAI” 4. FÁZISA (terv 2.3 és 2.4; Figma 450:474, 450:260):
 * tag hozzáadása és kilépés csoportban (Balázs, 2026-10-05: a kettő együtt),
 * és a kötés munkalaphoz vagy hibajegyhez, leválasztással. Minden hozzáadás,
 * kilépés és kötés sorként látszik a beszélgetésben (a szerver írja).
 */
export function MembershipSection({
  token,
  conversation,
  context,
  onChanged,
  onLeft,
}: {
  token: string;
  conversation: ConversationListItem;
  context: ConversationContextCard | null;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [dialog, setDialog] = useState<"add" | "link" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a partneres beszélgetés tagjai és kötése rögzített (bd46ff05)
  if (
    !canManageMembers(conversation.type) ||
    isPartnerConversation(conversation)
  )
    return null;

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await messagesApi.leave(token, conversation.id);
      setLeaving(false);
      onLeft();
    } catch (cause) {
      setLeaving(false);
      setError(failure(cause, "A kilépés nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await messagesApi.unlinkContext(token, conversation.id);
      onChanged();
    } catch (cause) {
      setError(failure(cause, "A leválasztás nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-pilot-grey-200 pt-3 text-xs">
      <div>
        <p className="font-medium text-pilot-grey-900">Kapcsolás</p>
        {context ? (
          <div data-testid="drawer-context" className="mt-1 space-y-1">
            <p className="text-pilot-grey-700">
              {contextCardTitle(context.type)} ·{" "}
              {contextCardParts(context).join(" · ")}
            </p>
            <button
              type="button"
              disabled={busy}
              className="text-pilot-red-700 hover:underline"
              onClick={() => void unlink()}
            >
              Leválasztás
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-1 text-pilot-aqua-700 hover:underline"
            onClick={() => setDialog("link")}
          >
            Kapcsolás munkalaphoz vagy hibajegyhez
          </button>
        )}
      </div>
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          className="flex items-center gap-1 text-pilot-aqua-700 hover:underline"
          onClick={() => setDialog("add")}
        >
          <Icon name="plus" size={14} />
          Tag hozzáadása
        </button>
        <button
          type="button"
          className="text-pilot-red-700 hover:underline"
          onClick={() => setLeaving(true)}
        >
          Kilépés a beszélgetésből
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-pilot-red-700">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={leaving}
        title="Kilépsz a beszélgetésből?"
        consequence="Nem kapsz több üzenetet ebből a csoportból, és a beszélgetés eltűnik a listádról. A többiek egy sorban látják, hogy kiléptél."
        recovery="Visszakerülni csak úgy tudsz, ha egy tag újra hozzáad."
        confirmLabel="Kilépés"
        onCancel={() => setLeaving(false)}
        onConfirm={() => void leave()}
      />
      {dialog === "add" ? (
        <AddMembersDialog
          token={token}
          conversation={conversation}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}
      {dialog === "link" ? (
        <LinkContextDialog
          token={token}
          conversationId={conversation.id}
          onClose={() => setDialog(null)}
          onLinked={() => {
            setDialog(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** A párbeszéd kerete: ugyanaz, mint az „Új beszélgetés” ablaké. */
function DialogFrame({
  labelId,
  title,
  hint,
  onClose,
  children,
}: {
  labelId: string;
  title: string;
  hint: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 border border-pilot-grey-200 bg-white p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2
            id={labelId}
            className="text-2xl font-semibold text-pilot-grey-900"
          >
            {title}
          </h2>
          <p className="text-sm text-pilot-grey-600">{hint}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * TAG HOZZÁADÁSA: az „Új beszélgetés” kollégaválasztója, a mostani tagok
 * nélkül. A kereshetők listáját a szerver adja (partner, gépi ágens és
 * inaktív kolléga nincs rajta), és a felvételt is a szerver szűri.
 */
export function AddMembersDialog({
  token,
  conversation,
  onClose,
  onAdded,
}: {
  token: string;
  conversation: ConversationListItem;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ConversationPerson[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memberIds = new Set(
    conversation.members.map((member) => member.userId),
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void messagesApi
        .people(token, query.trim(), controller.signal)
        .then((response) => setPeople(response.items))
        .catch(() => {
          if (!controller.signal.aborted)
            setError("A kollégák listája nem töltődött be.");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, token]);

  const listed = assistantFirst(
    people.filter((person) => !memberIds.has(person.userId)),
  );
  const toggle = (userId: string) =>
    setChosen((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await messagesApi.addMembers(token, conversation.id, chosen);
      onAdded();
    } catch (cause) {
      setError(failure(cause, "A hozzáadás nem sikerült."));
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      labelId="tag-hozzaadasa-cim"
      title="Tag hozzáadása"
      hint="Válaszd ki, kit veszel fel a csoportba. A hozzáadás látszik a beszélgetésben."
      onClose={onClose}
    >
      <label className="relative block">
        <span className="sr-only">Kolléga keresése</span>
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
        />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Kolléga keresése…"
          className="pl-9"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Kollégák">
        {listed.map((person) => (
          <li key={person.userId}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-pilot-grey-50">
              <Monogram
                name={person.name}
                assistant={person.kind === "assistant"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-pilot-grey-900">
                  {person.name}
                </span>
                <span className="block truncate text-xs text-pilot-grey-600">
                  {person.kind === "assistant"
                    ? "Segéd, kérdezd bármiről"
                    : ROLE_LABELS[person.role]}
                </span>
              </span>
              <input
                type="checkbox"
                checked={chosen.includes(person.userId)}
                onChange={() => toggle(person.userId)}
                className="size-5 accent-pilot-accent-warm"
              />
            </label>
          </li>
        ))}
        {listed.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-pilot-grey-500">
            Nincs találat.
          </li>
        ) : null}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Mégse
        </Button>
        <Button
          onClick={() => void add()}
          disabled={chosen.length === 0 || busy}
          className="bg-pilot-accent-warm hover:bg-pilot-accent-warm-text"
        >
          Hozzáadás
        </Button>
      </div>
    </DialogFrame>
  );
}

type LinkCandidate = { id: string; number: string; partner: string | null };

/**
 * KAPCSOLÁS MUNKALAPHOZ VAGY HIBAJEGYHEZ: szám szerinti keresés a meglévő
 * szerviz-listákon (a szerver keres, nem a betöltött lap). A kötést a szerver
 * ellenőrzi: a szervizjog, és hogy a tárgynak nincs-e már beszélgetése.
 */
export function LinkContextDialog({
  token,
  conversationId,
  onClose,
  onLinked,
}: {
  token: string;
  conversationId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [type, setType] = useState<ConversationContextType>("WORKSHEET");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const request =
        type === "WORKSHEET"
          ? worksheetsApi
              .list(
                token,
                new URLSearchParams({ search: needle, pageSize: "10" }),
                controller.signal,
              )
              .then((response) =>
                response.items.map((item) => ({
                  id: item.id,
                  number: item.number ?? item.label ?? "szám nélkül",
                  partner: item.customerName,
                })),
              )
          : serviceJobsApi
              .list(token, "all", controller.signal, needle)
              .then((response) =>
                response.items.slice(0, 10).map((item) => ({
                  id: item.id,
                  number: item.jobNumber,
                  partner: item.customerName,
                })),
              );
      void request.then(setCandidates).catch(() => {
        if (!controller.signal.aborted) setError("A keresés nem sikerült.");
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, token, type]);

  const link = async (candidate: LinkCandidate) => {
    setBusy(true);
    setError(null);
    try {
      await messagesApi.linkContext(token, conversationId, {
        type,
        id: candidate.id,
      });
      onLinked();
    } catch (cause) {
      setError(failure(cause, "A kapcsolás nem sikerült."));
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      labelId="kapcsolas-cim"
      title="Kapcsolás"
      hint="Keresd meg a munkalapot vagy a hibajegyet a száma szerint."
      onClose={onClose}
    >
      <div
        role="radiogroup"
        aria-label="Mihez kapcsolod"
        className="flex gap-4 text-sm"
      >
        {(
          [
            ["WORKSHEET", "Munkalap"],
            ["SERVICE_JOB", "Hibajegy"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="kapcsolas-tipus"
              checked={type === value}
              onChange={() => {
                setType(value);
                setCandidates([]);
              }}
              className="accent-pilot-accent-warm"
            />
            {label}
          </label>
        ))}
      </div>
      <Input
        autoFocus
        aria-label="Szám keresése"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={
          type === "WORKSHEET" ? "pl. BIO-2026-001" : "a hibajegy száma"
        }
      />
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Találatok">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-pilot-grey-50"
              onClick={() => void link(candidate)}
            >
              <span className="text-sm font-medium text-pilot-grey-900">
                {candidate.number}
              </span>
              <span className="truncate text-xs text-pilot-grey-600">
                {candidate.partner ?? ""}
              </span>
            </button>
          </li>
        ))}
        {query.trim() && candidates.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-pilot-grey-500">
            Nincs találat.
          </li>
        ) : null}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Mégse
        </Button>
      </div>
    </DialogFrame>
  );
}
