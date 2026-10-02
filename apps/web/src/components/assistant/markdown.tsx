import type { ReactNode } from "react";
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}
/** Text nodes only: gateway Markdown cannot inject HTML, scripts or external images. */
export function AssistantMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|"))
        rows.push(cells(lines[i++]!));
      i--;
      blocks.push(
        <div key={i} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={index}
                    className="border border-pilot-grey-200 p-2 text-left"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td
                      key={column}
                      className="border border-pilot-grey-200 p-2"
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]!))
        items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s/, ""));
      i--;
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag
          key={i}
          className={`my-2 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </Tag>,
      );
    } else if (line.trim())
      blocks.push(
        <p key={i} className="my-1 whitespace-pre-wrap">
          {inline(line)}
        </p>,
      );
  }
  return <>{blocks}</>;
}
