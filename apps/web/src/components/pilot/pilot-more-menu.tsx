"use client";

import { PilotButton } from "@acropora/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type PilotMoreMenuItem = {
  key: string;
  label: string;
  /** A red item: the action closes a deal, discards work or ends a case for good (Elutasítás, Visszavonás, Meghiúsultnak jelölés). */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * A "Továbbiak" MENU (Picasso 3.4, acrobot 61933; az árajánlat adatlapjáról közös Pilot komponens lett, hogy a hibajegy
 * Következő lépés doboza is ezt használja, Picasso 3.2): a ritkább műveletek egy gomb mögött, hogy az adatlapon egy
 * elsődleges gomb és legfeljebb egy-két másodlagos álljon. A gomb és a panel felirata paraméter (alapból "Továbbiak" és
 * "További műveletek"). Lenyitó gomb (`aria-expanded`), a panel sima
 * gombokból áll; Escape, kívülre kattintás és egy elem kiválasztása is bezárja, és Escape után a fókusz a lenyitó
 * gombra tér vissza. Nincs nyílbillentyű-kezelés: ez nem `role="menu"`, hanem egy lenyíló gombcsoport.
 */
export function PilotMoreMenu({
  items,
  label = "Továbbiak",
  groupLabel = "További műveletek",
}: {
  items: readonly PilotMoreMenuItem[];
  /** The toggle button's text. */
  label?: string;
  /** The panel's accessible name. */
  groupLabel?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <PilotButton
        size="regular"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </PilotButton>
      <div
        id={panelId}
        role="group"
        aria-label={groupLabel}
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 flex w-60 flex-col rounded-md bg-white py-1 shadow-lg ring-1 ring-pilot-grey-200"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
            className={`cursor-pointer px-4 py-2 text-left text-sm font-medium hover:bg-pilot-grey-50 disabled:cursor-not-allowed disabled:opacity-40 ${item.danger ? "text-pilot-red-700" : "text-pilot-grey-900"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
