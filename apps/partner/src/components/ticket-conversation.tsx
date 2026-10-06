"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MESSAGE_TEXT_MAX_LENGTH,
  type PartnerConversationMessage,
} from "@acropora/types";
import { PilotButton, PilotCard, PilotCardHeader } from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import {
  CONVERSATION_REFRESH_MS,
  authorLine,
  mergeConversation,
  newClientMessageId,
  sendableText,
} from "@/lib/ticket-conversation";

const time = new Intl.DateTimeFormat("hu-HU", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * A HIBAJEGY BESZÉLGETÉSE A PORTÁLON (kártya 084e2c24; Balázs, 2026-10-06:
 * „Mehet az 1-2”). A partner itt ír a hibajegyről az Acropora munkatársainak,
 * és itt olvassa a válaszukat. Csak szöveg; a belső beszélgetés ide nem jön
 * (a szerver dönt minden hívásnál, a hibajegy láthatóságából).
 *
 * Élő folyam a portálon nincs: a lap betöltéskor, küldés után, és amíg a fül
 * látható, félpercenként néz rá.
 */
export function TicketConversation({ ticketId }: { ticketId: string }) {
  const [items, setItems] = useState<PartnerConversationMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // egy üzenet újraküldése ugyanazzal az azonosítóval megy, amíg el nem ment
  const pendingId = useRef<string | null>(null);
  const alive = useRef(true);
  // a régebbi lap kurzora csak az első betöltéskor jön a frissítésből: utána
  // a „Korábbi üzenetek” gomb viszi tovább
  const firstLoad = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const page = await partnerApi.ticketConversation(ticketId);
      if (!alive.current) return;
      setItems((current) => mergeConversation(current, page.items));
      if (firstLoad.current) {
        firstLoad.current = false;
        setOlderCursor(page.olderCursor);
      }
      setLoaded(true);
      setError(null);
    } catch (caught) {
      if (!alive.current) return;
      setLoaded(true);
      setError(
        caught instanceof Error
          ? caught.message
          : "Az üzenetek most nem tölthetők be.",
      );
    }
  }, [ticketId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, CONVERSATION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function loadOlder() {
    if (!olderCursor) return;
    setLoadingOlder(true);
    try {
      const page = await partnerApi.ticketConversation(ticketId, olderCursor);
      if (!alive.current) return;
      setItems((current) => mergeConversation(current, page.items));
      setOlderCursor(page.olderCursor);
    } catch (caught) {
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "A korábbi üzenetek most nem tölthetők be.",
        );
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }

  async function send() {
    const message = sendableText(text);
    if (!message) return;
    pendingId.current ??= newClientMessageId();
    setSending(true);
    try {
      const sent = await partnerApi.sendTicketMessage(
        ticketId,
        message,
        pendingId.current,
      );
      if (!alive.current) return;
      pendingId.current = null;
      setText("");
      setError(null);
      setItems((current) => mergeConversation(current, [sent]));
    } catch (caught) {
      // a szöveg és az azonosító marad: az újra gomb ugyanazt küldi
      if (alive.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Az üzenet nem ment el. Kérjük, próbálja újra.",
        );
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <PilotCard>
      <PilotCardHeader title="Üzenetek" />
      <div className="space-y-4 px-5 py-4">
        {olderCursor ? (
          <div className="flex justify-center">
            <PilotButton
              variant="ghost"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Betöltés…" : "Korábbi üzenetek"}
            </PilotButton>
          </div>
        ) : null}

        {!loaded ? (
          <p className="text-sm text-pilot-grey-400">Üzenetek betöltése…</p>
        ) : items.length === 0 ? (
          <p className="text-sm italic text-pilot-grey-500">
            Még nincs üzenet. Ha kérdése van a hibajeggyel kapcsolatban, írjon
            nekünk itt.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((message) => (
              <li
                key={message.id}
                className={
                  message.mine
                    ? "ml-8 self-end rounded-lg bg-pilot-aqua-50 px-3 py-2"
                    : "mr-8 self-start rounded-lg bg-pilot-grey-50 px-3 py-2"
                }
              >
                <p className="text-xs font-medium text-pilot-grey-500">
                  {authorLine(message)} ·{" "}
                  {time.format(new Date(message.createdAt))}
                  {message.editedAt ? " · szerkesztve" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-pilot-grey-900">
                  {message.text}
                </p>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="space-y-2">
          {/* natív textarea: a készletnek nincs többsoros mezője (lásd ticket-fields-editor) */}
          <textarea
            aria-label="Üzenet az Acropora munkatársainak"
            placeholder="Üzenet az Acropora munkatársainak…"
            value={text}
            rows={3}
            maxLength={MESSAGE_TEXT_MAX_LENGTH}
            onChange={(event) => {
              setText(event.target.value);
              // megváltozott szöveg új üzenet: új azonosítóval megy
              pendingId.current = null;
            }}
            className="w-full rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
          <div className="flex justify-end">
            <PilotButton
              disabled={sending || sendableText(text) === null}
              onClick={() => void send()}
            >
              {sending ? "Küldés…" : "Küldés"}
            </PilotButton>
          </div>
        </div>
      </div>
    </PilotCard>
  );
}
