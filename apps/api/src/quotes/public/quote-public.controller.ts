import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
} from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { callerAddress, IpRateLimiter } from "../../common/ip-rate-limit.js";

/** what the limiter reads of the request */
type CallerRequest = Parameters<typeof callerAddress>[0];
import { PublicQuoteAcceptDto } from "./quote-public.dto.js";
import { QuotePublicService } from "./quote-public.service.js";

/**
 * THE PUBLIC ACCEPTANCE LINK'S ENDPOINTS (#1582 P4b), without a login. Each
 * is rate-limited per caller and in total; the accept more tightly, since it
 * writes.
 */
@Controller("public/quotes")
export class QuotePublicController {
  /** reads: a page and its PDF, a few times over */
  static readonly reads = new IpRateLimiter(30, 600);
  /** the yes: a handful of tries */
  static readonly accepts = new IpRateLimiter(5, 100);

  constructor(private readonly service: QuotePublicService) {}

  @Public()
  @Get(":token")
  @Header("Cache-Control", "private, no-store")
  view(@Param("token") token: string, @Req() request: CallerRequest) {
    QuotePublicController.reads.check(callerAddress(request));
    return this.service.view(token);
  }

  @Public()
  @Get(":token/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("token") token: string, @Req() request: CallerRequest) {
    QuotePublicController.reads.check(callerAddress(request));
    const { bytes, fileName } = await this.service.pdf(token);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Public()
  @Post(":token/accept")
  @HttpCode(200)
  accept(
    @Param("token") token: string,
    @Body() input: PublicQuoteAcceptDto,
    @Req() request: CallerRequest,
  ) {
    QuotePublicController.accepts.check(callerAddress(request));
    return this.service.accept(token, input);
  }
}
