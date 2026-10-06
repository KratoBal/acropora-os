"use client";

import {
  MESSAGE_SEARCH_MIN_LENGTH,
  type ConversationContextCard,
  type ConversationListItem,
  type ConversationNotificationState,
  type ConversationNotifyMode,
  type MessageSearchResponse,
  type PinnedItem,
  type SharedAttachmentItem,
} from "@acropora/types";
import { Button, Icon, Input } from "@acropora/ui";
import { useEffect, useState } from "react";

import { ROLE_LABELS } from "@/components/users/role-labels";
import { attachmentUrl, messagesApi } from "@/lib/api/messages";

import {
  Monogram,
  conversationName,
  isAssistantConversation,
} from "./conversation-parts";
import { fileSizeLabel } from "./outbox";
import { MembershipSection } from "./phase4-dialogs";
import {
  fileTypeLabel,
  notificationLabel,
  notificationOptions,
  pinnedMeta,
  searchCountLabel,
  searchHitMeta,
} from "./phase3";
import { isPartnerConversation } from "./phase4";

/**
 * A KERESÉS ÉS A KITŰZÖTT ELEMEK FIÓKJA (Figma 453:491, „Search and pin”):
 * keresés a megnyitott beszélgetésben (Balázs, 2026-10-05: csak itt), alatta a
 * kitűzött üzenetek. Mindkettőből „Ugrás” vezet az üzenethez.
 */
export function SearchAndPinsPanel({
  token,
  conversationId,
  pinsVersion,
  onJump,
  onClose,
}: {
  token: string;
  conversationId: string;
  /** Nő, ha egy kitűzés változott: a lista újraolvasódik. */
  pinsVersion: number;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MessageSearchResponse | null>(null);
  const [pins, setPins] = useState<PinnedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  useEffect(() => {
    const q = query.trim();
    if ([...q].length < MESSAGE_SEARCH_MIN_LENGTH) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void messagesApi
        .search(token, conversationId, q, controller.signal)
        .then((response) => {
          setResult(response);
          setError(null);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("A keresés nem sikerült.");
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [conversationId, query, token]);

  useEffect(() => {
    const controller = new AbortController();
    void messagesApi
      .pins(token, conversationId, controller.signal)
      .then((response) => setPins(response.items))
      .catch(() => {
        if (!controller.signal.aborted) setPins([]);
      });
    return () => controller.abort();
  }, [conversationId, pinsVersion, token]);

  return (
    <aside
      aria-label="Keresés és kitűzött elemek"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-pilot-grey-200 bg-white p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-pilot-grey-900">
          Keresés a beszélgetésben
        </h2>
        <button type="button" aria-label="A fiók bezárása" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {/* az Input saját <label>-be csomagol, ezért a név közvetlenül az inputon áll */}
      <div className="relative block">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
        />
        <Input
          autoFocus
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Keresés…"
          aria-label="Keresés a beszélgetésben"
          className="pl-9"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {error}
        </p>
      ) : null}
      {result ? (
        result.items.length === 0 ? (
          <div data-testid="search-empty">
            <p className="text-sm font-medium text-pilot-grey-900">
              Nincs találat
            </p>
            <p className="text-xs text-pilot-grey-600">
              Próbálj másik kifejezést vagy rövidebb keresést.
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs text-pilot-grey-500">
              {searchCountLabel(result.total, result.totalCapped)}
            </p>
            <ul className="space-y-2" aria-label="Találatok">
              {result.items.map((hit) => (
                <li
                  key={hit.messageId}
                  className="border border-pilot-grey-200 px-3 py-2"
                >
                  <p className="text-xs text-pilot-grey-500">
                    {searchHitMeta(hit, now)}
                  </p>
                  <p className="text-sm text-pilot-grey-900">{hit.snippet}</p>
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-pilot-aqua-700"
                    onClick={() => onJump(hit.messageId)}
                  >
                    Ugrás
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      <div className="border-t border-pilot-grey-200 pt-4">
        <h2 className="mb-2 text-sm font-semibold text-pilot-grey-900">
          Kitűzött elemek
        </h2>
        {pins && pins.length === 0 ? (
          <div data-testid="pins-empty">
            <p className="text-sm font-medium text-pilot-grey-900">
              Nincs kitűzött elem
            </p>
            <p className="text-xs text-pilot-grey-600">
              A fontos üzeneteket itt gyűjti a rendszer.
            </p>
          </div>
        ) : null}
        <ul className="space-y-2" aria-label="Kitűzött elemek">
          {(pins ?? []).map((pin) => (
            <li key={pin.messageId}>
              <button
                type="button"
                className="flex w-full items-start gap-2 border border-pilot-grey-200 px-3 py-2 text-left hover:bg-pilot-grey-50"
                onClick={() => onJump(pin.messageId)}
              >
                <span aria-hidden="true">📌</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-pilot-grey-900">
                    {pin.title}
                  </span>
                  <span className="block text-xs text-pilot-grey-500">
                    {pinnedMeta(pin, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

type DetailsTab = "members" | "files" | "settings";

/**
 * A BESZÉLGETÉS ADATAI (Figma 450:260): tagok, megosztott fájlok, értesítési
 * beállítás, és a 4. fázistól csoportban a tag hozzáadása, a kilépés és a
 * kötés munkalaphoz vagy hibajegyhez (`MembershipSection`). Direkt
 * beszélgetésnél csak a másik fél áll a listán.
 */
export function ConversationDetailsPanel({
  token,
  conversation,
  context = null,
  onClose,
  onChanged = () => undefined,
  onLeft = () => undefined,
}: {
  token: string;
  conversation: ConversationListItem;
  /** 4. fázis: a kapcsolt munkalap vagy hibajegy kártyája. */
  context?: ConversationContextCard | null;
  onClose: () => void;
  /** 4. fázis: tag, kötés vagy leválasztás után a nézet újraolvas. */
  onChanged?: () => void;
  /** 4. fázis: a néző kilépett. */
  onLeft?: () => void;
}) {
  const [tab, setTab] = useState<DetailsTab>("members");
  const [media, setMedia] = useState<SharedAttachmentItem[] | null>(null);
  const [files, setFiles] = useState<SharedAttachmentItem[] | null>(null);
  const [notification, setNotification] = useState<
    ConversationNotificationState | undefined
  >(undefined);
  const [choice, setChoice] = useState<ConversationNotifyMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const now = new Date();
  const name = conversationName(conversation);

  useEffect(() => {
    const controller = new AbortController();
    void messagesApi
      .detail(token, conversation.id, controller.signal)
      .then((detail) => setNotification(detail.notification))
      .catch(() => undefined);
    return () => controller.abort();
  }, [conversation.id, token]);

  useEffect(() => {
    if (tab !== "files") return;
    const controller = new AbortController();
    void Promise.all([
      messagesApi.shared(token, conversation.id, "IMAGE", controller.signal),
      messagesApi.shared(token, conversation.id, "FILE", controller.signal),
    ])
      .then(([images, documents]) => {
        setMedia(images.items);
        setFiles(documents.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMedia([]);
          setFiles([]);
        }
      });
    return () => controller.abort();
  }, [conversation.id, tab, token]);

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      setNotification(
        await messagesApi.setNotification(token, conversation.id, choice),
      );
      setChoice(null);
      setMessage("A beállítás elmentve.");
    } catch {
      setMessage("A beállítás nem mentődött el.");
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: DetailsTab; label: string }[] = [
    { id: "members", label: "Tagok" },
    { id: "files", label: "Fájlok" },
    { id: "settings", label: "Beállítások" },
  ];

  return (
    <aside
      aria-label="Beszélgetés adatai"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-pilot-grey-200 bg-white p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-pilot-grey-900">
          Beszélgetés adatai
        </h2>
        <button type="button" aria-label="A fiók bezárása" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <Monogram
          name={name}
          assistant={isAssistantConversation(conversation)}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-pilot-grey-900">
            {name}
          </p>
          <p className="text-xs text-pilot-grey-500">
            {conversation.members.length + 1} résztvevő
          </p>
        </div>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-pilot-grey-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`px-3 py-2 text-xs ${
              tab === item.id
                ? "border-b-2 border-pilot-accent-warm font-medium text-pilot-grey-900"
                : "text-pilot-grey-600"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <div>
          <p className="mb-2 text-xs font-medium text-pilot-grey-500">
            Résztvevők
          </p>
          <ul className="space-y-2" aria-label="Résztvevők">
            {conversation.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3">
                <Monogram
                  name={member.name}
                  assistant={member.kind === "assistant"}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-pilot-grey-900">
                    {member.name}
                  </span>
                  <span className="block text-xs text-pilot-grey-500">
                    {ROLE_LABELS[member.role]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-pilot-grey-200 pt-3 text-xs">
            <p className="font-medium text-pilot-grey-900">Értesítések</p>
            <p className="text-pilot-grey-600" data-testid="notification-label">
              {notificationLabel(notification, now)}
            </p>
          </div>
          <MembershipSection
            token={token}
            conversation={conversation}
            context={context}
            onChanged={onChanged}
            onLeft={onLeft}
          />
        </div>
      ) : null}

      {tab === "files" ? (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-pilot-grey-500">
              Média
            </p>
            {media && media.length === 0 ? (
              <p className="text-xs text-pilot-grey-500">Még nincs kép.</p>
            ) : null}
            <ul className="grid grid-cols-3 gap-2" aria-label="Média">
              {(media ?? []).map((item) => (
                <li key={item.id}>
                  <a
                    href={attachmentUrl(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    title={item.fileName}
                  >
                    {item.hasThumbnail ? (
                      <img
                        src={attachmentUrl(item.id, "thumbnail")}
                        alt={item.fileName}
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <span className="block truncate text-xs">
                        {item.fileName}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-pilot-grey-500">
              Fájlok
            </p>
            {files && files.length === 0 ? (
              <p className="text-xs text-pilot-grey-500">Még nincs fájl.</p>
            ) : null}
            <ul className="space-y-2" aria-label="Fájlok">
              {(files ?? []).map((item) => (
                <li key={item.id}>
                  <a
                    href={attachmentUrl(item.id)}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span aria-hidden="true">📎</span>
                    <span className="min-w-0">
                      <span className="block truncate text-pilot-grey-900 underline">
                        {item.fileName}
                      </span>
                      <span className="block text-pilot-grey-500">
                        {fileTypeLabel(item.fileName)} ·{" "}
                        {fileSizeLabel(item.sizeBytes)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-pilot-grey-600">
            Állítsd be, mikor kapj push értesítést erről a beszélgetésről.
          </legend>
          <p className="text-xs text-pilot-grey-500">
            Most: {notificationLabel(notification, now)}
          </p>
          {notificationOptions(notification, now).map((option) => (
            <label
              key={option.mode}
              className="flex cursor-pointer items-center gap-3 border border-pilot-grey-200 px-3 py-2"
            >
              <input
                type="radio"
                name="ertesites"
                checked={choice === option.mode}
                onChange={() => setChoice(option.mode)}
                className="accent-pilot-accent-warm"
              />
              <span>
                <span className="block text-sm text-pilot-grey-900">
                  {option.label}
                </span>
                <span className="block text-xs text-pilot-grey-500">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
          {message ? (
            <p role="status" className="text-xs text-pilot-grey-600">
              {message}
            </p>
          ) : null}
          <Button
            onClick={() => void save()}
            disabled={!choice || saving}
            className="w-full bg-pilot-accent-warm hover:bg-pilot-accent-warm-text"
          >
            Beállítások mentése
          </Button>
        </fieldset>
      ) : null}
    </aside>
  );
}

/**
 * TOVÁBBÍTÁS (Figma 453:244, „Továbbítás”). Figma-terv nincs rá: az „Új
 * beszélgetés” ablak mintáját követi. Egy cél kérésenként; a mostani
 * beszélgetés nem cél.
 */
export function ForwardDialog({
  token,
  currentConversationId,
  onClose,
  onForward,
}: {
  token: string;
  currentConversationId: string;
  onClose: () => void;
  onForward: (target: ConversationListItem) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [chosen, setChosen] = useState<ConversationListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void messagesApi
      .list(token, controller.signal)
      .then((response) =>
        setItems(
          // a partneres beszélgetésbe nem lehet továbbítani (bd46ff05, #1531: 400)
          response.items.filter(
            (item) =>
              item.id !== currentConversationId && !isPartnerConversation(item),
          ),
        ),
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setError("A beszélgetések listája nem töltődött be.");
      });
    return () => controller.abort();
  }, [currentConversationId, token]);

  const needle = query.trim().toLowerCase();
  const listed = (items ?? []).filter(
    (item) => !needle || conversationName(item).toLowerCase().includes(needle),
  );

  const submitForward = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await onForward(chosen);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A továbbítás nem sikerült.",
      );
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tovabbitas-cim"
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 border border-pilot-grey-200 bg-white p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2
            id="tovabbitas-cim"
            className="text-2xl font-semibold text-pilot-grey-900"
          >
            Továbbítás
          </h2>
          <p className="text-sm text-pilot-grey-600">
            Válaszd ki, melyik beszélgetésbe menjen. Az eredeti szerző neve
            látszani fog.
          </p>
        </div>
        <div className="relative block">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Beszélgetés keresése…"
            aria-label="Beszélgetés keresése"
            className="pl-9"
          />
        </div>
        <ul
          className="min-h-0 flex-1 overflow-y-auto"
          aria-label="Beszélgetések"
        >
          {listed.map((item) => {
            const label = conversationName(item);
            return (
              <li key={item.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 px-3 py-3 ${
                    chosen?.id === item.id
                      ? "bg-pilot-accent-warm-soft"
                      : "hover:bg-pilot-grey-50"
                  }`}
                >
                  <Monogram name={label} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-pilot-grey-900">
                    {label}
                  </span>
                  <input
                    type="radio"
                    name="tovabbitas-cel"
                    checked={chosen?.id === item.id}
                    onChange={() => setChosen(item)}
                    className="size-5 accent-pilot-accent-warm"
                  />
                </label>
              </li>
            );
          })}
          {items && listed.length === 0 ? (
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Mégse
          </Button>
          <Button
            onClick={() => void submitForward()}
            disabled={busy || !chosen}
            className="bg-pilot-accent-warm hover:bg-pilot-accent-warm-text"
          >
            Továbbítás
          </Button>
        </div>
      </div>
    </div>
  );
}
