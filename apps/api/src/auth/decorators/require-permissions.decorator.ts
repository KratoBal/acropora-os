import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@acropora/types";

export const REQUIRED_PERMISSIONS_KEY = "acropora:required-permissions";

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const REQUIRED_ANY_PERMISSIONS_KEY = "acropora:required-any-permissions";

/**
 * LEGALABB AZ EGYIK JOG ELEG (a `RequirePermissions` mindet keri). Ha egy
 * vegpont mindkettot viseli, mindketto feltetel all.
 *
 * Elso hasznalat (2026-10-01, acrobot 25433): a levelkepek OLVASASA a
 * szamlazasi joggal (`billing.resend`) is mehet, mert a szamlalevel a sablon
 * kepet amugy is kikuldi; a feltoltes marad `settings.manage`.
 */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);
