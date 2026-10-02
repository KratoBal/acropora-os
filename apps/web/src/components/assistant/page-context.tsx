"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
interface Entity {
  page: string;
  entity: string;
}
const Context = createContext<{
  value: Entity | null;
  set: (value: Entity | null) => void;
} | null>(null);
export function AssistantPageProvider({ children }: { children: ReactNode }) {
  const [value, set] = useState<Entity | null>(null);
  return <Context.Provider value={{ value, set }}>{children}</Context.Provider>;
}
export function useAssistantEntity(
  kind: string,
  id?: string,
  number?: string | null,
) {
  const context = useContext(Context);
  const page = usePathname();
  const set = context?.set;
  useEffect(() => {
    if (!set || !id) return;
    // A reused detail component may still hold the previous record while loading.
    if (
      !page
        .split("/")
        .some((segment) => segment === id || segment === encodeURIComponent(id))
    )
      return;
    set({
      page,
      entity: `${kind}: ${number ?? "szám nélkül"} (id: ${id})`.slice(0, 300),
    });
    return () => set(null);
  }, [set, page, kind, id, number]);
}
export function useAssistantPageContext() {
  const context = useContext(Context);
  const pathname = usePathname();
  return {
    page: pathname.slice(0, 300),
    ...(context?.value?.page === pathname
      ? { entity: context.value.entity }
      : {}),
  };
}
