import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  getMaxWebhookUrl,
  getMaxWebhookSecret,
  handleMaxUpdate,
  type MaxUpdate,
} from "../lib/plumber-bot";

const router: IRouter = Router();

function secretsMatch(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer);
}

router.get("/max/status", (_req, res) => {
  res.json({
    botTokenConfigured: Boolean(process.env.MAX_BOT_TOKEN),
    adminRecipientConfigured: Boolean(process.env.MAX_ADMIN_USER_ID?.trim()),
    webhookReady:
      process.env.NODE_ENV === "production" &&
      Boolean(process.env.MAX_BOT_TOKEN) &&
      Boolean(getMaxWebhookUrl()),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
});

router.post("/max/webhook", async (req, res) => {
  let webhookSecret: string;
  try {
    webhookSecret = await getMaxWebhookSecret();
  } catch {
    res.status(503).json({ error: "MAX bot is not configured." });
    return;
  }

  if (
    !secretsMatch(
      webhookSecret,
      req.header("X-Max-Bot-Api-Secret"),
    )
  ) {
    res.status(401).json({ error: "Invalid webhook secret." });
    return;
  }

  const update = req.body as MaxUpdate;
  try {
    await handleMaxUpdate(update, req.log);
    res.sendStatus(200);
  } catch (error) {
    req.log.error(
      { err: error, updateType: update?.update_type },
      "MAX bot update failed",
    );
    res.status(500).json({ error: "Could not process MAX update." });
  }
});

export default router;