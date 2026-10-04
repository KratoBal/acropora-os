import { useCallback, useState } from "react";

import { rememberSessionValue, sessionValue } from "./session-memory";

/**
 * MINT A `useState`, CSAK A MUNKAMENET IDEJÉRE MEGJEGYZI AZ ÉRTÉKET
 * (`session-memory.ts`): egy újra felépülő képernyő ott folytatja, ahol a
 * felhasználó hagyta. A kezdőérték csak akkor számít, ha ebben a futásban még
 * nem volt érték ehhez a kulcshoz. A beállító a `useState`-éhez hasonlóan
 * függvényt is elfogad (`setPage((p) => p + 1)`); a megjegyzés ugyanazt az
 * értéket írja, tehát egy kétszer lefutó frissítés sem tér el.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => sessionValue(key, initial));
  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved =
          typeof next === "function"
            ? (next as (previous: T) => T)(previous)
            : next;
        rememberSessionValue(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
