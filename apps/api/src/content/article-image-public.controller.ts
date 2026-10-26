import { Controller, Get, Header, Param, StreamableFile } from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import {
  ARTICLE_IMAGE_PUBLIC_PATH,
  ArticleImageService,
} from "./article-image.service.js";

/**
 * THE ARTICLE IMAGES' PUBLIC ROUTE (acrobot, 2026-10-26, msg 36320). Without a
 * login, because the ReefClub and the web shop visitor's browser loads the
 * image itself. It gives out ONE image file by its id and nothing else: no
 * list, no name, no metadata; an unknown or malformed id is the same 404.
 *
 * The headers say what it is and nothing more: the stored type (only PNG,
 * JPEG or WebP reach the store), `nosniff` so a browser never reads it as
 * anything else, inline, and a year's cache, since an id's bytes never change.
 */
@Controller(ARTICLE_IMAGE_PUBLIC_PATH.slice(1))
export class ArticleImagePublicController {
  constructor(private readonly images: ArticleImageService) {}

  @Public()
  @Get(":id")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "default-src 'none'; sandbox")
  async image(@Param("id") id: string) {
    const image = await this.images.content(id);
    return new StreamableFile(Buffer.from(image.bytes), {
      type: image.contentType,
      length: image.bytes.byteLength,
      disposition: "inline",
    });
  }
}
