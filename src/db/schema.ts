import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { FAMILY_TIME_ZONE, type CarryPolicy, type FamilyRole, type OccurrenceStatus, type TaskStatus } from "@/lib/tasks/rules";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const authRateLimit = pgTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const familyRoleEnum = pgEnum("family_role", ["administrator", "member"]);
export const taskStatusEnum = pgEnum("task_status", ["active", "finalized", "archived"]);
export const occurrenceStatusEnum = pgEnum("occurrence_status", ["open", "completed", "missed", "archived"]);
export const carryPolicyEnum = pgEnum("carry_policy", ["expires_daily", "carry_forward"]);
export const presenceRuleKindEnum = pgEnum("presence_rule_kind", ["weekly", "period", "exception"]);
export const accessCodePurposeEnum = pgEnum("access_code_purpose", ["invitation", "recovery"]);
export const assignmentModeEnum = pgEnum("assignment_mode", ["shared", "individual"]);

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default(FAMILY_TIME_ZONE),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  role: familyRoleEnum("role").notNull().default("member").$type<FamilyRole>(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("members_family_id_idx").on(table.familyId)]);

export const memberDevices = pgTable("member_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  authUserId: text("auth_user_id").notNull().unique().references(() => authUser.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 100 }),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [index("member_devices_member_id_idx").on(table.memberId)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("active").$type<TaskStatus>(),
  assignmentMode: assignmentModeEnum("assignment_mode").notNull().default("shared"),
  repeatWeekdays: integer("repeat_weekdays").array(),
  carryPolicy: carryPolicyEnum("carry_policy").notNull().default("expires_daily").$type<CarryPolicy>(),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  scheduledTime: time("scheduled_time"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdByMemberId: uuid("created_by_member_id").notNull().references(() => members.id),
  editedByMemberId: uuid("edited_by_member_id").notNull().references(() => members.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("tasks_family_status_idx").on(table.familyId, table.status)]);

export const taskAssignees = pgTable("task_assignees", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("task_assignees_pk").on(table.taskId, table.memberId), index("task_assignees_member_idx").on(table.memberId)]);

export const occurrences = pgTable("task_occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  dueDate: date("due_date", { mode: "string" }),
  responsibilityMemberId: uuid("responsibility_member_id").references(() => members.id),
  claimedByMemberId: uuid("claimed_by_member_id").references(() => members.id),
  status: occurrenceStatusEnum("status").notNull().default("open").$type<OccurrenceStatus>(),
  completedByMemberId: uuid("completed_by_member_id").references(() => members.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  index("occurrences_family_status_date_idx").on(table.familyId, table.status, table.dueDate),
  uniqueIndex("occurrences_shared_once_idx").on(table.taskId, table.dueDate).where(sql`${table.responsibilityMemberId} IS NULL AND ${table.dueDate} IS NOT NULL`),
  uniqueIndex("occurrences_individual_once_idx").on(table.taskId, table.dueDate, table.responsibilityMemberId).where(sql`${table.responsibilityMemberId} IS NOT NULL AND ${table.dueDate} IS NOT NULL`),
  uniqueIndex("occurrences_shared_no_date_once_idx").on(table.taskId).where(sql`${table.responsibilityMemberId} IS NULL AND ${table.dueDate} IS NULL`),
  uniqueIndex("occurrences_individual_no_date_once_idx").on(table.taskId, table.responsibilityMemberId).where(sql`${table.responsibilityMemberId} IS NOT NULL AND ${table.dueDate} IS NULL`),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  actorMemberId: uuid("actor_member_id").references(() => members.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (table) => [index("audit_family_created_idx").on(table.familyId, table.createdAt.desc())]);

export const presenceRules = pgTable("presence_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  kind: presenceRuleKindEnum("kind").notNull(),
  weekday: integer("weekday"),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  startsAt: time("starts_at").notNull(),
  endsAt: time("ends_at").notNull(),
  isPresent: boolean("is_present").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("presence_member_dates_idx").on(table.memberId, table.startDate, table.endDate)]);

export const accessCodes = pgTable("access_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  purpose: accessCodePurposeEnum("purpose").notNull(),
  digest: varchar("digest", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByMemberId: uuid("created_by_member_id").notNull().references(() => members.id),
  createdAt: createdAt(),
});

export const codeRateLimits = pgTable("code_rate_limits", {
  bucketKey: varchar("bucket_key", { length: 128 }).primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: updatedAt(),
});
