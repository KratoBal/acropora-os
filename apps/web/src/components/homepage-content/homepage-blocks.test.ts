import { HOMEPAGE_BLOCK_KEYS, HOMEPAGE_TEXT_FIELDS } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  allBlocksHidden,
  blocksForSave,
  effectiveBlocks,
  HOMEPAGE_BLOCKS,
  moveBlock,
} from "./homepage-blocks";

/*
  THE BLOCK MAP OF THE ADMIN. What turns these red: a field group that no block
  shows (its fields would vanish from the editor), a group shown by two blocks,
  a block missing from the list or out of the storefront's order, a move that
  loses or doubles a block, an untouched page saved as an own order.
*/
describe("HOMEPAGE_BLOCKS", () => {
  it("lists every storefront block once, in the storefront's order", () => {
    expect(HOMEPAGE_BLOCKS.map((b) => b.key)).toEqual([...HOMEPAGE_BLOCK_KEYS]);
  });

  it("shows every field group in exactly one block", () => {
    const groups = new Set(HOMEPAGE_TEXT_FIELDS.map((f) => f.group));
    const shown = HOMEPAGE_BLOCKS.flatMap((b) => b.groups);
    expect(new Set(shown)).toEqual(groups);
    expect(shown).toHaveLength(groups.size);
  });
});

describe("the block list helpers", () => {
  it("not set is the storefront's order with every block shown", () => {
    const blocks = effectiveBlocks(null);
    expect(blocks.map((b) => b.key)).toEqual([...HOMEPAGE_BLOCK_KEYS]);
    expect(blocks.every((b) => b.visible)).toBe(true);
    expect(blocksForSave(blocks)).toBeNull();
  });

  it("a move keeps every block once; a hidden block or a move is an own list", () => {
    const moved = moveBlock(effectiveBlocks(null), 7, 0);
    expect(moved.map((b) => b.key)[0]).toBe("boltunk");
    expect(new Set(moved.map((b) => b.key)).size).toBe(8);
    expect(blocksForSave(moved)).toHaveLength(8);
    const hidden = effectiveBlocks(null).map((b, i) =>
      i === 2 ? { ...b, visible: false } : b,
    );
    expect(blocksForSave(hidden)?.[2]).toEqual({
      key: "kezdo-es-halado",
      visible: false,
    });
    expect(moveBlock(moved, 0, 99)).toEqual(moved);
  });

  it("all hidden is recognised", () => {
    const blocks = effectiveBlocks(null);
    expect(allBlocksHidden(blocks)).toBe(false);
    expect(allBlocksHidden(blocks.map((b) => ({ ...b, visible: false })))).toBe(
      true,
    );
  });
});
