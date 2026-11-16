"use client";

import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  gameApi,
  type GameLiveDrawView,
  type GameQuestionView,
} from "@/lib/api/game";

import "./live-draw.css";

/**
 * AZ ÉLŐ SORSOLÁS OLDALA (acrobot 44363, Balázs 2026-11-06): egy teljes képernyős, sötét oldal, amit élő adásban osztunk
 * meg. Egy nagy "Sorsolás" gomb, kb. 10 másodperc látvány, aztán a nyertes rövidített neve és a nyeremény.
 *
 * AMIT AZ OLDAL SOHA NEM TESZ: nem választ ki senkit (a gomb a szerver meglévő sorsolását hívja, a szerver dönt a
 * magjával), és NEM mutat más játékost. A szerver nézetében nincs is más játékos: csak számok, a nyeremény, és sorsolás
 * után a nyertes rövidített neve és kitakart címe. A pörgő „Játékos #N” címkék díszek (a szelvények számaiból, név
 * nélkül), a megállt címke a szerver szelvényszáma.
 */

/** A látvány idővonala a gomb megnyomásától (ms): a szelvényszám megáll, aztán megjelenik a nyertes. */
export const REVEAL_MS = { settle: 8000, name: 10000 } as const;

const weekLabel = (week: string | null) => {
  const number = week ? Number(week.split("-W")[1]) : NaN;
  return Number.isFinite(number) ? `${number}. heti sorsolás` : "Heti sorsolás";
};

const titleOf = (view: GameLiveDrawView) =>
  view.kind === "CHRISTMAS"
    ? "Karácsonyi fődíj sorsolás"
    : weekLabel(view.week);

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 7) * 0.12,
  duration: 2.4 + (i % 5) * 0.35,
  hue: i % 2 === 0 ? "orange" : "blue",
}));

function Brand() {
  return (
    <div className="live-draw-brand" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path d="M20 36V18M20 26L8 15M9 16V7M9 14L3 10M20 20L30 10M30 13V3M29 12L37 8M20 18L17 7M17 10L11 4" />
      </svg>
      <span>ACROPORA</span>
    </div>
  );
}

/**
 * THE SPINNING LABEL (Balázs, 2026-11-13: "jo lenne ha a nevek valtakoznanak gyorsan es a vegen derulne ki a nyertes";
 * his choice of form, 15:10 UTC: "Játékos #17"). The players' names must NOT spin: the giveaway's privacy notice
 * (adatkezeles-1.2) promises that no other player's name or address appears in the broadcast. So the reel spins neutral
 * labels made from the ticket numbers, slows down, and stops on the server's winning ticket; the winner's shortened name
 * comes after, as before. The server still picks; the reel is only the show.
 */
export const spinLabel = (ticket: number) => `Játékos #${ticket}`;

/** The next ticket to show: random among `tickets`, never the same twice in a row when there is more than one. */
export function nextSpinTicket(
  previous: number,
  tickets: number,
  random: () => number = Math.random,
): number {
  const count = Math.max(tickets, 1);
  if (count === 1) return 1;
  // one of the other count-1 tickets, so every step visibly changes
  const pick = 1 + Math.floor(random() * (count - 1));
  return pick >= previous ? pick + 1 : pick;
}

function SpinningPlayer({
  tickets,
  finalTicket,
  settled,
}: {
  tickets: number;
  finalTicket: number | null;
  settled: boolean;
}) {
  const [shown, setShown] = useState(1);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (settled) return;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = () => {
      setShown((previous) => nextSpinTicket(previous, tickets));
      setStep((n) => n + 1);
      // fast at first (about 20 a second), slowing towards the stop
      const progress = Math.min((Date.now() - startedAt) / REVEAL_MS.settle, 1);
      timer = setTimeout(tick, 50 + progress * progress * 520);
    };
    tick();
    return () => clearTimeout(timer);
  }, [settled, tickets]);
  const ticket = settled && finalTicket !== null ? finalTicket + 1 : shown;
  return (
    <div
      className={`live-draw-reel${settled ? " live-draw-reel-settled" : ""}`}
      data-testid="live-draw-reel"
    >
      <small>{settled ? "A nyertes" : "Sorsolás"}</small>
      {/* a new key per step, so every change slides in */}
      <strong key={settled ? "settled" : step}>{spinLabel(ticket)}</strong>
    </div>
  );
}

function PrizeImage({
  token,
  imageId,
}: {
  token: string;
  imageId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageId) return;
    let alive = true;
    let objectUrl: string | null = null;
    gameApi
      .prizeImageContent(token, imageId)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, imageId]);
  if (!imageId || !url) return null;
  return <img className="live-draw-prize-image" src={url} alt="" />;
}

type Phase = "idle" | "drawing" | "done";

function LiveDraw({
  token,
  kind,
  questionId,
}: {
  token: string;
  kind: "WEEKLY" | "CHRISTMAS";
  questionId: string | undefined;
}) {
  const [view, setView] = useState<GameLiveDrawView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<GameLiveDrawView | null>(null);
  const [settleUp, setSettleUp] = useState(false);
  const [nameUp, setNameUp] = useState(false);
  const pressed = useRef(false);

  useEffect(() => {
    let alive = true;
    gameApi
      .liveDraw(token, kind, questionId)
      .then((next) => alive && setView(next))
      .catch(
        (cause) =>
          alive &&
          setError(cause instanceof Error ? cause.message : "Ismeretlen hiba"),
      );
    return () => {
      alive = false;
    };
  }, [token, kind, questionId]);

  // A megnyomás után: a szerver sorsol, a látvány az idővonal szerint fut; a nyertes csak akkor kerül elő, ha mind a
  // kettő megvan (a szerver válasza és a 10 másodperc).
  const press = useCallback(() => {
    if (pressed.current) return;
    pressed.current = true;
    setError(null);
    setPhase("drawing");
    gameApi
      .runLiveDraw(token, kind, questionId)
      .then((next) => setResult(next))
      .catch((cause) => {
        pressed.current = false;
        setPhase("idle");
        setSettleUp(false);
        setNameUp(false);
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba");
        // The request may have failed on the way back while the server DID record the draw: look again, so a recorded
        // result shows at once and the button does not come back for nothing (barracuda, #2287).
        gameApi
          .liveDraw(token, kind, questionId)
          .then((next) => {
            setView(next);
            if (next.drawn) setError(null);
          })
          .catch(() => undefined);
      });
  }, [token, kind, questionId]);

  useEffect(() => {
    if (phase !== "drawing") return;
    const settle = setTimeout(() => setSettleUp(true), REVEAL_MS.settle);
    const name = setTimeout(() => setNameUp(true), REVEAL_MS.name);
    return () => {
      clearTimeout(settle);
      clearTimeout(name);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "drawing" && result && nameUp) setPhase("done");
  }, [phase, result, nameUp]);

  if (!view) {
    return (
      <main className="live-draw" data-testid="elo-sorsolas">
        <Brand />
        <p className="live-draw-note" role={error ? "alert" : undefined}>
          {error ?? "Betöltés…"}
        </p>
      </main>
    );
  }

  const shown = result ?? view;
  const drawn =
    phase === "done" ? shown.drawn : phase === "idle" ? view.drawn : null;
  const already = phase === "idle" && view.drawn !== null;
  // the button sits in the stage branch only: a draw already recorded renders the result branch instead
  const canPress = phase === "idle" && !view.blocked;

  return (
    <main
      className={`live-draw live-draw-${drawn ? "revealed" : phase === "drawing" ? "drawing" : "idle"}`}
      data-testid="elo-sorsolas"
    >
      <div className="live-draw-rings" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <Brand />
      <header className="live-draw-head">
        <h1>{titleOf(view)}</h1>
        {view.prizeName ? <p>{view.prizeName}</p> : null}
      </header>

      {drawn ? (
        <section className="live-draw-result" aria-live="polite">
          {phase === "done" ? (
            <div className="live-draw-confetti" aria-hidden="true">
              {CONFETTI.map((piece, index) => (
                <b
                  key={index}
                  className={`live-draw-confetti-${piece.hue}`}
                  style={{
                    left: `${piece.left}%`,
                    animationDelay: `${piece.delay}s`,
                    animationDuration: `${piece.duration}s`,
                  }}
                />
              ))}
            </div>
          ) : null}
          {already ? (
            <p className="live-draw-note">Ez a sorsolás már megtörtént.</p>
          ) : null}
          {drawn.winnerName ? (
            <>
              <p className="live-draw-label">A nyertes</p>
              <h2 data-testid="live-draw-winner">{drawn.winnerName}</h2>
              {drawn.winnerEmailMasked ? (
                <p className="live-draw-masked">({drawn.winnerEmailMasked})</p>
              ) : null}
              {view.prizeName ? (
                <p className="live-draw-prize">{view.prizeName}</p>
              ) : null}
              <PrizeImage token={token} imageId={view.prizeImageId} />
            </>
          ) : (
            <h2 data-testid="live-draw-winner">
              Nincs nyertes: nem volt érvényes beküldés.
            </h2>
          )}
        </section>
      ) : phase === "drawing" ? (
        <section className="live-draw-stage" aria-live="polite">
          {/* with no winner there is no ticket to stop on: the number must not settle as "the winning ticket" */}
          {result && result.drawn?.ticket == null ? null : (
            <SpinningPlayer
              tickets={view.tickets}
              finalTicket={result?.drawn?.ticket ?? null}
              settled={settleUp && result !== null}
            />
          )}
          <p className="live-draw-note">Sorsolás folyamatban…</p>
        </section>
      ) : (
        <section className="live-draw-stage">
          <PrizeImage token={token} imageId={view.prizeImageId} />
          <p className="live-draw-count" data-testid="live-draw-count">
            <strong>{view.tickets}</strong> esély a kalapban
            {view.kind === "CHRISTMAS" ? ` · ${view.candidates} játékos` : ""}
          </p>
          {view.blocked ? (
            <p className="live-draw-note" role="status">
              {view.blocked}
            </p>
          ) : null}
          {canPress ? (
            <button type="button" className="live-draw-button" onClick={press}>
              Sorsolás
            </button>
          ) : null}
          {error ? (
            <p className="live-draw-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

/** A sorsolás kiválasztása az adás ELŐTT: melyik hét (vagy a karácsonyi), aztán az élő nézet. Játékos itt sincs. */
function Chooser({ token }: { token: string }) {
  const [questions, setQuestions] = useState<GameQuestionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    gameApi
      .questions(token)
      .then((rows) => alive && setQuestions(rows))
      .catch(
        (cause) =>
          alive &&
          setError(cause instanceof Error ? cause.message : "Ismeretlen hiba"),
      );
    return () => {
      alive = false;
    };
  }, [token]);
  return (
    <main className="live-draw live-draw-idle" data-testid="elo-sorsolas">
      <Brand />
      <header className="live-draw-head">
        <h1>Melyik sorsolás megy adásba?</h1>
        <p>Az adás előtt válassz: az élő nézetben már csak a gomb van.</p>
      </header>
      <section className="live-draw-choices">
        {error ? (
          <p className="live-draw-error" role="alert">
            {error}
          </p>
        ) : null}
        {(questions ?? []).map((question) => (
          <a
            key={question.id}
            className="live-draw-choice"
            href={`/sorsolas?kind=WEEKLY&kerdes=${encodeURIComponent(question.id)}`}
          >
            <strong>{weekLabel(question.week)}</strong>
            <span>{question.prizeName ?? "nyeremény nélkül"}</span>
          </a>
        ))}
        <a className="live-draw-choice" href="/sorsolas?kind=CHRISTMAS">
          <strong>Karácsonyi fődíj sorsolás</strong>
          <span>az összes hét játékosai, súlyozva</span>
        </a>
      </section>
    </main>
  );
}

export function LiveDrawPage() {
  const { session } = useAuth();
  const params = useSearchParams();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.GAME_MANAGE),
  );
  if (!canManage) {
    return (
      <main className="live-draw live-draw-idle" data-testid="elo-sorsolas">
        <p className="live-draw-note" role="alert">
          A sorsoláshoz nincs jogosultságod.
        </p>
      </main>
    );
  }
  const kind = params.get("kind");
  const questionId = params.get("kerdes") ?? undefined;
  if (kind === "CHRISTMAS" || (kind === "WEEKLY" && questionId))
    return (
      <LiveDraw
        key={`${kind}:${questionId ?? ""}`}
        token={token}
        kind={kind}
        questionId={kind === "WEEKLY" ? questionId : undefined}
      />
    );
  return <Chooser token={token} />;
}
