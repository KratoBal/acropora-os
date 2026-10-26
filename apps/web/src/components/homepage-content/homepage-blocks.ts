import {
  HOMEPAGE_BLOCK_KEYS,
  type HomepageBlock,
  type HomepageBlockKey,
} from "@acropora/types";

/**
 * THE HOME PAGE BLOCKS IN THE ADMIN (Balázs's brief, 2026-10-26 08:28 UTC,
 * `exchange/kezdolap-admin-megbizas-balazs-2026-10-26.txt`, 4. pont; Figma
 * 685:535). Every block of the storefront, in its order, and which field groups
 * of `HOMEPAGE_TEXT_FIELDS` its editor shows. A test asserts that every group
 * belongs to exactly one block, so no field drops out of the editor.
 *
 * `tabs`: the block has one editor tab per group ("Kezdőknek és
 * tapasztaltaknak" is ONE storefront block with two tabs).
 */
export interface HomepageBlockMeta {
  readonly key: HomepageBlockKey;
  readonly label: string;
  /** The grey note under the name in the list (Figma). */
  readonly note: string;
  readonly groups: readonly string[];
  readonly tabs?: true;
}

export const HOMEPAGE_BLOCKS: readonly HomepageBlockMeta[] = [
  {
    key: "hero",
    label: "Fejléc diák",
    note: "legfeljebb 5 dia",
    groups: ["Hero"],
  },
  {
    key: "mit-keresel",
    label: "Mit keresel ma?",
    note: "4 terület",
    groups: [
      "Mit keresel ma?",
      "Mit keresel ma? 1. terület",
      "Mit keresel ma? 2. terület",
      "Mit keresel ma? 3. terület",
      "Mit keresel ma? 4. terület",
    ],
  },
  {
    key: "kezdo-es-halado",
    label: "Kezdőknek és tapasztaltaknak",
    note: "két fül",
    groups: ["Kezdőknek", "Tapasztaltaknak"],
    tabs: true,
  },
  {
    key: "egyedi-korallok",
    label: "Egyedi korallok",
    note: "legfeljebb 12 termék",
    groups: [],
  },
  {
    key: "szolgaltatasok",
    label: "Szolgáltatások",
    note: "szolgáltatás-kártyák",
    groups: ["Szolgáltatások"],
  },
  { key: "markak", label: "Márkák", note: "márkasáv", groups: ["Márkák"] },
  {
    key: "velemenyek",
    label: "Vélemények",
    note: "vásárlói vélemények",
    groups: ["Vélemények"],
  },
  {
    key: "boltunk",
    label: "A boltunk",
    note: "cím, nyitvatartás, elérhetőség",
    groups: ["A boltunk"],
  },
];

const META = new Map(HOMEPAGE_BLOCKS.map((block) => [block.key, block]));

export function blockMeta(key: HomepageBlockKey): HomepageBlockMeta {
  return META.get(key) as HomepageBlockMeta;
}

/** The stored list, or the storefront's own order with every block shown. */
export function effectiveBlocks(
  blocks: readonly HomepageBlock[] | null,
): HomepageBlock[] {
  return blocks
    ? blocks.map((block) => ({ ...block }))
    : HOMEPAGE_BLOCK_KEYS.map((key) => ({ key, visible: true }));
}

/** One block moved to a new place; an index out of range changes nothing. */
export function moveBlock(
  blocks: readonly HomepageBlock[],
  from: number,
  to: number,
): HomepageBlock[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= blocks.length ||
    to >= blocks.length
  )
    return [...blocks];
  const list = [...blocks];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved as HomepageBlock);
  return list;
}

/**
 * WHAT A SAVE SENDS: `null` while the list is still the storefront's own order
 * with every block shown, so an untouched page keeps following a later
 * storefront change instead of freezing today's order.
 */
export function blocksForSave(
  blocks: readonly HomepageBlock[],
): HomepageBlock[] | null {
  const own =
    blocks.length !== HOMEPAGE_BLOCK_KEYS.length ||
    blocks.some(
      (block, i) => block.key !== HOMEPAGE_BLOCK_KEYS[i] || !block.visible,
    );
  return own ? blocks.map(({ key, visible }) => ({ key, visible })) : null;
}

export const allBlocksHidden = (blocks: readonly HomepageBlock[]): boolean =>
  blocks.every((block) => !block.visible);
