import { useCallback, useEffect, useState } from "react";

import type { PushPreference } from "./push-preference";
import { pushPreferenceStore } from "./push-preference-store";

/**
 * A kapcsoló állása, betöltve és írhatóan.
 *
 * A `loading` állapot azért külön, mert a beállítatlan és a még be nem
 * töltött állapot ugyanúgy `null` -- és a kettő nem ugyanaz: az elsőre
 * bekapcsoltként kell viselkedni, a másodikra várni kell, különben a képernyő
 * egy pillanatra rossz állást mutatna, és a felhasználó arra koppintana.
 */
export function usePushPreference() {
  const [preference, setPreference] = useState<PushPreference | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await pushPreferenceStore.get();
      if (!alive) return;
      setPreference(stored);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (value: PushPreference) => {
    setPreference(value);
    await pushPreferenceStore.set(value);
  }, []);

  return { preference, loading, save };
}
