import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

/**
 * ONE ICON COMPONENT FOR THE HOME, THE LAUNCHER AND THE BOTTOM BAR.
 *
 * Ionicons outline glyphs from `@expo/vector-icons` (owner, 2026-10-02, answer
 * 6). The glyphs are a font loaded by `expo-font`, whose native module is
 * already in the app: no new native dependency, so this ships as an update.
 * The names live in plain tables (`lib/home/modules.ts`, `bottom-nav.ts`);
 * `home-icons.spec.ts` checks each one exists in the bundled glyph map, so a
 * typo cannot ship as a blank square.
 */
type IoniconName = ComponentProps<typeof Ionicons>["name"];

export function ModuleIcon({
  name,
  size,
  color,
}: {
  name: string;
  size: number;
  color: string;
}) {
  return <Ionicons name={name as IoniconName} size={size} color={color} />;
}
