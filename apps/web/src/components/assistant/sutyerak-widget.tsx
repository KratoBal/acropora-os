"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import type { Session } from "@acropora/types";
import { useAuth } from "../auth/auth-provider";
import { assistantApi, type AssistantEvent } from "@/lib/api/assistant";
import { ApiError } from "@/lib/api/client";
import { useAssistantPageContext } from "./page-context";
import { AssistantMarkdown } from "./markdown";
import {
  clampPosition,
  FIGURE_SIZE,
  storedPosition,
  panelPosition,
  type FigurePosition,
} from "./position";
import { SutyerakFigure } from "./sutyerak-figure";
import { useSutyerakActivity } from "./use-sutyerak-activity";

export function SutyerakWidget() {
  const { session } = useAuth();
  const [enabledFor, setEnabledFor] = useState<string | null>(null);
  useEffect(() => {
    setEnabledFor(null);
    if (!session || session.user.customerId || session.user.supplierId) return;
    const controller = new AbortController();
    void assistantApi
      .config(session.token ?? "", controller.signal)
      .then((config) => {
        if (!controller.signal.aborted && config.enabled)
          setEnabledFor(session.user.id);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [
    session?.id,
    session?.user.id,
    session?.token,
    session?.user.customerId,
    session?.user.supplierId,
  ]);
  return session && enabledFor === session.user.id ? (
    <SutyerakPanel key={session.user.id} session={session} />
  ) : null;
}
interface Turn {
  question: string;
  answer: string;
  error?: string;
  /**
   * ACROBOT VÁLASZA (5830ee10): amit Sutyerák átadott, és acrobot visszaírt.
   * Kérdés nélküli forduló; az üzenet azonosítója a kettőzés ellen.
   */
  acrobotId?: string;
}

/** Ennyi időnként néz rá a nyitott ablak acrobot válaszaira (Balázs: fél perc). */
export const ACROBOT_REPLY_POLL_MS = 30_000;

/** Az új acrobot-válaszok a forduló-lista végére, egyszer mindegyik. */
export function withAcrobotReplies(
  turns: readonly Turn[],
  replies: readonly { id: string; text: string }[],
): Turn[] {
  const known = new Set(turns.flatMap((turn) => turn.acrobotId ?? []));
  const fresh = replies.filter((reply) => !known.has(reply.id));
  return fresh.length === 0
    ? (turns as Turn[])
    : [
        ...turns,
        ...fresh.map((reply) => ({
          question: "",
          answer: reply.text,
          acrobotId: reply.id,
        })),
      ];
}
export function SutyerakPanel({ session }: { session: Session }) {
  const context = useAssistantPageContext();
  const userId = session.user.id;
  const [position, setPosition] = useState<FigurePosition>({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const activity = useSutyerakActivity();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    position: FigurePosition;
    dragged: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const answerEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPosition(storedPosition(userId));
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    setReady(true);
    try {
      setThreadId(
        sessionStorage.getItem(`sutyerak.thread.${userId}`) ?? undefined,
      );
      const history = JSON.parse(
        sessionStorage.getItem(`sutyerak.history.${userId}`) ?? "[]",
      );
      if (
        Array.isArray(history) &&
        history.every(
          (turn) =>
            typeof turn.question === "string" &&
            typeof turn.answer === "string" &&
            (turn.acrobotId === undefined ||
              typeof turn.acrobotId === "string"),
        )
      )
        setTurns(history);
    } catch {
      /* Optional storage. */
    }
    const resize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPosition((p) =>
        clampPosition(p, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      active.current?.abort();
    };
  }, [userId]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        `sutyerak.position.${userId}`,
        JSON.stringify(position),
      );
    } catch {
      /* Optional storage. */
    }
  }, [position, ready, userId]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        `sutyerak.history.${userId}`,
        JSON.stringify(turns),
      );
    } catch {
      /* Optional storage. */
    }
  }, [turns, ready, userId]);
  useEffect(() => {
    answerEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns]);
  /*
    ACROBOT VÁLASZA AZ ABLAKBAN (5830ee10, Balázs 2026-10-06 12:14 UTC): amit
    Sutyerák átadott, arra a válasz az Üzenetekbe megy (push), és ide is, ebbe
    a beszélgetésbe. Nyitáskor azonnal, nyitva fél percenként néz rá; csukva
    nem kérdez. A hiba csendes: a válasz az Üzenetekben amúgy is ott van.
  */
  useEffect(() => {
    if (!open || !threadId) return;
    const controller = new AbortController();
    const look = () =>
      void assistantApi
        .handoffReplies(session.token ?? "", threadId, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted)
            setTurns((previous) => withAcrobotReplies(previous, result.items));
        })
        .catch(() => undefined);
    look();
    const timer = window.setInterval(look, ACROBOT_REPLY_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, threadId, session.token]);
  const rememberThread = (id?: string) => {
    setThreadId(id);
    try {
      if (id) sessionStorage.setItem(`sutyerak.thread.${userId}`, id);
      else sessionStorage.removeItem(`sutyerak.thread.${userId}`);
    } catch {
      /* Optional storage. */
    }
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 5) start.dragged = true;
    if (start.dragged)
      setPosition(
        clampPosition(
          { x: start.position.x + dx, y: start.position.y + dy },
          window.innerWidth,
          window.innerHeight,
        ),
      );
  };
  const release = () => {
    if (gesture.current) suppressClick.current = gesture.current.dragged;
    gesture.current = null;
  };
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const request = activity.began();
    setQuestion("");
    const index = turns.length;
    setTurns((previous) => [...previous, { question: text, answer: "" }]);
    let failed = false;
    let answer = "";
    const patch = (update: (turn: Turn) => Turn) =>
      setTurns((previous) =>
        previous.map((turn, i) => (i === index ? update(turn) : turn)),
      );
    const onEvent = (message: AssistantEvent) => {
      if (controller.signal.aborted) return;
      if (message.type === "thread") rememberThread(message.threadId);
      if (message.type === "text") {
        answer += message.delta;
        activity.text(request, message.delta);
        patch((turn) => ({ ...turn, answer: turn.answer + message.delta }));
      }
      if (message.type === "done") {
        answer = message.answer;
        patch((turn) => ({ ...turn, answer: message.answer }));
      }
      if (message.type === "error") {
        failed = true;
        patch((turn) => ({ ...turn, error: message.message }));
      }
    };
    try {
      try {
        await assistantApi.ask(
          session.token ?? "",
          { question: text, context, ...(threadId ? { threadId } : {}) },
          onEvent,
          controller.signal,
        );
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 403 && threadId))
          throw cause;
        rememberThread();
        answer = "";
        patch((turn) => ({ ...turn, answer: "", error: undefined }));
        await assistantApi.ask(
          session.token ?? "",
          { question: text, context },
          onEvent,
          controller.signal,
        );
      }
      if (!controller.signal.aborted) {
        if (failed) activity.failed(request);
        else activity.finished(request, answer);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        activity.failed(request);
        patch((turn) => ({
          ...turn,
          error:
            cause instanceof Error
              ? cause.message
              : "Sutyerák most nem tud válaszolni.",
        }));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const reset = () => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    rememberThread();
    setTurns([]);
    setQuestion("");
    activity.reset();
  };
  if (!ready) return null;
  const panel = panelPosition(position, viewport.width, viewport.height);
  return (
    <>
      <button
        type="button"
        aria-label="Sutyerák megnyitása"
        aria-expanded={open}
        aria-controls="sutyerak-panel"
        title="Sutyerák — húzható"
        className="fixed z-50 touch-none cursor-grab rounded-full focus-visible:outline-2 focus-visible:outline-pilot-aqua-600"
        style={{
          left: position.x,
          top: position.y,
          width: FIGURE_SIZE,
          height: FIGURE_SIZE,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          suppressClick.current = false;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            position,
            dragged: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={() => {
          suppressClick.current = true;
          gesture.current = null;
        }}
        onClick={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          suppressClick.current = false;
          setOpen((value) => !value);
        }}
      >
        <SutyerakFigure state={activity.figure} size={FIGURE_SIZE} />
      </button>
      {open && (
        <section
          id="sutyerak-panel"
          role="dialog"
          aria-label="Sutyerák"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white text-pilot-grey-900 shadow-xl"
          style={panel}
        >
          <header className="flex items-center justify-between border-b border-pilot-grey-200 px-4 py-3">
            <strong>Sutyerák</strong>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={reset}
                className="text-xs text-pilot-aqua-700"
              >
                Új beszélgetés
              </button>
              <button
                type="button"
                aria-label="Panel bezárása"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
          </header>
          <p className="border-b border-pilot-grey-100 px-4 py-2 text-xs text-pilot-grey-500">
            Sutyerák csak olvas, és azt látja, amit te.
          </p>
          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm"
            role="log"
            aria-live="polite"
            aria-busy={busy}
          >
            {turns.length === 0 && (
              <p className="text-pilot-grey-500">
                Miben segíthetek? Kérdezhetsz az aktuális oldalról is.
              </p>
            )}
            {turns.map((turn, index) => (
              <article key={turn.acrobotId ?? index} className="space-y-2">
                {turn.acrobotId ? (
                  <p className="text-xs font-semibold text-pilot-grey-500">
                    Acrobot válasza
                  </p>
                ) : (
                  <p className="rounded-xl bg-pilot-aqua-50 px-3 py-2 font-medium">
                    {turn.question}
                  </p>
                )}
                <div className="px-1">
                  <AssistantMarkdown text={turn.answer} />
                  {turn.error && (
                    <p role="alert" className="text-red-700">
                      {turn.error}
                    </p>
                  )}
                </div>
              </article>
            ))}
            {busy && (
              <p className="text-pilot-grey-500">Sutyerák gondolkodik…</p>
            )}
            <div ref={answerEnd} />
          </div>
          <form
            onSubmit={ask}
            className="space-y-2 border-t border-pilot-grey-200 p-3"
          >
            <label className="sr-only" htmlFor="sutyerak-question">
              Kérdés Sutyeráknak
            </label>
            <textarea
              id="sutyerak-question"
              maxLength={4000}
              rows={2}
              value={question}
              onChange={(event) => {
                // csak a tényleges bevitel jegyzetel (gépelés, törlés); fókusz és kurzor nem
                if (event.target.value !== question) activity.typed();
                setQuestion(event.target.value);
              }}
              onCompositionStart={activity.typed}
              onCompositionUpdate={activity.typed}
              onCompositionEnd={activity.typed}
              onBlur={activity.blurred}
              placeholder="Írd ide a kérdésed…"
              className="w-full resize-none rounded-lg border border-pilot-grey-200 p-2 text-sm focus:outline-pilot-aqua-600"
            />
            <button
              disabled={busy || !question.trim()}
              className="w-full rounded-lg bg-pilot-aqua-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Kérdezek
            </button>
          </form>
        </section>
      )}
    </>
  );
}
