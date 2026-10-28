/**
 * THE SECOND GUARD OF THE CATALOG OPERATIONS: WHICH MEDUSA THEY MAY TOUCH
 * (barracuda's note on #1957, acrobot's decision 2026-10-28 11:51 UTC).
 *
 * The first guard is the switch (`CATALOG_ADMIN_ACTIONS_ENABLED`): off, the
 * operations do not exist. The commands themselves do not know whether the
 * stored Medusa connection points at the test or at the live shop, and now a
 * button calls them: if the switch were ever turned on in the live OS (for the
 * brand operations, say), the category button would write to the LIVE Medusa.
 * So the operations also run only against a Medusa whose host is on a list the
 * environment gives (`CATALOG_ACTION_MEDUSA_HOSTS`, comma separated). A plan
 * stops too: a plan reads the live shop with the stored key, and a plan that
 * ran against the wrong host would make the apply look confirmed.
 *
 * FAIL CLOSED: an empty or missing list allows nothing. A host the list does not
 * name is refused. The address is the one the Medusa client itself uses
 * (`MEDUSA_ADMIN_URL`), read at call time, so a change of the address after a
 * plan is caught at the apply.
 *
 * WHAT COUNTS AS A MATCH: the host name of the URL, compared in lower case
 * without a trailing dot and without a port; the list's entries are host names
 * (a scheme, path or port written by mistake is dropped). An entry with
 * anything but letters, digits, dots and hyphens (a wildcard included) is
 * IGNORED, never read as "any": a guard that a typo turns into "everything" is
 * worse than none. The URL is parsed, not matched as text, so
 * `https://allowed.example@live.example` is the host `live.example`.
 */
export const CATALOG_ACTION_MEDUSA_HOSTS_ENV = "CATALOG_ACTION_MEDUSA_HOSTS";

export type MedusaHostCheck =
  { ok: true; host: string } | { ok: false; message: string };

const HOST_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.replace(/:\d+$/, "");
  return host.replace(/\.$/, "");
}

/** The usable entries of the list; anything that is not a plain host name is dropped. */
export function allowedMedusaHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(normalizeHost)
    .filter((host) => host.length > 0 && HOST_NAME.test(host));
}

export function checkMedusaHost(env: NodeJS.ProcessEnv): MedusaHostCheck {
  const refuse = (reason: string): MedusaHostCheck => ({
    ok: false,
    message: `A katalógus-művelet nem indul: ${reason}`,
  });

  const allowed = allowedMedusaHosts(env[CATALOG_ACTION_MEDUSA_HOSTS_ENV]);
  if (allowed.length === 0)
    return refuse(
      `a ${CATALOG_ACTION_MEDUSA_HOSTS_ENV} nincs beállítva vagy nem tartalmaz érvényes hosztnevet, ezért egyetlen Medusa sem engedélyezett.`,
    );

  const url = env.MEDUSA_ADMIN_URL;
  if (!url) return refuse("a MEDUSA_ADMIN_URL nincs beállítva.");
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return refuse("a MEDUSA_ADMIN_URL nem érvényes cím.");
  }

  if (!allowed.includes(host))
    return refuse(
      `a Medusa-cím hosztja (${host}) nincs az engedélyezett listán.`,
    );
  return { ok: true, host };
}
