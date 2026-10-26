import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import { callerAddress, IpRateLimiter } from "../common/ip-rate-limit.js";
import {
  ARTICLE_IMAGE_PUBLIC_PATH,
  ArticleImageService,
} from "./article-image.service.js";

/** what the route reads of the request and sets on the answer */
type ImageRequest = Parameters<typeof callerAddress>[0];
interface ImageResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Whether `If-None-Match` names this ETag (a list, or `*`). */
export function etagMatches(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  return value
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .some((part) => part === "*" || part === etag);
}

/**
 * THE ARTICLE IMAGES' PUBLIC ROUTE (acrobot, 2026-10-26, msg 36320). Without a
 * login, because the ReefClub and the web shop visitor's browser loads the
 * image itself. It gives out ONE image file by its id and nothing else: no
 * list, no name, no metadata; an unknown or malformed id is the same 404.
 *
 * THE LOAD IT CAN CAUSE IS BOUNDED (barracuda, #1897 CHANGES): a request
 * never means more than the memory or one row. The caller is limited per
 * address (a page loads a few images, so a generous window disturbs nobody);
 * a conditional request whose ETag (the stored sha256) still holds gets a 304
 * without the bytes; and the bytes come from the service's memory, keyed by
 * id, so a varying query string does not reach Postgres again.
 *
 * The headers say what it is and nothing more: the stored type (only PNG,
 * JPEG or WebP reach the store), `nosniff` so a browser never reads it as
 * anything else, inline, a sandboxing CSP, `Cross-Origin-Resource-Policy:
 * cross-origin` so the ReefClub and the shop (other origins) can show it, and
 * a year's cache, since an id's bytes never change.
 */
@Controller(ARTICLE_IMAGE_PUBLIC_PATH.slice(1))
export class ArticleImagePublicController {
  /** per caller and in all, per minute */
  static readonly reads = new IpRateLimiter(300, 20_000);

  constructor(private readonly images: ArticleImageService) {}

  @Public()
  @Get(":id")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "default-src 'none'; sandbox")
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  async image(
    @Param("id") id: string,
    @Req() request: ImageRequest,
    @Res({ passthrough: true }) response: ImageResponse,
  ): Promise<StreamableFile | undefined> {
    ArticleImagePublicController.reads.check(callerAddress(request));
    const conditional = request.headers["if-none-match"];
    if (conditional) {
      const meta = await this.images.meta(id);
      const etag = `"${meta.sha256}"`;
      if (etagMatches(conditional, etag)) {
        response.setHeader("ETag", etag);
        response.status(304);
        return undefined;
      }
    }
    const image = await this.images.content(id);
    response.setHeader("ETag", `"${image.sha256}"`);
    return new StreamableFile(Buffer.from(image.bytes), {
      type: image.contentType,
      length: image.bytes.byteLength,
      disposition: "inline",
    });
  }
}
