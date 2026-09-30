import app from "./app";
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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void registerProductionMaxWebhook();
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
