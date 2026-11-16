/**
 * WHERE TO GO AFTER SIGNING IN (acrobot 50078): back to the page that sent you to the login, so a page opened directly
 * (the live draw in an OBS browser source) is where you land, not the dashboard.
 *
 * ONLY AN INTERNAL, RELATIVE PATH, so the login page cannot be used to send someone elsewhere (no open redirect): it must
 * start with one "/" and no "//" or "/\" (a protocol-relative address), carry no scheme or control character, not point
 * back at the login, stay short, and be already normal (no dot segment or encoding the URL parser would rewrite). Anything
 * else is the dashboard.
 */
const MAX_LENGTH = 512;

export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH) return "/";
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  // a parsed URL must stay on our own origin
  try {
    const url = new URL(value, "https://acropora.invalid");
    if (url.origin !== "https://acropora.invalid") return "/";
    if (url.pathname === "/login" || url.pathname.startsWith("/login/"))
      return "/";
    // ONLY AN ALREADY NORMAL PATH (barracuda, #2523): the URL parser resolves dot segments, so "/.//evil.example" comes out
    // as "//evil.example", a protocol-relative address the raw checks above never saw. A path the parser would change is
    // refused, so what is returned is exactly what was checked.
    const normal = `${url.pathname}${url.search}${url.hash}`;
    return normal === value ? normal : "/";
  } catch {
    return "/";
  }
}

/** The login address that comes back here afterwards. */
export function loginPathFor(current: string): string {
  const back = safeReturnPath(current);
  return back === "/" ? "/login" : `/login?next=${encodeURIComponent(back)}`;
}
