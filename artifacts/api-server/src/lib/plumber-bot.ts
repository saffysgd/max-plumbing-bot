import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import {
  botSessionsTable,
  db,
  plumberApplicationsTable,
} from "@workspace/db";
import {
  acknowledgeMaxCallback,
  sendMaxMessage,
  type MaxButton,
  type MaxButtonRows,
  type MaxPeer,
} from "./max-api";

type BotStep =
  | "urgency"
  | "service"
  | "material"
  | "pressure"
  | "description"
  | "phone"
  | "submitted";
type Urgency = "today" | "planned";

interface SessionState {
  [key: string]: unknown;
  urgency?: Urgency;
  service?: string;
  pipeMaterial?: string;
  connectionType?: string;
  pressureTest?: boolean;
  description?: string;
  phone?: string;
  applicationId?: number;
  status?: string;
  attachments?: unknown[];
  emergencyPhotoHint?: boolean;
}

interface MaxUser {
  user_id?: number | string;
  first_name?: string;
  name?: string;
  phone?: string;
  phone_number?: string;
}

interface MaxMessage {
  sender?: MaxUser;
  recipient?: {
    chat_id?: number | string;
    user_id?: number | string;
  };
  body?: {
    text?: string;
    attachments?: unknown[];
  };
}

interface MaxCallback {
  callback_id?: string;
  payload?: string;
  user?: MaxUser;
  message?: MaxMessage;
}

export interface MaxUpdate {
  update_type?: string;
  timestamp?: number;
  chat_id?: number | string;
  user?: MaxUser;
  message?: MaxMessage;
  callback?: MaxCallback;
}

interface Conversation {
  peer: MaxPeer;
  peerId: string;
  userId: string;
  userName?: string;
}

interface ServiceOption {
  id: string;
  label: string;
}

function callbackButton(text: string, payload: string): MaxButton {
  return { type: "callback", text, payload };
}

function materialButtons(): MaxButtonRows {
  return [
    [callbackButton("Стальные трубы — электродуговая сварка", "material:steel")],
    [callbackButton("Полипропилен — пайка", "material:polypropylene")],
    [
      callbackButton(
        "Металлопластик / другие — сборка обвязки",
        "material:metal-plastic",
      ),
    ],
    [callbackButton("Отмена", "apply:cancel")],
  ];
}

function pressureButtons(): MaxButtonRows {
  return [
    [
      callbackButton("Да", "pressure:yes"),
      callbackButton("Нет", "pressure:no"),
    ],
    [callbackButton("Отмена", "apply:cancel")],
  ];
}

const services: ServiceOption[] = [
  { id: "water-full", label: "Монтаж водоснабжения под ключ" },
  { id: "water-systems", label: "Монтаж систем водоснабжения" },
  { id: "plumbing-pipes", label: "Монтаж сантехнических труб" },
  { id: "move-water", label: "Перенос труб ХВС и ГВС" },
  { id: "water-connection", label: "Подвод к водопроводной сети" },
  { id: "riser-inset", label: "Врезка в стояк" },
  { id: "water-removal", label: "Демонтаж систем водоснабжения" },
  { id: "storm-drain", label: "Монтаж ливневой канализации" },
  { id: "heating-full", label: "Монтаж отопления под ключ" },
  { id: "heating-systems", label: "Монтаж систем отопления" },
  { id: "heating-pipes", label: "Монтаж труб отопления" },
  { id: "heating-pipes-removal", label: "Демонтаж труб отопления" },
  { id: "radiator-install", label: "Установка радиатора отопления" },
  { id: "radiator-replace", label: "Замена радиатора отопления" },
  { id: "radiator-removal", label: "Демонтаж радиаторов отопления" },
  { id: "radiator-repair", label: "Ремонт радиатора отопления" },
];

const priceMessage = [
  "Услуги и цены",
  "",
  "Блок 1 — базовые расценки",
  ...services.map((service) => {
    const price = service.id === "radiator-repair" ? "500 ₽" : "1 000 ₽";
    return `• ${service.label} — ${price}`;
  }),
  "",
  "Блок 2 — ключевые услуги",
  "• Сварка стояков отопления и водоснабжения: стальные трубы, электродуговая сварка. Добиваемся ровных швов и герметичных соединений без протечек.",
  "• Замена старых стальных труб на полипропилен или металлопластик: пайка, монтаж и сборка обвязки.",
  "• Врезка в действующие системы отопления, ХВС и ГВС; монтаж разводки по квартире или дому.",
  "• Установка радиаторов, полотенцесушителей и коллекторов.",
  "• Подготовка и опрессовка систем, поиск и устранение течей.",
].join("\n");

const howWeWorkMessage = [
  "Как мы работаем",
  "",
  "Согласуем задачу и материалы, выполняем монтаж, подготовку и проверку системы. Соблюдаем требования СНиП (СП) и управляющей компании.",
  "Предоставляем гарантию на выполненные работы.",
  "Выезжаем в экстренных ситуациях — при авариях и прорывах.",
  "Работаем с физическими лицами и организациями: УК, ТСЖ и подрядчиками.",
  "Зона обслуживания: Новосибирск и ближайшие районы.",
].join("\n");

const faqItems = [
  {
    id: "materials",
    question: "Какие материалы и методы используете?",
    answer:
      "Стальные трубы (сварка), полипропилен (пайка), металлопластик (обвязка). Подбираем под требования УК и бюджет.",
  },
  {
    id: "pressure",
    question: "Делаете ли опрессовку и проверку на течи?",
    answer:
      "Да, подготовка и опрессовка систем, поиск и устранение течей входят в комплекс работ.",
  },
  {
    id: "emergency",
    question: "Работаете ли в аварийных случаях?",
    answer:
      "Да, возможен срочный выезд при прорыве, течи и других ЧП.",
  },
  {
    id: "warranty",
    question: "Даёте ли гарантию?",
    answer: "Да, предоставляем гарантию на выполненные работы.",
  },
];

const descriptionHint =
  "Укажите материал труб, тип соединения (сварка/пайка/фитинги), количество стояков, точек подключения, метраж разводки — это нужно для точного расчёта.";

function mainMenuButtons(): MaxButtonRows {
  return [
    [
      callbackButton("Услуги и цены", "menu:prices"),
      callbackButton("Оставить заявку", "menu:apply"),
    ],
    [
      callbackButton("Аварийный выезд", "menu:emergency"),
      callbackButton("Как мы работаем", "menu:how"),
    ],
    [callbackButton("FAQ", "menu:faq")],
  ];
}

async function sendMainMenu(peer: MaxPeer): Promise<void> {
  await sendMaxMessage(
    peer,
    "Здравствуйте! Я помогу выбрать сантехническую услугу и оставить заявку. Выберите раздел:",
    mainMenuButtons(),
  );
}

function conversationFromUpdate(update: MaxUpdate): Conversation | undefined {
  const message = update.message ?? update.callback?.message;
  const sender = message?.sender ?? update.callback?.user ?? update.user;
  const userIdValue = sender?.user_id ?? message?.recipient?.user_id;
  const chatIdValue = message?.recipient?.chat_id ?? update.chat_id;
  const userId = userIdValue === undefined ? undefined : String(userIdValue);
  const chatId = chatIdValue === undefined ? undefined : String(chatIdValue);
  const peer: MaxPeer = chatId ? { chatId } : userId ? { userId } : {};
  const peerId = peer.chatId ?? peer.userId;

  if (!peerId || !userId) {
    return undefined;
  }

  const userName = sender?.first_name ?? sender?.name;
  return {
    peer,
    peerId,
    userId,
    ...(userName ? { userName } : {}),
  };
}

async function getSession(peerId: string) {
  const [session] = await db
    .select()
    .from(botSessionsTable)
    .where(eq(botSessionsTable.peerId, peerId))
    .limit(1);
  return session;
}

async function saveSession(
  conversation: Conversation,
  step: BotStep,
  state: SessionState,
): Promise<void> {
  await db
    .insert(botSessionsTable)
    .values({
      peerId: conversation.peerId,
      platformUserId: conversation.userId,
      step,
      state,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botSessionsTable.peerId,
      set: {
        platformUserId: conversation.userId,
        step,
        state,
        updatedAt: new Date(),
      },
    });
}

async function deleteSession(peerId: string): Promise<void> {
  await db
    .delete(botSessionsTable)
    .where(eq(botSessionsTable.peerId, peerId));
}

function serviceButtons(): MaxButtonRows {
  const rows: MaxButtonRows = [];
  for (let i = 0; i < services.length; i += 2) {
    rows.push(
      services.slice(i, i + 2).map((service) =>
        callbackButton(service.label, `service:${service.id}`),
      ),
    );
  }
  rows.push([callbackButton("Отмена", "apply:cancel")]);
  return rows;
}

async function startApplication(
  conversation: Conversation,
  emergency = false,
): Promise<void> {
  if (emergency) {
    await saveSession(conversation, "service", {
      urgency: "today",
      emergencyPhotoHint: true,
      attachments: [],
    });
    await sendMaxMessage(
      conversation.peer,
      "Срочность установлена: «Срочно (сегодня)».\nПриложите фото места аварии в чат, затем выберите услугу:",
      serviceButtons(),
    );
    return;
  }

  await saveSession(conversation, "urgency", { attachments: [] });
  await sendMaxMessage(conversation.peer, "Когда требуется выезд?", [
    [
      callbackButton("Срочно (сегодня)", "urgency:today"),
      callbackButton("Планово", "urgency:planned"),
    ],
    [callbackButton("Отмена", "apply:cancel")],
  ]);
}

async function askForMaterial(
  conversation: Conversation,
  urgency: Urgency,
  service: string,
  state: SessionState,
): Promise<void> {
  await saveSession(conversation, "material", {
    ...state,
    urgency,
    service,
  });
  await sendMaxMessage(
    conversation.peer,
    "Выберите материал труб и тип работ:",
    materialButtons(),
  );
}

async function askForDescription(
  conversation: Conversation,
  state: SessionState,
): Promise<void> {
  await saveSession(conversation, "description", state);
  await sendMaxMessage(
    conversation.peer,
    `Опишите объём работ.\n${descriptionHint}`,
    [[callbackButton("Отмена", "apply:cancel")]],
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getMessageAttachments(message: MaxMessage | undefined): unknown[] {
  const attachments = message?.body?.attachments;
  return Array.isArray(attachments) ? attachments.slice(0, 10) : [];
}

function getMediaAttachments(attachments: unknown[]): unknown[] {
  return attachments.filter((attachment) => {
    const record = readRecord(attachment);
    const type = record?.type;
    return type === "image" || type === "video" || type === "file";
  });
}

function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? trimmed : undefined;
}

function findPhone(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPhone(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key === "phone" || key === "phone_number" || key === "phoneNumber") {
      const found = normalizePhone(nested);
      if (found) {
        return found;
      }
    }
  }
  for (const nested of Object.values(record)) {
    const found = findPhone(nested, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function emergencyStatus(urgency: Urgency | undefined, description: string): string {
  const emergencyMention =
    /прорыв|протечк|теч(?:ь|и|ет|ёт|ут)|затоп|авари/i.test(description);
  return urgency === "today" && emergencyMention ? "аварийная" : "новая";
}

async function finishApplication(
  conversation: Conversation,
  state: SessionState,
  phone: string,
): Promise<void> {
  if (
    !state.urgency ||
    !state.service ||
    !state.pipeMaterial ||
    !state.connectionType ||
    state.pressureTest === undefined ||
    !state.description
  ) {
    await deleteSession(conversation.peerId);
    await sendMaxMessage(
      conversation.peer,
      "Не удалось завершить заявку из-за неполных данных. Начните заново через «Оставить заявку».",
      mainMenuButtons(),
    );
    return;
  }

  const status = emergencyStatus(state.urgency, state.description);
  const application = await db.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(plumberApplicationsTable)
      .values({
        peerId: conversation.peerId,
        platformUserId: conversation.userId,
        customerName: conversation.userName ?? null,
        phone,
        service: state.service!,
        urgency: state.urgency!,
        pipeMaterial: state.pipeMaterial!,
        connectionType: state.connectionType!,
        pressureTest: state.pressureTest!,
        description: state.description!,
        status,
        attachments: state.attachments ?? [],
      })
      .returning({ id: plumberApplicationsTable.id });

    await transaction
      .update(botSessionsTable)
      .set({
        step: "submitted",
        state: {
          ...state,
          phone,
          applicationId: created.id,
          status,
        },
        updatedAt: new Date(),
      })
      .where(eq(botSessionsTable.peerId, conversation.peerId));

    return created;
  });

  await sendApplicationConfirmation(conversation, application.id);
  await deleteSession(conversation.peerId);
}

async function sendApplicationConfirmation(
  conversation: Conversation,
  applicationId: number,
): Promise<void> {
  const requestNumber = String(applicationId).padStart(4, "0");
  await sendMaxMessage(
    conversation.peer,
    `Ваша заявка принята. Мы свяжемся с вами в течение 1 часа. Если это аварийная ситуация (прорыв, течь) — мастер приедет в течение 2 часов. Номер заявки: #${requestNumber}`,
    mainMenuButtons(),
  );
}

async function continueApplication(
  conversation: Conversation,
  step: BotStep,
  state: SessionState,
  messageText: string,
  attachments: unknown[],
): Promise<void> {
  const media = getMediaAttachments(attachments);
  if (media.length) {
    state.attachments = [...(state.attachments ?? []), ...media].slice(-10);
    await saveSession(conversation, step, state);
  }

  switch (step) {
    case "urgency":
      await sendMaxMessage(conversation.peer, "Выберите срочность кнопкой выше.");
      return;
    case "service":
      await sendMaxMessage(
        conversation.peer,
        media.length
          ? "Фото получено. Теперь выберите услугу:"
          : "Выберите услугу кнопкой:",
        serviceButtons(),
      );
      return;
    case "material":
      await sendMaxMessage(
        conversation.peer,
        "Выберите материал труб и тип работ кнопкой.",
        materialButtons(),
      );
      return;
    case "pressure":
      await sendMaxMessage(
        conversation.peer,
        "Нужна ли подготовка и опрессовка с проверкой на течи?",
        pressureButtons(),
      );
      return;
    case "description":
      if (!messageText.trim()) {
        await sendMaxMessage(
          conversation.peer,
          media.length
            ? "Фото получено. Добавьте текстовое описание работ."
            : `Добавьте текстовое описание.\n${descriptionHint}`,
        );
        return;
      }
      state.description = messageText.trim().slice(0, 3000);
      await saveSession(conversation, "phone", state);
      await sendMaxMessage(
        conversation.peer,
        "Укажите номер телефона для связи или отправьте контакт кнопкой:",
        [[
          { type: "request_contact", text: "Поделиться номером телефона" },
        ]],
      );
      return;
    case "phone": {
      const phone =
        findPhone(attachments) ?? normalizePhone(messageText);
      if (!phone) {
        await sendMaxMessage(
          conversation.peer,
          "Не получилось распознать номер. Отправьте номер телефона текстом или поделитесь контактом.",
          [[
            { type: "request_contact", text: "Поделиться номером телефона" },
          ]],
        );
        return;
      }
      await finishApplication(conversation, state, phone);
      return;
    }
    case "submitted":
      if (state.applicationId) {
        await sendApplicationConfirmation(
          conversation,
          state.applicationId,
        );
        await deleteSession(conversation.peerId);
      }
      return;
  }
}

function buttonsForFaq(): MaxButtonRows {
  return [
    ...faqItems.map((item) => [
      callbackButton(item.question, `faq:${item.id}`),
    ]),
    [callbackButton("В главное меню", "menu:home")],
  ];
}

async function processCallback(
  conversation: Conversation,
  payload: string,
): Promise<void> {
  if (payload === "menu:home") {
    await sendMainMenu(conversation.peer);
    return;
  }
  if (payload === "menu:prices") {
    await sendMaxMessage(
      conversation.peer,
      priceMessage,
      [[callbackButton("В главное меню", "menu:home")]],
    );
    return;
  }
  if (payload === "menu:how") {
    await sendMaxMessage(
      conversation.peer,
      howWeWorkMessage,
      [[callbackButton("В главное меню", "menu:home")]],
    );
    return;
  }
  if (payload === "menu:faq") {
    await sendMaxMessage(
      conversation.peer,
      "Выберите вопрос:",
      buttonsForFaq(),
    );
    return;
  }
  if (payload === "menu:apply") {
    await startApplication(conversation);
    return;
  }
  if (payload === "menu:emergency") {
    await startApplication(conversation, true);
    return;
  }
  if (payload === "apply:cancel") {
    await deleteSession(conversation.peerId);
    await sendMaxMessage(
      conversation.peer,
      "Заявка отменена.",
      mainMenuButtons(),
    );
    return;
  }
  if (payload.startsWith("faq:")) {
    const faq = faqItems.find((item) => item.id === payload.slice(4));
    if (faq) {
      await sendMaxMessage(
        conversation.peer,
        `${faq.question}\n\n${faq.answer}`,
        [[callbackButton("К другим вопросам", "menu:faq")]],
      );
    }
    return;
  }

  const session = await getSession(conversation.peerId);
  if (!session) {
    await sendMaxMessage(
      conversation.peer,
      "Начните оформление через «Оставить заявку».",
      mainMenuButtons(),
    );
    return;
  }
  const state = session.state as SessionState;

  if (payload.startsWith("urgency:") && session.step === "urgency") {
    const urgency = payload.slice(8);
    if (urgency !== "today" && urgency !== "planned") {
      return;
    }
    const message =
      urgency === "today"
        ? "Срочность: «Срочно (сегодня)»."
        : "Срочность: плановая.";
    const buttons = serviceButtons();
    await saveSession(conversation, "service", {
      ...state,
      urgency,
    });
    await sendMaxMessage(
      conversation.peer,
      `${message}\nКакую работу нужно выполнить?`,
      buttons,
    );
    return;
  }

  if (payload.startsWith("service:") && session.step === "service") {
    const service = services.find(
      (option) => option.id === payload.slice("service:".length),
    );
    if (!service || !state.urgency) {
      return;
    }
    await askForMaterial(
      conversation,
      state.urgency,
      service.label,
      state,
    );
    return;
  }

  if (payload.startsWith("material:") && session.step === "material") {
    const materialChoice = payload.slice("material:".length);
    const values: Record<
      string,
      { pipeMaterial: string; connectionType: string }
    > = {
      steel: { pipeMaterial: "стальные", connectionType: "сварка" },
      polypropylene: {
        pipeMaterial: "полипропилен",
        connectionType: "пайка",
      },
      "metal-plastic": {
        pipeMaterial: "металлопластик/другие трубопроводы",
        connectionType: "фитинги (сборка обвязки)",
      },
    };
    const selected = values[materialChoice];
    if (!selected) {
      return;
    }
    const nextState: SessionState = {
      ...state,
      ...selected,
    };
    await saveSession(conversation, "pressure", nextState);
    await sendMaxMessage(
      conversation.peer,
      "Нужна ли подготовка и опрессовка с проверкой на течи?",
      pressureButtons(),
    );
    return;
  }

  if (payload.startsWith("pressure:") && session.step === "pressure") {
    const choice = payload.slice("pressure:".length);
    if (choice !== "yes" && choice !== "no") {
      return;
    }
    await askForDescription(conversation, {
      ...state,
      pressureTest: choice === "yes",
    });
  }
}

function textCommand(text: string): string | undefined {
  const normalized = text.trim().toLocaleLowerCase("ru");
  if (normalized === "/start" || normalized === "старт" || normalized === "меню") {
    return "menu:home";
  }
  if (
    normalized === "услуги и цены" ||
    normalized === "цены"
  ) {
    return "menu:prices";
  }
  if (
    normalized === "оставить заявку" ||
    normalized === "заявка"
  ) {
    return "menu:apply";
  }
  if (normalized === "аварийный выезд" || normalized === "авария") {
    return "menu:emergency";
  }
  if (normalized === "как мы работаем") {
    return "menu:how";
  }
  if (normalized === "faq" || normalized === "вопросы") {
    return "menu:faq";
  }
  if (normalized === "/cancel" || normalized === "отмена") {
    return "apply:cancel";
  }
  return undefined;
}

export async function handleMaxUpdate(
  update: MaxUpdate,
  log: Logger,
): Promise<void> {
  const conversation = conversationFromUpdate(update);
  if (!conversation) {
    log.warn({ updateType: update.update_type }, "MAX update has no conversation target");
    return;
  }

  const callbackId = update.callback?.callback_id;
  if (callbackId) {
    try {
      await acknowledgeMaxCallback(callbackId);
    } catch (error) {
      log.warn({ err: error }, "Could not acknowledge MAX callback");
    }
  }

  if (update.update_type === "bot_started") {
    await sendMainMenu(conversation.peer);
    return;
  }

  if (update.update_type === "message_callback") {
    const payload = update.callback?.payload;
    if (typeof payload === "string" && payload) {
      await processCallback(conversation, payload);
    }
    return;
  }

  if (update.update_type !== "message_created") {
    return;
  }

  const messageText = update.message?.body?.text ?? "";
  const command = textCommand(messageText);
  if (command) {
    await processCallback(conversation, command);
    return;
  }

  const session = await getSession(conversation.peerId);
  if (!session) {
    await sendMainMenu(conversation.peer);
    return;
  }

  await continueApplication(
    conversation,
    session.step as BotStep,
    session.state as SessionState,
    messageText,
    getMessageAttachments(update.message),
  );
}

export function getMaxWebhookSecret(): string {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) {
    throw new Error("MAX_BOT_TOKEN is not configured.");
  }
  return createHmac("sha256", token)
    .update("replit-max-webhook-secret-v1")
    .digest("hex");
}

export function shouldRegisterMaxWebhook(): boolean {
  return process.env.NODE_ENV === "production" && Boolean(process.env.MAX_BOT_TOKEN);
}

export function getMaxWebhookUrl(): string | undefined {
  const configuredUrl = process.env.MAX_WEBHOOK_URL;
  if (configuredUrl) {
    return configuredUrl;
  }
  const domains = process.env.REPLIT_DOMAINS;
  const domain = domains
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return domain ? `https://${domain}/api/max/webhook` : undefined;
}