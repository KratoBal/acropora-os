"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SutyerakFigureState } from "./sutyerak-figure";

/**
 * MIT CSINÁL ÉPP SUTYERÁK (kártya e0780477; Balázs promptja, 2026-10-06).
 *
 * - Pihen: nincs kérés, gépelés vagy válaszjelzés.
 * - Jegyzetel: a kolléga a kérdésmezőben ténylegesen gépel (bevitel, törlés,
 *   IME-összeállítás); az utolsó bevitel után 1200 ms-mal vagy blurkor áll le.
 *   Puszta fókusz vagy kurzormozgatás nem indítja.
 * - Keres: a kérés elment, nem üres válaszszöveg még nem jött.
 * - Válaszol: az első nem üres szövegtől a válaszig, és egy sikeres, nem üres
 *   válasz után még 4 másodpercig.
 * - Elakadt: hiba (a meglévő jelzés).
 *
 * Kérés közben a gépelés nem írja felül a feladat állapotát. Minden kérés
 * sorszámot kap: egy régi kérés eseménye vagy időzítője nem írja felül az
 * újat. Új kérés, kézi visszaállítás, blur és unmount az időzítőket törli.
 */
export const TYPING_PAUSE_MS = 1200;
export const ANSWER_LINGER_MS = 4000;

type Task = "idle" | "searching" | "answering" | "answered" | "stuck";

export function useSutyerakActivity() {
  const [task, setTask] = useState<Task>("idle");
  const [typing, setTyping] = useState(false);
  const request = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskRef = useRef<Task>("idle");

  const set = useCallback((next: Task) => {
    taskRef.current = next;
    setTask(next);
  }, []);
  const clearTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
  }, []);
  const clearLinger = useCallback(() => {
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTyping();
      clearLinger();
    },
    [clearTyping, clearLinger],
  );

  /**
   * A kérdésmező tényleges bevitele (gépelés, törlés, IME-összeállítás). Kérés
   * közben is jelzi a gépelést, de a figurán a keresés és a válasz elől áll
   * (`figure` sorrendje), tehát nem írja felül a feladat állapotát.
   */
  const typed = useCallback(() => {
    const current = taskRef.current;
    if (current === "answered" || current === "stuck") {
      clearLinger();
      set("idle");
    }
    setTyping(true);
    clearTyping();
    typingTimer.current = setTimeout(() => {
      typingTimer.current = null;
      setTyping(false);
    }, TYPING_PAUSE_MS);
  }, [clearLinger, clearTyping, set]);

  const blurred = useCallback(() => {
    clearTyping();
    setTyping(false);
  }, [clearTyping]);

  /** A kérés elment: a sorszáma azonosítja a hozzá tartozó eseményeket. */
  const began = useCallback(() => {
    clearTyping();
    clearLinger();
    setTyping(false);
    set("searching");
    return ++request.current;
  }, [clearLinger, clearTyping, set]);

  /** Egy szöveges stream-esemény: az első nem üres váltja a keresést válaszra. */
  const text = useCallback(
    (id: number, delta: string) => {
      if (id !== request.current || !delta.trim()) return;
      if (taskRef.current === "searching") set("answering");
    },
    [set],
  );

  /** A kérés sikerrel véget ért: nem üres válasznál még 4 s válaszol. */
  const finished = useCallback(
    (id: number, answer: string) => {
      if (id !== request.current) return;
      clearLinger();
      if (!answer.trim()) {
        set("idle");
        return;
      }
      set("answered");
      lingerTimer.current = setTimeout(() => {
        lingerTimer.current = null;
        if (id === request.current && taskRef.current === "answered")
          set("idle");
      }, ANSWER_LINGER_MS);
    },
    [clearLinger, set],
  );

  /** Hiba: a meglévő elakadt jelzés; soha nem sikeres találat. */
  const failed = useCallback(
    (id: number) => {
      if (id !== request.current) return;
      clearLinger();
      set("stuck");
    },
    [clearLinger, set],
  );

  /** Kézi visszaállítás vagy megszakítás: pihen, és egy régi kérés már nem írhat. */
  const reset = useCallback(() => {
    request.current += 1;
    clearTyping();
    clearLinger();
    setTyping(false);
    set("idle");
  }, [clearLinger, clearTyping, set]);

  const figure: SutyerakFigureState =
    task === "stuck"
      ? "stuck"
      : task === "searching"
        ? "searching"
        : task === "answering" || task === "answered"
          ? "answering"
          : typing
            ? "takingNotes"
            : "resting";

  return { figure, typed, blurred, began, text, finished, failed, reset };
}
