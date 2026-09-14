import { SERVICE_ASSIGNABLE_ROLES } from "../common/service-assignment.js";
import type { UserRole } from "@acropora/types";

/**
 * Kit lehet a munkalap felelősének kiosztani.
 *
 * A SZABÁLY 2026-09-14 ÓTA A KÖZÖS MAPPÁBAN ÁLL
 * (`common/service-assignment.ts`), mert a hibajegy-delegálás ugyanezt a
 * kérdést teszi fel, ugyanabból az okból -- az indoklás ott olvasható.
 *
 * A NÉV ITT MARADT, és ez nem kényelem: a munkalap-oldali hívók és a rájuk
 * álló őrző (`worksheet-assignment.spec.ts`) ezen a néven ismerik. Egy
 * átnevezés a szabály költözésével EGY körben két dolgot mozdított volna, és a
 * spec zöldje nem mondta volna meg, melyik miatt zöld.
 */
export const WORKSHEET_ASSIGNABLE_ROLES: readonly UserRole[] =
  SERVICE_ASSIGNABLE_ROLES;

export { normalizeAssigneeIds } from "../common/service-assignment.js";
