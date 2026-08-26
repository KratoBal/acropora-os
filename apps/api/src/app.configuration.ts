import { ValidationPipe, type INestApplication } from "@nestjs/common";

import { applyHttpTimeouts } from "./http-timeouts.js";

/**
 * Everything the running API is configured with, in one callable place.
 *
 * Split out of `bootstrap` so a test can apply it to a real application and
 * read the result back. It is not tidiness: configuration that only exists
 * inside an entry point is configuration nothing can check, and a setting that
 * is written and never applied leaves every test green while the process runs
 * on the default. That shape has cost this codebase two defects already.
 */
export function configureApp(app: INestApplication): void {
  app.enableCors({ origin: process.env.WEB_URL ?? "http://localhost:3000" });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Let Nest forward SIGTERM/SIGINT into onModuleDestroy/beforeApplicationShutdown
  // hooks (Prisma disconnect, in-flight scheduler timers, etc.) instead of the
  // process being hard-killed mid-request during a Coolify rolling restart.
  app.enableShutdownHooks();

  /**
   * The server has to outlast the proxy in front of it.
   *
   * Node closes an idle keep-alive connection after five seconds while the
   * proxy holds its pooled ones for far longer, so the two disagree about when
   * a socket is dead. When the proxy reuses one the server is closing in the
   * same instant, the request dies with a connection reset - rare, never
   * reproducible on demand, and looking like a fault in whichever endpoint was
   * unlucky. See http-timeouts.ts for the ordering and the numbers.
   */
  applyHttpTimeouts(app.getHttpServer());
}
