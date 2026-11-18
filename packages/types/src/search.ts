export const SEARCH_GROUPS = [
  "tickets",
  // a karbantartási lap NEM hibajegy: saját csoport, saját felirat és útvonal (Balázs, 2026-11-18)
  "maintenance",
  "worksheets",
  "assets",
  "partners",
  "aquariums",
  "invoices",
  "quotes",
  "orders",
  "products",
  "customers",
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
