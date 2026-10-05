"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotButton } from "@/components/pilot/pilot-ui";
import { messagesApi } from "@/lib/api/messages";

import { useMessagesEnabled } from "./message-stream";

/**
 * „BESZÉLGETÉS” A MUNKALAPON ÉS A HIBAJEGYEN (Üzenetek 4. fázis, terv 2.4):
 * a tárgy élő beszélgetését nyitja, vagy egy újat indít (a szerver dönti el,
 * és a kérdezőt felveszi). Akinek nincs Üzenetek joga, annak nem jelenik meg.
 */
export function ContextConversationButton({
  kind,
  objectId,
}: {
  kind: "worksheet" | "service-job";
  objectId: string;
}) {
  const { session } = useAuth();
  const enabled = useMessagesEnabled();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || !session) return null;

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const conversation = await messagesApi.openContext(
        session.token ?? "",
        kind,
        objectId,
      );
      router.push(`/uzenetek?c=${encodeURIComponent(conversation.id)}`);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A beszélgetés nem nyílt meg.",
      );
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <PilotButton
        variant="secondary"
        disabled={busy}
        onClick={() => void open()}
      >
        Beszélgetés
      </PilotButton>
      {error ? (
        <span role="alert" className="text-xs text-pilot-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
