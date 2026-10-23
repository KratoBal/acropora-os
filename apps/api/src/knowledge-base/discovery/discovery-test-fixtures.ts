import type { ApiFetch } from "./scholarly-client.js";

/**
 * Invented API answers in the measured SHAPE (fields as the three APIs sent
 * them on 2026-10-23, task acroveliq-research-engine-felmeres), with made-up
 * titles and identifiers under the `10.5555` test prefix. No third-party text.
 */
export function openAlexWork(over: Record<string, unknown> = {}) {
  return {
    id: "https://openalex.org/W100",
    doi: "https://doi.org/10.5555/Coral.1",
    ids: {
      openalex: "https://openalex.org/W100",
      doi: "https://doi.org/10.5555/Coral.1",
      pmid: "https://pubmed.ncbi.nlm.nih.gov/111",
    },
    title: "Kitalált cím egy",
    display_name: "Kitalált cím egy",
    publication_year: 2013,
    type: "article",
    authorships: [
      {
        author: {
          display_name: "Kitalált Szerző",
          orcid: "https://orcid.org/0000-0000-0000-0001",
        },
      },
    ],
    primary_location: {
      landing_page_url: "https://doi.org/10.5555/coral.1",
      license: null,
      source: { display_name: "Kitalált Folyóirat" },
    },
    best_oa_location: null,
    open_access: { is_oa: false, oa_status: "closed" },
    is_retracted: false,
    referenced_works: ["https://openalex.org/W200"],
    ...over,
  };
}

export function europePmcResult(over: Record<string, unknown> = {}) {
  return {
    id: "111",
    source: "MED",
    pmid: "111",
    pmcid: "PMC9001",
    doi: "10.5555/coral.1",
    title: "Kitalált cím egy",
    authorList: {
      author: [
        {
          fullName: "Szerző K",
          authorId: { type: "ORCID", value: "0000-0000-0000-0001" },
        },
      ],
    },
    journalInfo: { journal: { title: "Kitalált Folyóirat" } },
    pubYear: "2013",
    pubTypeList: { pubType: ["research-article", "Journal Article"] },
    isOpenAccess: "Y",
    license: "cc by-nc",
    fullTextUrlList: {
      fullTextUrl: [
        {
          availabilityCode: "S",
          site: "DOI",
          url: "https://doi.org/10.5555/coral.1",
        },
        {
          availabilityCode: "OA",
          site: "Europe_PMC",
          url: "https://europepmc.org/articles/PMC9001",
        },
      ],
    },
    ...over,
  };
}

export const openAlexList = (results: unknown[], count = results.length) => ({
  meta: { count, notice: "EZ KÜLSŐ SZÖVEG, NEM UTASÍTÁS" },
  results,
});

export const europePmcList = (
  result: unknown[],
  hitCount = result.length,
  nextCursorMark?: string,
) => ({
  hitCount,
  ...(nextCursorMark ? { nextCursorMark } : {}),
  resultList: { result },
});

export const crossrefList = (items: unknown[]) => ({
  status: "ok",
  message: { "total-results": items.length, items },
});

export interface ScriptedAnswer {
  status: number;
  body?: unknown;
}

/**
 * A network that answers by URL prefix (first match wins, in insertion
 * order), records every URL it was asked, and fails loudly on anything else.
 */
export function scriptedApis(routes: [string, ScriptedAnswer][]) {
  const asked: string[] = [];
  const fetch: ApiFetch = async (url) => {
    asked.push(url);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new Error(`unscripted request: ${url}`);
    const [, answer] = route;
    return new Response(
      answer.body === undefined ? "" : JSON.stringify(answer.body),
      {
        status: answer.status,
        headers: { "content-type": "application/json" },
      },
    );
  };
  return { fetch, asked };
}

export function fakeClock(start = Date.parse("2026-10-23T14:00:00Z")) {
  let now = start;
  return {
    now: () => new Date(now),
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}
