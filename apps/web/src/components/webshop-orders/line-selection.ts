import { useCallback, useMemo, useState } from "react";

/**
 * A TÉTELEK KIJELÖLÉSE (a prompt 13. pontja: szétbontás, és később a visszáru
 * is erre épül). Nem a felület állapota, hanem egy azonosító-halmaz: a sorok
 * azonosítóit tartja, és ami a rendelésről eltűnt (törölt vagy cserélt tétel),
 * az a kijelölésből is kiesik.
 */
export function useLineSelection(lineIds: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selectedIds = useMemo(
    () => lineIds.filter((id) => picked.has(id)),
    [lineIds, picked],
  );
  const toggle = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Set()), []);
  return {
    selectedIds,
    isSelected: (id: string) => selectedIds.includes(id),
    toggle,
    clear,
  };
}

export type LineSelection = ReturnType<typeof useLineSelection>;
