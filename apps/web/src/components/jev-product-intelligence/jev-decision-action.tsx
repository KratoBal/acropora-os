"use client";

import { PilotButton } from "@/components/pilot/pilot-ui";

/**
 * A DECISION CONTROL THAT DOES NOT PRETEND (Figma "Kijelölt módosítások
 * alkalmazása", "3 000 l/h elfogadása", "Újraellenőrzés"...).
 *
 * No write contract and no execution endpoint is authorized yet (Architecture
 * Council), so every such control is rendered DISABLED, with its reason in
 * visible text (there is no tooltip component). Nothing is persisted, nothing
 * is called. Frontend state is not authorization: when a write exists, the
 * server checks `products.manage` on its own.
 */
export function JevDisabledAction({
  label,
  canManage,
  variant = "secondary",
}: {
  label: string;
  /** `products.manage`: only changes the reason the user reads. */
  canManage: boolean;
  variant?: "primary" | "secondary";
}) {
  const reason = canManage
    ? "A döntések rögzítése még nincs engedélyezve."
    : "A döntéshez termékkezelési jog kell.";
  return (
    <div className="flex flex-col items-start gap-1">
      <PilotButton variant={variant} size="regular" disabled title={reason}>
        {label}
      </PilotButton>
      <p className="text-xs leading-4 text-pilot-grey-500">{reason}</p>
    </div>
  );
}
