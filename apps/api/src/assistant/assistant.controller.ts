import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  HttpException,
  Header,
  HttpCode,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { once } from "node:events";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { AssistantAskDto } from "./assistant.dto.js";
import {
  AssistantService,
  ASSISTANT_ERROR,
  ASSISTANT_GATEWAY_TIMEOUT_MS,
} from "./assistant.service.js";
@Controller("assistant")
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Get("config")
  @Header("Cache-Control", "no-store")
  config(@Req() request: AuthenticatedRequest) {
    return {
      enabled:
        !!request.user &&
        this.assistant.available(request.user, request.sessionKind),
    };
  }
  @Post("ask")
  @HttpCode(200)
  async ask(
    @Req() request: AuthenticatedRequest,
    @Body() input: AssistantAskDto,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const disconnected = new AbortController();
    const signal = AbortSignal.any([
      disconnected.signal,
      AbortSignal.timeout(ASSISTANT_GATEWAY_TIMEOUT_MS),
    ]);
    const close = () => disconnected.abort();
    response.once("close", close);
    const headers = () => {
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
      response.setHeader("X-Accel-Buffering", "no");
      response.setHeader("Content-Encoding", "identity");
      response.flushHeaders();
    };
    const error = () => {
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) headers();
      response.end(
        JSON.stringify({ type: "error", message: ASSISTANT_ERROR }) + "\n",
      );
    };
    try {
      const upstream = await this.assistant.ask(
        request.user!,
        request.sessionKind,
        input,
        signal,
      );
      if (!upstream.ok) {
        await upstream.body?.cancel();
        // A foreign thread is distinguished so the panel can retry once without it.
        if (upstream.status === 403 && input.threadId)
          response.statusCode = 403;
        else if (upstream.status === 409 || upstream.status === 400)
          response.statusCode = upstream.status;
        error();
        return;
      }
      if (
        !upstream.body ||
        !upstream.headers.get("content-type")?.includes("application/x-ndjson")
      ) {
        await upstream.body?.cancel();
        error();
        return;
      }
      headers();
      const reader = upstream.body.getReader();
      let received = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          received ||= value.length > 0;
          if (!response.write(value)) await once(response, "drain", { signal });
        }
        if (received) response.end();
        else error();
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (cause) {
      if (cause instanceof HttpException && !response.headersSent) throw cause;
      if (!disconnected.signal.aborted) error();
    } finally {
      response.off("close", close);
    }
  }
}
