/**
 * Schéma Drizzle — Skema.
 *
 * Les 6 tables d'origine (`Architecture PWA Révision Vidéo IA.md`) avec les
 * corrections du plan (phase 0, point 3), les tables Better Auth et `ai_usage`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth (noms de modèles attendus par l'adaptateur Drizzle : user,
// session, account, verification)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Domaine
// ---------------------------------------------------------------------------

export const courseStatus = pgEnum("course_status", ["processing", "ready", "failed"]);
export const engineType = pgEnum("engine_type", ["generated", "youtube_short", "youtube_clip"]);
export const episodeStatus = pgEnum("episode_status", [
  "pending",
  "scripting",
  "tts",
  "ready",
  "failed",
]);

/** 1. Cours et supports PDF / diaporamas importés. */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    discipline: text("discipline").default("biologie"),
    sourceR2Key: text("source_r2_key").notNull(),
    pageCount: integer("page_count").notNull(),
    status: courseStatus("status").notNull().default("processing"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("courses_user_id_idx").on(t.userId)],
);

/** 2. Schémas et figures extraits du cours (bbox normalisée 0..1000). */
export const courseDiagrams = pgTable(
  "course_diagrams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    r2ImageKey: text("r2_image_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    caption: text("caption"),
    aiDescription: text("ai_description").notNull(),
    bboxJson: jsonb("bbox_json").$type<{ ymin: number; xmin: number; ymax: number; xmax: number }>(),
  },
  (t) => [index("course_diagrams_course_id_idx").on(t.courseId)],
);

/** 3. Concepts atomiques extraits, reliés à leurs schémas (`diagram_ids`). */
export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapterTitle: text("chapter_title").notNull(),
    title: text("title").notNull(),
    keywords: text("keywords").array().notNull(),
    sourcePages: integer("source_pages").array().notNull(),
    diagramIds: uuid("diagram_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    orderIndex: integer("order_index").notNull(),
  },
  (t) => [index("concepts_course_id_idx").on(t.courseId)],
);

/** 4. Cache des métadonnées YouTube (TTL 30 jours, purgeable). */
export const youtubeVideosCache = pgTable(
  "youtube_videos_cache",
  {
    videoId: text("video_id").primaryKey(),
    channelId: text("channel_id").notNull(),
    title: text("title").notNull(),
    language: text("language").notNull(), // fr | en
    durationSec: integer("duration_sec").notNull(),
    isShort: boolean("is_short").notNull(),
    isEmbeddable: boolean("is_embeddable").notNull(),
    viewCount: bigint("view_count", { mode: "number" }).default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("youtube_videos_cache_expires_at_idx").on(t.expiresAt)],
);

/** 5. Capsules unifiées du feed vertical (moteurs 1 et 2). */
export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    engineType: engineType("engine_type").notNull(),
    status: episodeStatus("status").notNull().default("pending"),
    title: text("title").notNull(),
    durationSec: real("duration_sec").notNull(),
    audioR2Key: text("audio_r2_key"),
    storyboardJson: jsonb("storyboard_json"),
    // Volontairement SANS clé étrangère vers youtube_videos_cache : la purge à
    // 30 jours du cache ne doit pas être bloquée par les épisodes existants.
    youtubeVideoId: text("youtube_video_id"),
    ytStartSec: integer("yt_start_sec").default(0),
    ytEndSec: integer("yt_end_sec"),
    relevanceScore: real("relevance_score"),
    quizJson: jsonb("quiz_json"),
    modelUsed: text("model_used"),
    ttsVoice: text("tts_voice"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("episodes_course_id_idx").on(t.courseId),
    index("episodes_concept_id_idx").on(t.conceptId),
  ],
);

/** 6. Progression et répétition espacée. */
export const userProgress = pgTable(
  "user_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    watchedPct: real("watched_pct").default(0),
    quizCorrect: boolean("quiz_correct"),
    liked: boolean("liked").default(false),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.episodeId] })],
);

/** Journal des consommations IA / TTS (garde-fou budgétaire de la phase 5). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    task: text("task").notNull(), // ex. "ingest.concepts", "episode.script", "tts"
    provider: text("provider").notNull(), // gemini | google-tts | mistral | elevenlabs
    model: text("model").notNull(), // identifiant du modèle ou de la voix
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0), // réflexion incluse
    thinkingTokens: integer("thinking_tokens").notNull().default(0),
    toolUsePromptTokens: integer("tool_use_prompt_tokens").notNull().default(0),
    characters: integer("characters").notNull().default(0), // TTS
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }).notNull().default(0),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
  },
  (t) => [index("ai_usage_created_at_idx").on(t.createdAt)],
);
