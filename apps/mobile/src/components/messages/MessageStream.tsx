import { fetch as expoFetch } from "expo/fetch";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { environment } from "@/config/env";
import { useAuth } from "@/lib/auth/AuthProvider";
import { authSessionStore } from "@/lib/auth/token-store";
import {
  parseSseChunk,
  reconnectDelayMs,
  type StreamSignal,
} from "@/lib/messages/sse";

/**
 * AZ ÜZENET-FOLYAM A TELEFONON (Üzenetek, kártya 51d7aba0).
 *
 * A React Native-ben nincs `EventSource`, ezért az `expo/fetch` (az `expo`
 * csomag része, NEM új natív modul, tehát OTA-val kimehet) adatfolyamként
 * olvassa a választ, és a `parseSseChunk` szedi szét.
 *
 * CSAK ELŐTÉRBEN FUT. Háttérben a kapcsolatot bontjuk, és az új üzenetről a
 * push szól; előtérbe visszatérve újracsatlakozik, és egy `resync` jelzés
 * megy ki, mert a háttérben töltött időről a folyam nem tud.
 */
type Listener = (signal: StreamSignal) => void;

const StreamContext = createContext<{
  subscribe: (listener: Listener) => () => void;
} | null>(null);

export function MessageStreamProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const listeners = useRef(new Set<Listener>());
  const [value] = useState(() => ({
    subscribe(listener: Listener) {
      listeners.current.add(listener);
      return () => void listeners.current.delete(listener);
    },
  }));

  useEffect(() => {
    if (status !== "authenticated" || !environment.ok) return;
    const apiUrl = environment.config.apiUrl;
    const emit = (signal: StreamSignal) =>
      listeners.current.forEach((listener) => listener(signal));
    let stopped = false;
    let running = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (stopped || running || AppState.currentState !== "active") return;
      running = true;
      controller = new AbortController();
      try {
        const token = await authSessionStore.getToken();
        const response = await expoFetch(`${apiUrl}/messages/stream`, {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`A folyam nem nyílt meg (HTTP ${response.status}).`);
        if (attempt > 0) emit({ type: "resync" });
        attempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          parsed.signals.forEach(emit);
        }
      } catch {
        // a hiba nem állítja meg: visszacsatlakozik, egyre ritkábban
      } finally {
        running = false;
      }
      if (stopped || AppState.currentState !== "active") return;
      timer = setTimeout(() => void run(), reconnectDelayMs(attempt));
      attempt += 1;
    };

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (timer) clearTimeout(timer);
        attempt = 1; // a visszatérés után resync kell
        void run();
      } else {
        if (timer) clearTimeout(timer);
        controller?.abort();
      }
    });
    void run();
    return () => {
      stopped = true;
      subscription.remove();
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [status]);

  return (
    <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
  );
}

/** Feliratkozás a folyamra; a hallgató a legutóbbi változatával fut. */
export function useMessageStream(listener: Listener) {
  const context = useContext(StreamContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    if (!context) return;
    return context.subscribe((signal) => latest.current(signal));
  }, [context]);
}
