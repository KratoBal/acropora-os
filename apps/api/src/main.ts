import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Acropora API: http://localhost:${port}`);
}

void bootstrap();
