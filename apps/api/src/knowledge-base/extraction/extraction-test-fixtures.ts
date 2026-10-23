/**
 * An invented open-access paper in the JATS shape Europe PMC serves (tag
 * structure measured 2026-10-23 on two real full texts: abstract in <front>,
 * top-level <sec> in <body>, nested sections, tables, <back> with the
 * reference list). No third-party text.
 */
export const JATS = `<?xml version="1.0"?>
<article><front><article-meta>
<abstract><p>Kitalált absztrakt: calcification fell under phosphate enrichment.</p></abstract>
<abstract abstract-type="graphical"><p>Graphical, left out.</p></abstract>
</article-meta></front>
<body>
<sec><title>Introduction</title><p>Earlier work reported 50 µM effects (Other et al.).</p></sec>
<sec><title>Methods</title>
<p>Colonies of <italic>Acropora millepora</italic> (n = 12) were kept in laboratory tanks at 26 &#x00B0;C for 8 weeks.</p>
<p>Phosphate was measured with an autoanalyzer.</p>
<sec><title>Treatments</title><p>Treatments were 0.5 and 2 µM phosphate.</p></sec>
</sec>
<sec><title>Results</title>
<p>Calcification decreased by 18 % at 2 µM phosphate compared with the control (&#177; 3.1 SE).</p>
<p>Porites lutea colonies were not tested.</p>
<table-wrap><label>Table 1</label><caption><p>Skeletal density</p></caption>
<table><tr><th>Treatment</th><th>Density</th></tr><tr><td>0.5 µM</td><td>1.42</td></tr></table></table-wrap>
</sec>
<sec><title>Acknowledgements</title><p>Thanks to nobody.</p></sec>
</body>
<back><ref-list><ref><mixed-citation>Ref 1 (2001).</mixed-citation></ref></ref-list></back>
</article>`;

export const PASSAGE =
  "Calcification decreased by 18 % at 2 µM phosphate compared with the control (± 3.1 SE).";

/** An AI answer's claim in the shape the AI service sends it. */
export function aiClaim(over: Record<string, unknown> = {}) {
  return {
    passage: { text: PASSAGE, locator: "whatever the model said" },
    fields: [
      {
        field: "species",
        value: "ACROPORA_MILLEPORA",
        anchor: "Colonies of Acropora millepora (n = 12)",
      },
      {
        field: "environment",
        value: "LAB",
        anchor: "kept in laboratory tanks",
      },
      {
        field: "effect",
        value: "CALCIFICATION",
        anchor: "Calcification decreased",
      },
      {
        field: "direction",
        value: "DECREASE",
        anchor: "Calcification decreased by 18 %",
      },
      {
        field: "quantity",
        min: 2,
        max: 2,
        unit: "µmol/l",
        basis: null,
        anchor: "at 2 µM phosphate",
      },
      {
        field: "studyType",
        value: "CONTROLLED_LAB",
        anchor: "compared with the control",
      },
      {
        field: "sampleSize",
        value: 12,
        unit: "colonies",
        anchor: "Colonies of Acropora millepora (n = 12)",
      },
      {
        field: "measurementMethod",
        value: "AUTOANALYZER",
        anchor: "Phosphate was measured with an autoanalyzer.",
      },
      {
        field: "uncertainty",
        value: "± 3.1 SE",
        anchor: "compared with the control (± 3.1 SE).",
      },
    ],
    refusedFields: [],
    questions: [
      {
        field: "species",
        proposed: "Porites lutea",
        anchor: "Porites lutea colonies were not tested.",
      },
    ],
    ...over,
  };
}
