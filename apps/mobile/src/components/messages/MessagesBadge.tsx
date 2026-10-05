import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useMessageStream } from "@/components/messages/MessageStream";
import { getMessagesUnread } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  appIconBadgeCount,
  refreshesUnread,
} from "@/lib/messages/unread-badge";

export const MESSAGES_UNREAD_KEY = ["messages", "unread"] as const;

/**
 * AZ OLVASATLAN ÜZENETEK SZÁMA AZ APPBAN. A `["messages", …]` előtag alatt
 * áll, tehát minden meglévő érvénytelenítés (olvasás, küldés) magával viszi;
 * az élő folyam és az előtérbe kerülés is újrakéri.
 */
export function useMessagesUnreadTotal(): number {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const enabled = status === "authenticated";
  const unread = useQuery({
    queryKey: MESSAGES_UNREAD_KEY,
    queryFn: getMessagesUnread,
    enabled,
  });
  useMessageStream((signal) => {
    if (refreshesUnread(signal))
      void queryClient.invalidateQueries({ queryKey: MESSAGES_UNREAD_KEY });
  });
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void queryClient.invalidateQueries({ queryKey: MESSAGES_UNREAD_KEY });
    });
    return () => subscription.remove();
  }, [enabled, queryClient]);
  return enabled ? (unread.data?.total ?? 0) : 0;
}

/**
 * AZ APP IKONJÁNAK SZÁMA (`setBadgeCountAsync`, a már beépített
 * `expo-notifications` natív modulja: új build nem kell). Olvasáskor csökken,
 * kijelentkezéskor nulla. Háttérben a push törzse viszi a számot (iOS `badge`).
 * Láthatatlan: csak szinkronizál.
 */
export function MessagesBadgeSync() {
  const { status } = useAuth();
  const total = useMessagesUnreadTotal();
  const count = appIconBadgeCount(total, status === "authenticated");
  useEffect(() => {
    void Notifications.setBadgeCountAsync(count).catch(() => undefined);
  }, [count]);
  return null;
}
