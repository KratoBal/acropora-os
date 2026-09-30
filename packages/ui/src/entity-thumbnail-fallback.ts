import type { IconName } from "./icon";

/**
 * WHAT A ROW SHOWS WHEN IT HAS NO IMAGE (Direction F, Balázs's brief,
 * 2026-09-30, point 4): not the same generic package icon on every row, but
 *   1. the real image (the caller's, not decided here),
 *   2. the CATEGORY's icon,
 *   3. the BRAND's monogram,
 *   4. and only then the generic one.
 *
 * Pure, so the rule is testable without a DOM, and reusable for any list
 * with categories (the Purchasing list is next in the same design).
 */
export type ThumbnailFallback =
  | { kind: "icon"; icon: IconName }
  | { kind: "monogram"; text: string }
  | { kind: "generic" };

/**
 * THE CATEGORY GROUPS, BY THE NAMES MEASURED ON PRODUCTION (acrobot,
 * 2026-09-30 12:2x, `exchange/figma-os-direction-f/kategoriak-eles-
 * 2026-09-30.txt`: 1909 products, 1901 with a primary category).
 *
 * The primary category is often a BRAND leaf ("Fauna Marin" under
 * "Nyomelemek", "Maxspect" under "Áramoltatók"), so the group is looked up
 * along the whole path, leaf first: the nearest named ancestor decides
 * ("Koralltápok" is food even though it may sit under a chemistry branch).
 * By the leaf and its parent alone this covers 1790 of the 1901 (94.2%);
 * most of the rest resolve one level higher ("Foszfátmegkötők" under
 * "Problémamegoldás"). What stays generic is meant to: the root
 * "Termékek", the outlet, gifts, aquarium sets.
 *
 * NO BRAND IS READ FROM A CATEGORY NAME: the brand monogram comes only from
 * the product's brand (today empty on every product, measured the same
 * day), never from a leaf that happens to be a brand.
 */
const CATEGORY_GROUPS: ReadonlyArray<{
  icon: IconName;
  names: readonly string[];
}> = [
  { icon: "fish", names: ["Halak", "Gerinctelenek", "Korallok"] },
  {
    icon: "food",
    names: [
      "Eledelek",
      "Haleledelek",
      "Fagyasztott eledelek",
      "Koralltápok",
      "Algalapok",
    ],
  },
  {
    icon: "lightbulb",
    names: ["LED világítások", "T5 fénycsövek", "Világítástechnika (Lámpák)"],
  },
  {
    icon: "waves",
    names: [
      "Áramoltatók",
      "Felnyomó szivattyúk",
      "Szivattyúk",
      "Lehabzó szivattyúk",
      "Légpumpák",
    ],
  },
  {
    icon: "filter",
    names: [
      "Szűrők, szűrőzsákok, papírszűrők",
      "Lehabzók",
      "RO-vízlágyítás",
      "Lebegtető szűrők",
      "UV szűrők",
      "Szűrőanyagok",
      "Előszűrők, papírszűrők",
    ],
  },
  { icon: "activity", names: ["Tesztek, mérés, vezérlés", "Víztesztek"] },
  {
    icon: "droplet",
    names: [
      "Nyomelemek",
      "Tengeri só",
      "Vízkezelés",
      "Aminosavak és vitaminok",
      "Problémamegoldás",
      "Coral Essential",
      "Nyomelemadagolók, tartozékok",
    ],
  },
  {
    icon: "service",
    names: [
      "Akváriumkarbantartás, eszközök",
      "Akvárium építési eszközök",
      "Fűtés/Hűtés",
      "Vízutántöltő",
    ],
  },
  { icon: "aquarium", names: ["biOrb"] },
];

const GROUP_BY_NAME = new Map(
  CATEGORY_GROUPS.flatMap(({ icon, names }) =>
    names.map((name) => [name.trim().toLocaleLowerCase("hu"), icon] as const),
  ),
);

/** The group icon of a category path (root first, leaf last), or null. */
export function categoryGroupIcon(
  path: readonly string[] | null | undefined,
): IconName | null {
  if (!path) return null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const icon = GROUP_BY_NAME.get(
      (path[index] ?? "").trim().toLocaleLowerCase("hu"),
    );
    if (icon) return icon;
  }
  return null;
}

/**
 * A brand's monogram, as the brief's examples read: "Red Sea" RS,
 * "Tropic Marin" TM, "Reef Factory" RF (two words: their initials); "ATI"
 * stays ATI (an all-caps short name is already a monogram); "Ecotech" EC,
 * "Nyos" NY (one word: its first two letters); "MaxSpect" MS (one word with
 * an inner capital: the two capitals).
 */
export function brandMonogram(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .trim()
    .split(/[\s-]+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return null;
  const first = words[0]!;
  if (words.length >= 2)
    return (first[0]! + words[1]![0]!).toLocaleUpperCase("hu");
  if (first.length <= 4 && first === first.toLocaleUpperCase("hu"))
    return first;
  const inner = /^.\p{Ll}*(\p{Lu})/u.exec(first)?.[1];
  if (inner) return (first[0]! + inner).toLocaleUpperCase("hu");
  return first.slice(0, 2).toLocaleUpperCase("hu");
}

/** Category first, then the brand, then generic. */
export function thumbnailFallback(input: {
  categoryPath?: readonly string[] | null;
  brandName?: string | null;
}): ThumbnailFallback {
  const icon = categoryGroupIcon(input.categoryPath);
  if (icon) return { kind: "icon", icon };
  const text = brandMonogram(input.brandName);
  if (text) return { kind: "monogram", text };
  return { kind: "generic" };
}
