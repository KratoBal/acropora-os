import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { configureApp } from "./app.configuration.js";

/**
 * The entry point, and deliberately nothing else.
 *
 * Everything it configures lives in `app.configuration.ts`, because importing
 * this file starts a server: a test that wanted to check the configuration
 * would have booted the API as a side effect of the import. Keeping the entry
 * point down to "build, configure, listen" is what makes the configuration
 * reachable from a test at all.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Acropora API: http://localhost:${port}`);
}

void bootstrap();
