export function mailAuthorDisplayName(from: string | undefined): string | null {
  if (!from) return null;
  const match = from.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
  if (!match) return null;
  let name = match[1]!
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/\\(["\\])/g, "$1");
  name = name
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (word, charset, encoding, data) => {
        if (!/^(?:utf-8|us-ascii)$/i.test(charset)) return word;
        try {
          return encoding.toLowerCase() === "b"
            ? Buffer.from(data, "base64").toString("utf8")
            : Buffer.from(
                data
                  .replace(/_/g, " ")
                  .replace(/=([0-9a-f]{2})/gi, (_: string, h: string) =>
                    String.fromCharCode(parseInt(h, 16)),
                  ),
                "binary",
              ).toString("utf8");
        } catch {
          return word;
        }
      },
    );
  name = name.replace(/[\r\n\u0000-\u001f]/g, " ").trim();
  return name && !name.includes("@") ? name.slice(0, 200) : null;
}
