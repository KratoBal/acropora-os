import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";

/**
 * THE SERVICE TOKEN ADMIN API'S SWITCH (card c5a8e6d6 follow-up, acrobot 2026-11-10 23:22: "hard guarantee": production
 * could not be measured for a machine-role account, so the routes are shut until someone opens them).
 *
 * `SERVICE_TOKEN_ADMIN_ENABLED`, EXACTLY `true`, OFF by default (like the Medusa switches). Off: the three routes answer 404
 * and no key can be made, listed or revoked. It is read per request, not at start-up, so a test (or an operator's restart)
 * sees the value as it is.
 *
 * WHAT 404 MEANS HERE, said out loud: the global authentication and permission guards run BEFORE this one, so a caller with no
 * session still gets 401 and a session without `users.manage` still gets 403; only an admin who would have been let in gets the
 * 404. The switch shuts the function, it does not hide that the route is mounted.
 */
export const isServiceTokenAdminEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.SERVICE_TOKEN_ADMIN_ENABLED === "true";

@Injectable()
export class ServiceTokenAdminEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isServiceTokenAdminEnabled()) throw new NotFoundException();
    return true;
  }
}
