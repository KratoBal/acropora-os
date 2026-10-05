"use client";

import type { MessageStreamEvent } from "@acropora/types";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { MESSAGE_STREAM_URL, messagesApi } from "@/lib/api/messages";
import { useAuth } from "@/components/auth/auth-provider";
import { isNavigationEntryVisible } from "@acropora/types";

/** Látja-e a bejelentkezett kolléga az Üzeneteket. */
export function useMessagesEnabled(): boolean {
  const { session } = useAuth();
  return Boolean(
    session && isNavigationEntryVisible("messages", session.user.role),
  );
}

/**
 * AZ ÜZENET-FOLYAM EGY KAPCSOLATON (kártya 51d7aba0). A sidebar-jelvény, a
 * fejléc ikonja és a beszélgetés ugyanarra a folyamra iratkozik fel: egy lapon
 * egy `EventSource` fut, nem három.
 *
 * Az esemény csak azonosítót hoz; a hallgató maga olvassa újra, amit kell.
 * Megszakadás után az `EventSource` magától csatlakozik vissza, és a
 * visszacsatlakozáskor egy `resync` jelzés megy ki: a kiesés alatt érkezett
 * üzenetekről a folyam nem tud, a hallgató újraolvas.
 */
export type MessageStreamSignal = MessageStreamEvent | { type: "resync" };
type Listener = (signal: MessageStreamSignal) => void;

const STREAM_EVENTS: MessageStreamEvent["type"][] = [
  "message.created",
  "conversation.created",
  "conversation.read",
  "message.updated",
];

const StreamContext = createContext<{
  subscribe: (listener: Listener) => () => void;
} | null>(null);

/**
 * A FOLYAM CSAK ANNAK NYÍLIK, aki a menüben is látja az Üzeneteket
 * (`messages.use`): a döntés ugyanaz a navigációs szabály, nem egy második.
 */
export function MessageStreamProvider({ children }: { children: ReactNode }) {
  const enabled = useMessagesEnabled();
  const listeners = useRef(new Set<Listener>());
  const [value] = useState(() => ({
    subscribe(listener: Listener) {
      listeners.current.add(listener);
      return () => void listeners.current.delete(listener);
    },
  }));

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const emit = (signal: MessageStreamSignal) =>
      listeners.current.forEach((listener) => listener(signal));
    const source = new EventSource(MESSAGE_STREAM_URL, {
      withCredentials: true,
    });
    let dropped = false;
    for (const type of STREAM_EVENTS)
      source.addEventListener(type, (event) => {
        try {
          emit(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          emit({ type: "resync" });
        }
      });
    source.onerror = () => {
      dropped = true;
    };
    source.onopen = () => {
      if (dropped) {
        dropped = false;
        emit({ type: "resync" });
      }
    };
    return () => source.close();
  }, [enabled]);

  return (
    <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
  );
}

/** Feliratkozás a folyamra; a hallgató a legutóbbi változatával fut. */
export function useMessageStream(listener: Listener) {
  const context = useContext(StreamContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!context) return;
    return context.subscribe((signal) => latest.current(signal));
  }, [context]);
}

/**
 * AZ OLVASATLAN-SZÁM a sidebarnak és a fejlécnek. Induláskor és minden
 * folyam-jelzésre újraolvas (rövid összevonással), és amikor a lap újra
 * előtérbe kerül.
 */
export function useMessagesUnread(token: string, enabled: boolean): number {
  const [total, setTotal] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useRef(() => {});
  refresh.current = () => {
    if (!enabled) return;
    void messagesApi
      .unread(token)
      .then((response) => setTotal(response.total))
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!enabled) {
      setTotal(0);
      return;
    }
    refresh.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, token]);

  useMessageStream(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => refresh.current(), 300);
  });

  return total;
}
