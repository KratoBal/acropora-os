export const SEARCH_GROUPS = [
  "tickets",
  "worksheets",
  "assets",
  "partners",
  "aquariums",
] as const;

export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

/** A group is present only when the caller may view its matching list page. */
export type SearchResponse = Partial<Record<SearchGroup, SearchResultItem[]>>;
