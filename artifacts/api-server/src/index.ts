import app from "./app";
import { ensureDatabaseSchema, pool } from "@workspace/db";
import { logger } from "./lib/logger";
import {
  getMaxWebhookSecret,
  getMaxWebhookUrl,
  shouldRegisterMaxWebhook,
} from "./lib/plumber-bot";
import { registerMaxWebhook } from "./lib/max-api";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await ensureDatabaseSchema();
  logger.info("PostgreSQL schema is ready");

  const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");

    void registerProductionMaxWebhook();
  });

  server.on("error", (error) => {
    logger.error({ err: error }, "Error listening on port");
    void pool
      .end()
      .catch(() => undefined)
      .finally(() => process.exit(1));
  });
}

void startServer().catch(async (error: unknown) => {
  logger.error({ err: error }, "Could not initialize PostgreSQL schema");
  await pool.end().catch(() => undefined);
  process.exit(1);
});

async function registerProductionMaxWebhook(): Promise<void> {
  if (!shouldRegisterMaxWebhook()) {
    return;
  }

  const url = getMaxWebhookUrl();
  if (!url) {
    logger.error(
      "MAX_BOT_TOKEN is configured in production, but REPLIT_DOMAINS is missing; MAX webhook was not registered.",
    );
    return;
  }

  try {
    await registerMaxWebhook(url, await getMaxWebhookSecret());
    logger.info({ url }, "MAX webhook registered");
  } catch (error) {
    logger.error({ err: error }, "Could not register MAX webhook");
  }
}
