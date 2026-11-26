import {
  RENTAL_CONTRACT_VARIABLES,
  fillRentalContractTemplate,
  rentalContractBlocks,
  type RentalContractValues,
} from "@acropora/types";
import { Fragment, type ReactNode } from "react";

/*
  THE CONTRACT'S PREVIEW BESIDE ITS RAW TEXT (Picasso 3.28, acrobot's decision 2026-11-26, card f0b70dbd): the raw text with `## ` and
  `{{mezo}}` is hard to read as the paper it becomes. The preview is built by the SAME two helpers the PDF uses
  (`fillRentalContractTemplate`, `rentalContractBlocks`), so a heading, a paragraph, a kept line break and the signature lines look here
  as they will be printed. A known place shows its own label in brackets, marked, not an invented value; an unknown one stays as typed
  (the PDF prints it so too). Display only: nothing here saves.
*/

/** The bounds of a filled place in the text: characters no typed contract contains, so the label can be marked after the fill. */
const START = "\u0001";
const END = "\u0002";

const PLACEHOLDERS = Object.fromEntries(
  Object.entries(RENTAL_CONTRACT_VARIABLES).map(([key, label]) => [
    key,
    `${START}${label}${END}`,
  ]),
) as RentalContractValues;

/** One line, with its filled places marked. */
function Line({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const from = rest.indexOf(START);
    const to = from < 0 ? -1 : rest.indexOf(END, from);
    if (from < 0 || to < 0) break;
    if (from > 0) parts.push(rest.slice(0, from));
    parts.push(
      <span
        key={key++}
        data-place
        className="rounded bg-brand-50 px-1 text-brand-700"
      >
        [{rest.slice(from + 1, to)}]
      </span>,
    );
    rest = rest.slice(to + 1);
  }
  if (rest) parts.push(rest);
  return <>{parts}</>;
}

export function RentalContractPreview({ template }: { template: string }) {
  const blocks = rentalContractBlocks(
    fillRentalContractTemplate(template, PLACEHOLDERS),
  );
  return (
    <section
      aria-label="A szerződés előnézete"
      className="space-y-3 rounded-lg border border-dusk-200 bg-white p-5 text-sm text-dusk-800"
    >
      {blocks.length === 0 ? (
        <p className="text-dusk-500">A szöveg üres.</p>
      ) : (
        blocks.map((block, index) =>
          block.kind === "heading" ? (
            <h3 key={index} className="pt-2 font-semibold text-dusk-900">
              <Line text={block.text} />
            </h3>
          ) : block.kind === "signatures" ? (
            <div
              key={index}
              data-testid="preview-signatures"
              className="grid grid-cols-2 gap-8 pt-8"
            >
              {["Bérbeadó", "Bérlő"].map((label) => (
                <div
                  key={label}
                  className="border-t border-dusk-400 pt-1 text-center text-xs text-dusk-600"
                >
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  <Line text={line} />
                </Fragment>
              ))}
            </p>
          ),
        )
      )}
    </section>
  );
}
