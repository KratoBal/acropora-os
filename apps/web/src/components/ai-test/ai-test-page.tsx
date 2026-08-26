"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Textarea,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { aiChatApi, type AiChatReply } from "@/lib/api/ai-chat";

/**
 * Belső AI teszt-felület.
 *
 * A célja egyetlen dolog: a válaszminőség mérhetővé tétele. Ezért nem az a
 * kérdés, hogy szép-e, hanem hogy MINDEN látszik-e, ami alapján egy válasz
 * megítélhető - és hogy a felület megmondja magáról, mi ő.
 *
 * A böngésző az Acropora OS saját munkamenetével beszél, és az AI hozzáférési
 * token soha nem hagyja el a szervert. Ezt az `integrations/ai-chat` végpont
 * biztosítja, nem ez az oldal.
 */

/** Az értékelés négy állapota, Balázs specifikációja szerint. */
const RATINGS = [
  { key: "correct", label: "Helyes" },
  { key: "inaccurate", label: "Pontatlan" },
  { key: "dangerous", label: "Veszélyes" },
  { key: "no-data", label: "Nincs adat" },
] as const;

type RatingKey = (typeof RATINGS)[number]["key"];

interface Exchange {
  question: string;
  reply: AiChatReply;
  rating: RatingKey | null;
}

const MODE_LABELS: Record<string, string> = {
  anonymous: "anonim",
  resolved: "hitelesített vevő",
};

function formatMs(value: number | null): string {
  if (value === null) return "-";
  return `${(value / 1000).toFixed(1)} mp (${value} ms)`;
}

export function AiTestPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AI_TEST_VIEW),
  );

  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canView) {
    return (
      <EmptyState
        title="Nincs jogosultságod ehhez az oldalhoz"
        description="A belső AI teszt-felület megtekintéséhez külön jogosultság kell."
      />
    );
  }

  const ask = async () => {
    const message = question.trim();
    if (!message || pending) return;

    setPending(true);
    setError(null);

    try {
      const reply = await aiChatApi.ask(token, {
        message,
        ...(conversationId ? { conversationId } : {}),
      });

      setExchanges((previous) => [
        ...previous,
        { question: message, reply, rating: null },
      ]);
      if (reply.conversationId) setConversationId(reply.conversationId);
      setQuestion("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A kérés nem jutott el a szerverig.",
      );
    } finally {
      setPending(false);
    }
  };

  const rate = (index: number, rating: RatingKey) => {
    setExchanges((previous) =>
      previous.map((exchange, position) =>
        position === index ? { ...exchange, rating } : exchange,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI teszt"
        description="Belső próbafelület a válaszminőség méréséhez."
      />

      {/*
        A felület megmondja magáról, mi ő. Nem azt akadályozza meg, hogy valaki
        éles kérdést tegyen fel, hanem azt, hogy a VÁLASZT hivatalosnak vegye -
        és azt is kimondja, hogy a hibás viselkedés is a mérés része.
      */}
      <Alert variant="info" title="Ez belső teszt-felület">
        A válaszai nem hivatalosak, és nem helyettesítik az adatbázist. A hibás
        vagy hiányos válasz is a mérés része, nem üzemzavar.
      </Alert>

      <Card>
        <div className="flex flex-col gap-3">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Írd be a kérdést, amit mérni akarsz."
            rows={3}
            disabled={pending}
          />
          <div className="flex items-center gap-3">
            <Button onClick={ask} disabled={pending || !question.trim()}>
              {pending ? "Kérdezek..." : "Kérdés elküldése"}
            </Button>
            {conversationId ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setConversationId(null);
                  setExchanges([]);
                }}
                disabled={pending}
              >
                Új beszélgetés
              </Button>
            ) : null}
          </div>
          {error ? (
            <Alert variant="danger" title="A kérés nem sikerült">
              {error}
            </Alert>
          ) : null}
        </div>
      </Card>

      {exchanges.length === 0 ? (
        <EmptyState
          title="Még nincs kérdés"
          description="A válasz mellett látszik a beszélgetés azonosítója, a mód, a modell, a válaszidő és a hibakód is."
        />
      ) : null}

      {exchanges.map((exchange, index) => (
        <Card key={`${exchange.reply.conversationId ?? "x"}-${index}`}>
          <div className="flex flex-col gap-3">
            <p className="font-medium">{exchange.question}</p>

            {exchange.reply.answer ? (
              <p className="whitespace-pre-wrap">{exchange.reply.answer}</p>
            ) : (
              <Alert variant="danger" title="Nem érkezett válasz">
                {/*
                  A hibakód mellett a VÁRAKOZÁS HOSSZA a leghasznosabb szám:
                  abból derül ki, hogy időtúllépés történt-e, és hol.
                */}
                Hibakód:{" "}
                <strong>{exchange.reply.errorCode ?? "ismeretlen"}</strong>
                {exchange.reply.providerWaitedMs !== null ? (
                  <>
                    {" "}
                    — az AI {formatMs(exchange.reply.providerWaitedMs)} után
                    adta fel.
                  </>
                ) : null}
              </Alert>
            )}

            <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Beszélgetés</dt>
                <dd>{exchange.reply.conversationId ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mód</dt>
                <dd>
                  {exchange.reply.customerContextStatus
                    ? (MODE_LABELS[exchange.reply.customerContextStatus] ??
                      exchange.reply.customerContextStatus)
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Modell</dt>
                <dd>{exchange.reply.model ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Válaszidő</dt>
                <dd>{formatMs(exchange.reply.elapsedMs)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Hibakód</dt>
                <dd>{exchange.reply.errorCode ?? "-"}</dd>
              </div>
              <div className="col-span-2 md:col-span-3">
                <dt className="text-muted-foreground">
                  Termék- és tudáskontextus
                </dt>
                {/*
                  Balázs saját mondata, szó szerint. Nem üres mező: egy üres
                  mező azt üzenné, hogy nincs mit jelenteni, holott az van, hogy
                  a katalógus nincs bekötve.
                */}
                <dd>{exchange.reply.productContext}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Értékelés:</span>
              {RATINGS.map((rating) => (
                <Button
                  key={rating.key}
                  variant={
                    exchange.rating === rating.key ? "primary" : "secondary"
                  }
                  onClick={() => rate(index, rating.key)}
                >
                  {rating.label}
                </Button>
              ))}
              {exchange.rating ? (
                <Badge>
                  {RATINGS.find((r) => r.key === exchange.rating)?.label}
                </Badge>
              ) : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
