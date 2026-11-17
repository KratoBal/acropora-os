import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

/**
 * THE SECOND LOCK of the ticket@ admin endpoints, behind the class-level `service.manage`: only an internal OWNER or ADMIN, an account that acts
 * for no customer and no supplier. One function for the status and for the measurement, so the two cannot drift apart (barracuda, #2663: the
 * measurement had only the permission, and a service manager, or one day a partner role granted it, could have called the Gmail API).
 */
export function requireInternalAdmin(
  user: AuthenticatedUser,
  message: string,
): void {
  if (
    !["OWNER", "ADMIN"].includes(user.role) ||
    user.customerId ||
    user.supplierId
  )
    throw new ForbiddenException(message);
}
