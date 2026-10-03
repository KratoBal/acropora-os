# JEV product check: the first live round, in shadow (PD-013)

**Decision:** Balázs, 2026-10-02 20:24:10 UTC, main channel, message_id
1555676794944753738:

> „1 beszallitoi, gyártói oldal, bulk reef supply, marine-aquatics.eu oldalakról
> első körben 2. elfogad 3 Luca es en lassuk"

It continues ACD-021 and the V0 model in
[`product-enrichment-v0.md`](product-enrichment-v0.md).

**Owner answers in the build session (2026-10-02):**

- **Finding pages:** the run takes a hand-made list of product page URLs per
  source, and uses the manufacturer link UNAS holds automatically. There is
  no site search.
- **Retailers:** Bulk Reef Supply and marine-aquatics.eu count as supplier
  pages, so they can verify a value.
- **Supplier site:** a supplier's own site is a new, hand-filled field,
  `Supplier.websiteUrl`.

## What a run does

A run is started by hand on the server for one product or a small hand-made
list. For each product:

1. **Sources.** It takes the given page URLs, plus the manufacturer link UNAS
   holds for the product.
2. **Host rule.** Each URL is checked against its source kind (below). A URL
   outside the four kinds is **refused** and never requested.
3. **Reading.** Each page is read politely (below). A refusing, captcha or
   robots-disallowed page makes that source **unavailable**, with a reason.
4. **Extraction.** From each page it takes only the schema.org `Product` the
   page publishes as JSON-LD. Free text and tables are not read. The fields
   are EAN, manufacturer part number, brand, name, weight, dimensions, and the
   named properties flow rate, power, voltage, volume and capacity.
   One exception (Balázs, 2026-10-03 06:45 UTC): marine-aquatics.eu has no
   JSON-LD, so on its pages the fixed labelled row list (`ul.data-row`) is read
   by exact label, and only `EAN` and the net `Hmotnost` (weight) are taken.
   Its catalogue number is the shop's own code and its `Výrobce` is sometimes
   the company, so neither is used.
5. **Reconciliation.** Every field is reconciled with the V0 model
   (`reconcileField` and the Tier C guard) against our own current value:
   - agreeing independent sources give **VERIFIED**;
   - disagreeing ones give **CONFLICTING_SOURCES**, with no value picked;
   - our own value alone gives **UNVERIFIED**;
   - the name is compared page against page only: ours is Hungarian and
     editorial, so against a shop's name it would always conflict;
   - a brand is the same value in any letter case ("TUNZE", "Tunze");
   - no value at all gives **MISSING**.
6. **Storage.** Each field is stored with its source, the source URL, the read
   time, the raw value and an excerpt saying where on the page it was.

**The product is never written.** The run's store writes only the enrichment
tables (`ProductEnrichmentRun`, `…RunProduct`, `…SourceFetch`,
`…FieldResult`). A test reads the store's source and allows no other write. An
integration test compares the product, its variant, barcode, brand and
supplier before and after a run, byte for byte.

## The four sources

| Kind               | Host rule                                                    | V0 class          |
| ------------------ | ------------------------------------------------------------ | ----------------- |
| `MANUFACTURER`     | the brand's `websiteUrl`, or the UNAS `manufacturerUrl` host | MANUFACTURER_PAGE |
| `SUPPLIER`         | the named supplier's `websiteUrl` host                       | SUPPLIER_PAGE     |
| `BULK_REEF_SUPPLY` | `bulkreefsupply.com`                                         | SUPPLIER_PAGE     |
| `MARINE_AQUATICS`  | `marine-aquatics.eu`                                         | SUPPLIER_PAGE     |

**What the host rule accepts:**

- **Hosts:** the base domain itself or one of its subdomains.
- **URLs:** https only, with no credentials, no non-default port and no IP
  literal.

**What it refuses:**

- a UNAS manufacturer link that points at one of the retailers is not a
  manufacturer site;
- with no known manufacturer site, a `MANUFACTURER` URL is refused with
  `NO_MANUFACTURER_SITE`;
- with no supplier website, a `SUPPLIER` URL is refused with
  `NO_SUPPLIER_SITE`.

Our own data (OS, UNAS) is the current value. It cannot verify itself.

## Reading politely: the settings

| What               | Setting                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request            | `GET` only, anonymous: no cookie, no login, no cart, no paid content                                                                                                                                                                |
| User-Agent         | `AcroporaOS-JEV/1.0 (+https://acropora.hu; termekadat-ellenorzes)`; robots.txt groups are matched on `AcroporaOS-JEV`                                                                                                               |
| robots.txt         | read once per host per run, before the first page; a disallowed path is never requested                                                                                                                                             |
| robots.txt answers | 2xx: parsed; 404 and other 4xx: everything allowed; 401/403: everything disallowed; 429, 5xx, 3xx or network error: the host is unavailable for the run                                                                             |
| Pace               | at least **5 s** between two requests to the same host, or the robots.txt `Crawl-delay` when longer (capped at 60 s)                                                                                                                |
| Cache              | per run: a URL is requested once, and a second ask gets the first answer; robots.txt is cached per host                                                                                                                             |
| Timeout and size   | 20 s per request; a page up to 2 MB, robots.txt up to 512 KB                                                                                                                                                                        |
| Accepted answer    | `text/html` or `application/xhtml+xml` only                                                                                                                                                                                         |
| Redirects          | followed up to 3 times, only within the same source's host rule; otherwise `REDIRECT_OFF_SOURCE`                                                                                                                                    |
| Refusals           | 401, 403, 429, 503, any non-2xx, or a challenge/captcha page (Cloudflare, reCAPTCHA, hCaptcha, PerimeterX, DataDome markers) make the source **unavailable** with a reason. Nothing retries or tries another way in.                |
| Caps               | per run: at most 20 products by default (50 maximum) and 200 requests by default (1000 maximum). Reaching a cap stops the run with status `LIMIT_REACHED`; the product being read when the request cap hit is not stored half-done. |

## Running it

```
pnpm --filter @acropora/api jev:enrich --input run.json            # plan only
pnpm --filter @acropora/api jev:enrich --input run.json \
  --apply --actor <userId> [--max-products N] [--max-requests N]  # read and store
```

**The input file:**

```json
{
  "products": [
    {
      "productId": "...",
      "sources": [
        {
          "kind": "BULK_REEF_SUPPLY",
          "url": "https://www.bulkreefsupply.com/..."
        },
        { "kind": "MARINE_AQUATICS", "url": "https://marine-aquatics.eu/..." },
        {
          "kind": "SUPPLIER",
          "supplierId": "...",
          "url": "https://<its site>/..."
        }
      ]
    }
  ]
}
```

**What the command does:**

- **Without `--apply`:** it only plans. It checks every product exists and
  every URL against its host rule, and prints the result. Nothing goes out on
  the network and nothing is stored.
- **With `--apply`:** it needs `JEV_PRODUCT_ENRICHMENT` not `off` and an
  existing user as `--actor`.
- **Exit codes:** 0 finished; 1 switch off; 2 bad input, unknown product or
  actor; 3 a cap was reached (printed as "KORLÁT ELÉRVE").

There is no schedule and no whole-catalogue mode.

## Who sees it (the pilot list)

| `JEV_PRODUCT_ENRICHMENT` | Who sees the check pages and the menu entry |
| ------------------------ | ------------------------------------------- |
| `off`                    | nobody                                      |
| `benchmark`, `review`    | only the user ids in `JEV_PILOT_USER_IDS`   |
| `production-review`      | everyone with `products.view`               |

- The list is comma-separated user ids. An empty list means nobody.
- Everyone else gets "nem elérhető" from both endpoints and is not served the
  menu entry.
- In production the list is Balázs and Luca, and acrobot sets it.

## The endpoints

- `GET /products/:id/enrichment` (`products.view`) returns the latest
  finished run of the product (`lastRun`, and the fields with value, source,
  URL, read time and accepted evidence).
- `GET /products/enrichment/queue?filter=&cursor=` (`products.view`) returns
  the fields of the latest finished check of every product.
  - Filtered on the server: `all`, `critical`, `conflict`, `missing`,
    `suggestion`, `verified`.
  - 50 per page, with a cursor.
  - A summary gives the count per filter, plus the number of checked
    products.
- The catalogue page (`/products/adatminoseg`) reads the queue.

Both endpoints only read. Neither writes, nor calls anything outside.

## What production needs

- **Migration:** `20261002210000_jev_product_enrichment_first_round` is
  additive. It adds two enums, four tables and the nullable
  `Supplier.websiteUrl`.
- **Environment:** a new variable `JEV_PILOT_USER_IDS`, plus
  `JEV_PRODUCT_ENRICHMENT=review` when the round starts.
- **Outbound network:** the production machine must reach
  `bulkreefsupply.com`, `marine-aquatics.eu` and the manufacturers' and
  suppliers' own sites over HTTPS. The repository has no egress allowlist, so
  whether the server allows this has to be checked on the machine.

## The measurement (open)

The PR has to report, per source and on a 10–20 product trial, how many
product pages were reachable and how many fields came from them. **This has
not been measured.** The build environment's network policy refuses every one
of these hosts (`www.bulkreefsupply.com`, `marine-aquatics.eu`, and the
manufacturer sites tried). Everything above is tested on invented pages only.

The measurement is a `--apply` run of the CLI from a machine that can reach
the hosts, with 10–20 hand-picked products. The CLI prints exactly the
numbers needed: per product, each source's outcome (`FETCHED`, `UNAVAILABLE`
or `REFUSED`, with the reason) and how many fields came from it.
