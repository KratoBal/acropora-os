"use client";
import type { ReactNode } from "react";
import {
  PilotThemeRoot as SharedPilotThemeRoot,
  type PilotBadgeVariant,
} from "@acropora/ui";

import { pilotInter } from "./pilot-font";

/**
 * ÁTKÖLTÖZÖTT A `@acropora/ui`-ba, 2026-09-25 (Partner Portál Figma-kör,
 * acrobot döntése): a teljes komponens-készlet tartalma és indoklása most
 * ott áll (`packages/ui/src/pilot-ui.tsx`). Ez a fájl -- a `service-theme.ts`
 * korábbi költöztetésénél kialakult mintát követve -- csak újraexportál,
 * hogy az eddigi importálók (`import { PilotBadge } from "./pilot-ui"`,
 * mind a 12 hívóhely `apps/web/src/components/{aquariums,worksheets,
 * service-assets,service-jobs}/pilot/*.tsx`-ben) változatlanul működjenek.
 *
 * EGYETLEN KIVÉTEL: `PilotThemeRoot`. A `next/font/local` build-idejű
 * betűtípus-betöltő NEM futtatható a `packages/ui`-ban (nem Next.js
 * alkalmazás), ezért a font itt, app-szinten maradt (`pilot-font.ts`), és
 * ez a helyi wrapper adja át `fontClassName` paraméterként a megosztott
 * komponensnek -- a hívóknak (a fenti 12 helynek) emiatt sem kell
 * módosulniuk, mert a `className` prop jelentése és a komponens neve
 * változatlan.
 */
export {
  PilotBadge,
  PilotAvatarStack,
  pilotAvatarColor,
  pilotInitials,
  PilotAvatar,
  PilotButton,
  PilotSegmentedControl,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotCard,
  PilotCardHeader,
  PilotDrawer,
  PilotDialog,
} from "@acropora/ui";
export type { PilotBadgeVariant };

export function PilotThemeRoot({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <SharedPilotThemeRoot
      className={className}
      fontClassName={pilotInter.className}
    >
      {children}
    </SharedPilotThemeRoot>
  );
}
