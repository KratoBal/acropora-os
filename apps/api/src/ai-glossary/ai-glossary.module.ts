import { Module } from "@nestjs/common";

import { AiGlossaryController } from "./ai-glossary.controller.js";
import { aiGlossaryClientFromEnv } from "./ai-glossary.client.js";
import {
  AI_GLOSSARY_CLIENT,
  AI_GLOSSARY_ENVIRONMENT,
  AI_GLOSSARY_USER_NAMES,
  AiGlossaryService,
  databaseUserNames,
  type AiGlossaryClientFactory,
} from "./ai-glossary.service.js";

/** The AI configuration (`ACROPORA_AI_BASE_URL`, `ACROPORA_AI_ACCESS_TOKEN`) is read per call, as the other AI clients do. */
const clientFactory: AiGlossaryClientFactory = () =>
  aiGlossaryClientFromEnv(process.env);

@Module({
  controllers: [AiGlossaryController],
  providers: [
    AiGlossaryService,
    { provide: AI_GLOSSARY_CLIENT, useValue: clientFactory },
    { provide: AI_GLOSSARY_ENVIRONMENT, useFactory: () => process.env },
    { provide: AI_GLOSSARY_USER_NAMES, useValue: databaseUserNames },
  ],
})
export class AiGlossaryModule {}
