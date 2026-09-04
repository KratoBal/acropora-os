export interface DescriptionImageReference {
  url: string;
  host: string | null;
  isOwn: boolean;
}
export function ownImageReferenceHosts(
  value = process.env.OWN_IMAGE_REFERENCE_HOSTS ?? "",
): Set<string> {
  return new Set(
    value
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}
export function descriptionImageReferences(
  html: string | null,
  ownHosts: ReadonlySet<string>,
): DescriptionImageReference[] {
  if (!html) return [];
  const found: DescriptionImageReference[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    const url = match[2]?.trim();
    if (!url) continue;
    if (url.startsWith("//")) {
      const parsed = new URL(`https:${url}`);
      found.push({
        url,
        host: parsed.hostname,
        isOwn: ownHosts.has(parsed.hostname.toLowerCase()),
      });
      continue;
    }
    if (url.startsWith("/") || !/^[A-Za-z][A-Za-z\d+.-]*:/.test(url)) {
      found.push({ url, host: null, isOwn: true });
      continue;
    }
    try {
      const parsed = new URL(url);
      found.push({
        url,
        host: parsed.hostname,
        isOwn: ownHosts.has(parsed.hostname.toLowerCase()),
      });
    } catch {
      found.push({ url, host: null, isOwn: false });
    }
  }
  return found;
}
