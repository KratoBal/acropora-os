/** One configuration source for startup, scheduler and the admin status endpoint. */
export const DEFAULT_CAPASULI_QUERY =
  'from:zoobudapest.com subject:"napi jelentő"';
export function capasuliConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.GMAIL_CAPASULI_SYNC_ENABLED?.trim().toLowerCase();
  const switchReason = !raw
    ? "NOT_SET"
    : raw === "true"
      ? "ON"
      : raw === "false"
        ? "OFF"
        : "UNRECOGNISED";
  const credentials = {
    clientId: env.GMAIL_CAPASULI_CLIENT_ID?.trim() || "",
    clientSecret: env.GMAIL_CAPASULI_CLIENT_SECRET?.trim() || "",
    refreshToken: env.GMAIL_CAPASULI_REFRESH_TOKEN?.trim() || "",
  };
  const configured = Object.values(credentials).every(Boolean);
  const interval = Number(env.GMAIL_CAPASULI_SYNC_INTERVAL_MINUTES || 60);
  const intervalMinutes =
    Number.isSafeInteger(interval) && interval >= 5 && interval <= 1440
      ? interval
      : 60;
  return {
    switchReason,
    enabled: switchReason === "ON" && configured,
    configured,
    credentials,
    intervalMinutes,
    user: env.GMAIL_CAPASULI_USER?.trim() || "balazs@acropora.hu",
    query: env.GMAIL_CAPASULI_QUERY?.trim() || DEFAULT_CAPASULI_QUERY,
    openedById: env.CAPASULI_OPENED_BY_USER_ID?.trim() || null,
    departmentId: env.CAPASULI_DEPARTMENT_ID?.trim() || null,
    reviewerId: env.CAPASULI_REVIEWER_USER_ID?.trim() || null,
  };
}
export function describeCapasuliSync(c = capasuliConfig()) {
  return c.enabled
    ? `Cápasuli Gmail sync enabled (${c.intervalMinutes} min, gmail.readonly)`
    : `Cápasuli Gmail sync disabled (${c.switchReason}${c.switchReason === "ON" && !c.configured ? ", missing GMAIL_CAPASULI credentials" : ""})`;
}
