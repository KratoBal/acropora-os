import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isAllowedFullImageSrc, sanitizeRichHtml } from "@acropora/rich-text";
import {
  ARTICLE_LIMITS,
  parseArticleBodyInput,
  type ArticleDetail,
  type ArticleEditorData,
} from "@acropora/types";

import { richTextImageHosts } from "../homepage-content/homepage-content.service.js";
import { ArticleRepository } from "./article.repository.js";

export const ARTICLE_ENVIRONMENT = Symbol("ARTICLE_ENVIRONMENT");

/**
 * THE ARTICLE BODY OF A CONTENT ITEM (acrobot, 2026-10-26, msg 36158). The
 * approval path is the content item's (`ContentService.move`); this service
 * only reads and writes the body, and refuses what the public page could not
 * take: a body outside the `full` profile, an image from a host not on
 * `RICH_TEXT_IMAGE_HOSTS`, a product or a taxon that does not exist.
 */
@Injectable()
export class ArticleService {
  constructor(
    private readonly articles: ArticleRepository,
    @Inject(ARTICLE_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  /** The body, with the image hosts and the taxa its editor may use. */
  async get(contentId: string): Promise<ArticleEditorData> {
    const [article, editable, taxonOptions] = await Promise.all([
      this.articles.detail(contentId),
      this.articles.editable(contentId),
      this.articles.taxonOptions(),
    ]);
    return {
      article,
      editable,
      imageHosts: richTextImageHosts(this.environment),
      taxonOptions,
    };
  }

  async save(
    contentId: string,
    body: unknown,
    userId: string,
  ): Promise<{ article: ArticleDetail | null }> {
    const parsed = parseArticleBodyInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const hosts = richTextImageHosts(this.environment);
    for (const [field, url] of [
      ["coverImageUrl", parsed.value.coverImageUrl],
      ["ogImageUrl", parsed.value.ogImageUrl],
    ] as const)
      if (url && !isAllowedFullImageSrc(url, hosts))
        throw new BadRequestException(
          `${field}: a kép csak a saját tárhelyről jöhet (RICH_TEXT_IMAGE_HOSTS).`,
        );
    const bodyHtml = sanitizeRichHtml(parsed.value.bodyHtml, {
      profile: "full",
      allowedImageHosts: hosts,
    });
    // the limit holds for what is stored, not only for what arrived (#1878)
    if (bodyHtml.length > ARTICLE_LIMITS.bodyHtml)
      throw new BadRequestException(
        `bodyHtml: legfeljebb ${ARTICLE_LIMITS.bodyHtml} karakter a tisztítás után`,
      );
    if (
      (await this.articles.countProducts(parsed.value.productIds)) !==
      parsed.value.productIds.length
    )
      throw new BadRequestException("productIds: egy termék nem létezik.");
    const known = await this.articles.knownTaxonKeys(parsed.value.taxonKeys);
    const unknown = parsed.value.taxonKeys.filter((key) => !known.has(key));
    if (unknown.length)
      throw new BadRequestException(
        `taxonKeys: a szótárban nincs ilyen faj vagy nemzetség: ${unknown.join(", ")}`,
      );

    const outcome = await this.articles.save(
      contentId,
      { ...parsed.value, bodyHtml },
      userId,
    );
    if (outcome === "missing")
      throw new NotFoundException("A tartalom nem található.");
    if (outcome === "not-article")
      throw new ConflictException("Ez a tartalom nem cikk.");
    if (outcome === "not-editable")
      throw new ConflictException(
        "A cikk jóváhagyásra vár vagy már jóvá van hagyva: a szöveg csak javításra visszaküldve módosítható.",
      );
    if (outcome === "slug-taken")
      throw new ConflictException("Ez a webcím (slug) már egy másik cikké.");
    return this.get(contentId);
  }
}
