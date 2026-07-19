import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_URL ?? "http://localhost:3000" });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Acropora API: http://localhost:${port}`);
}

void bootstrap();
