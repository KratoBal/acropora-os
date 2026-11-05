/**
 * A LATOGATO IP-JE AZ API SEBESSEGKORLATJANAK. Az api a `X-Forwarded-For` fejlecbol szamol; a jatek szervere mogott
 * kulonben mindenki egy cimnek latszana.
 *
 * AZ UTOLSO ERVENYES BEJEGYZES, NEM AZ ELSO: a proxy (Traefik/Coolify) a latogato cimet a fejlec VEGERE fuzi, az
 * elejen pedig barmit lehet kuldeni (egy latogato maga is tehet `X-Forwarded-For`-t a kereseibe). Az elso bejegyzes
 * tehat hamisithato, az utolso a proxye. Ha a fejlec nincs vagy nincs benne ervenyes cim, `null`: az api akkor a
 * jatek szerverenek cimet latja, ami szigorubb korlatot jelent, nem lazabbat.
 */
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

const ervenyesCim = (s: string): boolean =>
  s.length <= 45 &&
  ((IPV4.test(s) && s.split(".").every((n) => Number(n) <= 255)) ||
    (s.includes(":") && IPV6.test(s)));

export function latogatoIp(
  forwardedFor: string | null | undefined,
): string | null {
  if (!forwardedFor) return null;
  const mind = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (let i = mind.length - 1; i >= 0; i -= 1) {
    const cim = mind[i]!;
    if (ervenyesCim(cim)) return cim;
  }
  return null;
}
