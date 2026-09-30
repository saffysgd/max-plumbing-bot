const MAX_API_BASE_URL = "https://platform-api2.max.ru";

export interface MaxPeer {
  chatId?: string;
  userId?: string;
}

export interface MaxButton {
  type: "callback" | "request_contact";
  text: string;
  payload?: string;
}

export type MaxButtonRows = MaxButton[][];

function getBotToken(): string {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) {
    throw new Error("MAX_BOT_TOKEN is not configured.");
  }
  return token;
}

async function maxRequest(
  path: string,
  options: {
    method: "GET" | "POST";
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<Record<string, unknown>> {
  const url = new URL(path, MAX_API_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: getBotToken(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    throw new Error(`MAX API request failed with status ${response.status}.`);
  }

  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("MAX API returned an invalid response.");
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("MAX API returned an unexpected response.");
  }

  const resultObject = result as Record<string, unknown>;
  if (resultObject.success === false) {
    throw new Error("MAX API rejected the request.");
  }
  return resultObject;
}

function peerQuery(peer: MaxPeer): Record<string, string> {
  if (peer.chatId) {
    return { chat_id: peer.chatId };
  }
  if (peer.userId) {
    return { user_id: peer.userId };
  }
  throw new Error("MAX conversation target is missing.");
}

function keyboardAttachment(rows: MaxButtonRows): Record<string, unknown> {
  return {
    type: "inline_keyboard",
    payload: {
      buttons: rows.map((row) =>
        row.map((button) => ({
          type: button.type,
          text: button.text,
          ...(button.payload ? { payload: button.payload } : {}),
        })),
      ),
    },
  };
}

export async function sendMaxMessage(
  peer: MaxPeer,
  text: string,
  buttons?: MaxButtonRows,
): Promise<void> {
  await maxRequest("/messages", {
    method: "POST",
    query: peerQuery(peer),
    body: {
      text,
      ...(buttons?.length
        ? { attachments: [keyboardAttachment(buttons)] }
        : {}),
    },
  });
}

export async function acknowledgeMaxCallback(
  callbackId: string,
): Promise<void> {
  await maxRequest("/answers", {
    method: "POST",
    query: { callback_id: callbackId },
    body: {},
  });
}

export async function registerMaxWebhook(
  url: string,
  secret: string,
): Promise<void> {
  await maxRequest("/subscriptions", {
    method: "POST",
    body: {
      url,
      update_types: ["message_created", "message_callback", "bot_started"],
      secret,
    },
  });
}