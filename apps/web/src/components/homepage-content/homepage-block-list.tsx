"use client";

import { PilotCard } from "@acropora/ui";
import type { HomepageBlock, HomepageBlockKey } from "@acropora/types";
import { useState } from "react";

import { blockMeta, moveBlock } from "./homepage-blocks";
import { Kapcsolo } from "./homepage-fields";

export type HomepageSelection = HomepageBlockKey | "footer";

/**
 * THE LEFT COLUMN, "Blokkok" (Figma 685:535; Balázs's brief, 4. pont): the
 * blocks in page order, each with a drag handle, its note (or "Rejtve") and
 * the "Látszik" switch; under a separator the footer, which is always last,
 * cannot be moved and cannot be hidden.
 *
 * THE ORDER CHANGES TWO WAYS: by dragging a row, and from the keyboard on the
 * handle (up and down arrows), so it is not a mouse-only control.
 */
export function HomepageBlockList({
  blocks,
  selected,
  onSelect,
  onChange,
}: {
  blocks: readonly HomepageBlock[];
  selected: HomepageSelection;
  onSelect: (selection: HomepageSelection) => void;
  onChange: (blocks: HomepageBlock[]) => void;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  return (
    <PilotCard className="p-4">
      <h2 className="text-base font-semibold text-pilot-grey-900">Blokkok</h2>
      <p className="mt-0.5 text-xs text-pilot-grey-500">
        Húzd a blokkokat az új sorrendbe
      </p>
      <ol aria-label="Kezdőlap blokkjai" className="mt-4 space-y-2">
        {blocks.map((block, index) => {
          const meta = blockMeta(block.key);
          const active = selected === block.key;
          return (
            <li
              key={block.key}
              data-testid={`homepage-block-${block.key}`}
              draggable
              onDragStart={(event) => {
                setDragged(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (dragged !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null)
                  onChange(moveBlock(blocks, dragged, index));
                setDragged(null);
              }}
              onDragEnd={() => setDragged(null)}
              className={`flex items-center gap-2 rounded-lg p-3 ring-1 transition-colors ${
                active
                  ? "bg-pilot-aqua-50 ring-pilot-aqua-500"
                  : "bg-white ring-pilot-grey-200 hover:bg-pilot-grey-50"
              } ${block.visible ? "" : "opacity-60"}`}
            >
              <button
                type="button"
                aria-label={`${meta.label} áthelyezése (fel és le nyíl)`}
                onKeyDown={(event) => {
                  const to =
                    event.key === "ArrowUp"
                      ? index - 1
                      : event.key === "ArrowDown"
                        ? index + 1
                        : null;
                  if (to === null) return;
                  event.preventDefault();
                  onChange(moveBlock(blocks, index, to));
                }}
                className="cursor-grab px-1 text-pilot-grey-400"
              >
                ⋮⋮
              </button>
              <button
                type="button"
                aria-label={`${meta.label} szerkesztése`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(block.key)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={`block text-[13px] font-semibold ${
                    active ? "text-pilot-aqua-700" : "text-pilot-grey-900"
                  }`}
                >
                  {meta.label}
                </span>
                <span className="mt-1 block text-xs text-pilot-grey-500">
                  {block.visible ? meta.note : "Rejtve"}
                </span>
              </button>
              <Kapcsolo
                label={`${meta.label}: látszik`}
                checked={block.visible}
                onChange={(visible) =>
                  onChange(
                    blocks.map((b, i) => (i === index ? { ...b, visible } : b)),
                  )
                }
              />
            </li>
          );
        })}
      </ol>
      <hr className="my-4 border-pilot-grey-200" />
      <button
        type="button"
        aria-label="Lábléc szerkesztése"
        aria-current={selected === "footer" ? "true" : undefined}
        onClick={() => onSelect("footer")}
        className={`block w-full rounded-lg p-3 text-left ring-1 ${
          selected === "footer"
            ? "bg-pilot-aqua-50 ring-pilot-aqua-500"
            : "bg-pilot-grey-50 ring-pilot-grey-200"
        }`}
      >
        <span className="block text-[13px] font-semibold text-pilot-grey-900">
          Lábléc
        </span>
        <span className="mt-1 block text-xs text-pilot-grey-500">
          minden oldalon · rögzített
        </span>
      </button>
      <p className="mt-4 text-xs text-pilot-grey-500">
        A sorrend és a láthatóság állítható.
      </p>
    </PilotCard>
  );
}
