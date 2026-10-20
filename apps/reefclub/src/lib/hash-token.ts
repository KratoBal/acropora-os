/** The `token` of a `#token=…` fragment, or null. The e-mail links carry it there (reefclub-mail.ts). */
export function tokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return value && value.length <= 200 ? value : null;
}
