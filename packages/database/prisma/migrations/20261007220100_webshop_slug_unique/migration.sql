-- SEO P0 PR 5: a webshop-slug egyedisege. Reszleges egyedi index, mert a mai UNAS
-- csatorna-sorok `slug` mezoje (a UNAS SefUrl) nem tartozik ide, es ott a ket csatorna
-- ugyanazt a szot is viselheti. A Prisma semaban nem leirhato.

CREATE UNIQUE INDEX "ChannelListing_webshop_slug_key" ON "ChannelListing"("slug") WHERE "channel" = 'WEBSHOP';
