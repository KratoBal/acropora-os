"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; message: string };

/**
 * Loads once on mount and again on `reload()`. A reload keeps showing the data
 * it has (no flash to "loading") until the new answer replaces it; an answer
 * that arrives after the component is gone, or after a newer load, is dropped.
 */
export function useLoad<T>(loader: () => Promise<T>): {
  state: Loaded<T>;
  reload(): Promise<void>;
} {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const latest = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const data = await loaderRef.current();
      if (mine === latest.current) setState({ status: "ready", data });
    } catch (error) {
      if (mine === latest.current)
        setState({
          status: "failed",
          message:
            error instanceof Error ? error.message : "A betöltés nem sikerült.",
        });
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
