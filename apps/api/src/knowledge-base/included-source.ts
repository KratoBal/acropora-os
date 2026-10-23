/**
 * A claim the editor works on stands on an INCLUDED source: a pending or
 * excluded source's claims are neither waiting nor a problem (barracuda,
 * #1848 note b). The review queue reads the same filter.
 */
export const CLAIM_ON_INCLUDED_SOURCE = {
  evidence: {
    some: {
      passage: {
        sourceVersion: { source: { screeningStatus: "INCLUDED" as const } },
      },
    },
  },
};
export const ANCHOR_ON_INCLUDED_SOURCE = {
  OR: [
    {
      claimEvidence: {
        passage: {
          sourceVersion: { source: { screeningStatus: "INCLUDED" as const } },
        },
      },
    },
    { source: { screeningStatus: "INCLUDED" as const } },
  ],
};
