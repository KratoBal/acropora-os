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
import {
  AI_ACCURACY_RATINGS,
  hasPermission,
  PERMISSIONS,
  type AiAccuracyRating,
} from "@acropora/types";
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

/**
 * Az értékelés négy állapota, Balázs specifikációja szerint.
 *
 * A kulcsok a megosztott listából jönnek, a magyar felirat marad itt. Az ok
 * nem takarékosság: ugyanez a négy kulcs egy adatbázis-megszorítás is az AI
 * szolgáltatásban, és egy ötödik gomb, amit csak itt vennénk fel, a
 * gombnyomás pillanatában bukna el.
 */
const ACCURACY_LABELS: Record<AiAccuracyRating, string> = {
  correct: "Helyes",
  inaccurate: "Pontatlan",
  dangerous: "Veszélyes",
  "no-data": "Nincs adat",
};

interface Exchange {
  question: string;
  reply: AiChatReply;
  /** Amit a szerver ELTAROLT, nem amire a felhasználó kattintott. */
  rating: AiAccuracyRating | null;
  /** Amíg a mentés fut, ez látszik kiválasztottként. */
  ratingPending: AiAccuracyRating | null;
  ratingError: string | null;
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
        {
          question: message,
          reply,
          rating: null,
          ratingPending: null,
          ratingError: null,
        },
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

  /**
   * Az értékelés a szerverre megy, és csak akkor számít megadottnak, ha OTT
   * eltárolódott.
   *
   * Ez a különbség nem elméleti: a felület korábban csak a saját állapotában
   * jegyezte meg, tehát egy oldalfrissítés elvitte. Ami eltűnik egy lap
   * bezárásakor, az nem mérés. Amíg a mentés fut, a megnyomott gomb
   * kiválasztottnak látszik, de a tárolt érték csak a válasz után változik -
   * hiba esetén a felület visszaáll oda, ahol a szerver szerint áll.
   */
  const rate = async (index: number, rating: AiAccuracyRating) => {
    const exchange = exchanges[index];
    const messageId = exchange?.reply.messageId;
    if (!exchange || !messageId || exchange.ratingPending) return;

    const update = (patch: Partial<Exchange>) =>
      setExchanges((previous) =>
        previous.map((item, position) =>
          position === index ? { ...item, ...patch } : item,
        ),
      );

    update({ ratingPending: rating, ratingError: null });

    try {
      /**
       * A szakmai tengely. A nyelvezet-tengely gombsora kulon kerul be; a
       * tengelyt itt is KI KELL mondani, mert az API nem talalgat.
       */
      const result = await aiChatApi.rate(token, messageId, "accuracy", rating);

      if (result.errorCode) {
        update({
          ratingPending: null,
          ratingError: `Az AI szolgáltatás elutasította: ${result.errorCode}`,
        });
        return;
      }

      /*
        Amit a szerver visszaadott, csak akkor fogadjuk el, ha a SZAKMAI
        tengely erteke. Nem tipus-trukk: ha valaha egy nyelvezet-ertek jonne
        vissza erre a hivasra, az azt jelentene, hogy a ket tengely
        osszekeveredett valahol a lancban - es akkor a kepernyon NE latszodjek
        ugy, mintha rendben lenne.
      */
      const storedIsOnThisAxis = (
        AI_ACCURACY_RATINGS as readonly string[]
      ).includes(result.rating ?? "");

      update({
        rating: storedIsOnThisAxis
          ? (result.rating as AiAccuracyRating)
          : rating,
        ratingPending: null,
        ratingError: null,
      });
    } catch (cause) {
      update({
        ratingPending: null,
        ratingError:
          cause instanceof Error
            ? cause.message
            : "Az értékelés nem jutott el a szerverig.",
      });
    }
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
              {AI_ACCURACY_RATINGS.map((rating) => (
                <Button
                  key={rating}
                  variant={
                    (exchange.ratingPending ?? exchange.rating) === rating
                      ? "primary"
                      : "secondary"
                  }
                  /*
                    Hibás válaszra nincs mit értékelni: ilyenkor nincs
                    üzenet-azonosító sem, amire az értékelés hivatkozhatna.
                  */
                  disabled={
                    !exchange.reply.messageId || exchange.ratingPending !== null
                  }
                  onClick={() => void rate(index, rating)}
                >
                  {ACCURACY_LABELS[rating]}
                </Button>
              ))}
              {exchange.rating ? (
                <Badge>Elmentve: {ACCURACY_LABELS[exchange.rating]}</Badge>
              ) : null}
              {exchange.ratingPending ? (
                <span className="text-sm text-muted-foreground">Mentés...</span>
              ) : null}
            </div>
            {exchange.ratingError ? (
              <Alert variant="danger" title="Az értékelés nem mentődött el">
                {exchange.ratingError}
              </Alert>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
