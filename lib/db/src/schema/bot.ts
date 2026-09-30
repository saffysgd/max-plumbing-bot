import {
  boolean,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const botSessionsTable = pgTable("bot_sessions", {
  peerId: text("peer_id").primaryKey(),
  platformUserId: text("platform_user_id").notNull(),
  step: text("step").notNull(),
  state: jsonb("state")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const plumberApplicationsTable = pgTable("plumber_applications", {
  id: serial("id").primaryKey(),
  peerId: text("peer_id").notNull(),
  platformUserId: text("platform_user_id").notNull(),
  customerName: text("customer_name"),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  urgency: text("urgency").notNull(),
  pipeMaterial: text("pipe_material").notNull(),
  connectionType: text("connection_type").notNull(),
  pressureTest: boolean("pressure_test").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
  attachments: jsonb("attachments")
    .$type<unknown[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BotSession = typeof botSessionsTable.$inferSelect;
export type PlumberApplication = typeof plumberApplicationsTable.$inferSelect;