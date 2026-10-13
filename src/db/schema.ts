import {
  boolean,
  check,
  foreignKey,
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
import { MEAL_TYPES, type Participation, type WeeklyParticipation } from "@/lib/meals/rules";
import { FAMILY_TIME_ZONE, type CarryPolicy, type FamilyRole, type OccurrenceStatus, type TaskStatus } from "@/lib/tasks/rules";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const authUser = pgTable("user", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const authAccount = pgTable("account", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
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
}, (table) => [
  index("account_user_id_idx").on(table.userId),
  uniqueIndex("account_google_identity_unique_idx").on(table.providerId, table.accountId)
    .where(sql`${table.providerId} = 'google'`),
]);

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const authRateLimit = pgTable("rateLimit", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const familyRoleEnum = pgEnum("family_role", ["administrator", "member"]);
export const taskStatusEnum = pgEnum("task_status", ["active", "finalized", "archived"]);
export const occurrenceStatusEnum = pgEnum("occurrence_status", ["open", "completed", "missed", "archived"]);
export const carryPolicyEnum = pgEnum("carry_policy", ["expires_daily", "carry_forward"]);
export const identityKindEnum = pgEnum("identity_kind", ["google", "anonymous"]);
export const presenceRuleKindEnum = pgEnum("presence_rule_kind", ["weekly", "period", "exception"]);
export const accessCodePurposeEnum = pgEnum("access_code_purpose", ["invitation", "recovery"]);
export const assignmentModeEnum = pgEnum("assignment_mode", ["shared", "individual"]);
export const accessMethodEnum = pgEnum("access_method", ["google", "code"]);
export const mealTypeEnum = pgEnum("meal_type", MEAL_TYPES);
export const mealAttendanceStatusEnum = pgEnum("meal_attendance_status", ["present", "absent"]);

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default(FAMILY_TIME_ZONE),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  menusRevision: bigint("menus_revision", { mode: "number" }).notNull().default(0),
  shoppingRevision: bigint("shopping_revision", { mode: "number" }).notNull().default(0),
  libraryRevision: bigint("library_revision", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  role: familyRoleEnum("role").notNull().default("member").$type<FamilyRole>(),
  accessMethod: accessMethodEnum("access_method").notNull().default("code"),
  googleEmail: text("google_email"),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("members_family_id_idx").on(table.familyId),
  uniqueIndex("members_id_family_unique").on(table.id, table.familyId),
  uniqueIndex("members_google_email_unique_idx").on(sql`lower(${table.googleEmail})`).where(sql`${table.googleEmail} IS NOT NULL`),
]);

export const memberDevices = pgTable("member_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  authUserId: text("auth_user_id").notNull().unique().references(() => authUser.id, { onDelete: "cascade" }),
  identityKind: identityKindEnum("identity_kind").notNull().default("anonymous"),
  label: varchar("label", { length: 100 }),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("member_devices_member_id_idx").on(table.memberId),
  uniqueIndex("member_devices_one_google_identity_per_member_idx").on(table.memberId)
    .where(sql`${table.identityKind} = 'google' AND ${table.revokedAt} IS NULL`),
]);

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
  generationDate: date("generation_date", { mode: "string" }),
  titleSnapshot: varchar("title_snapshot", { length: 160 }).notNull(),
  descriptionSnapshot: text("description_snapshot"),
  scheduledTimeSnapshot: time("scheduled_time_snapshot"),
  assignmentModeSnapshot: assignmentModeEnum("assignment_mode_snapshot").notNull(),
  assigneeIdsSnapshot: jsonb("assignee_ids_snapshot").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  carryPolicySnapshot: carryPolicyEnum("carry_policy_snapshot").notNull().default("expires_daily"),
  carryForward: boolean("carry_forward").notNull().default(false),
  responsibilityMemberId: uuid("responsibility_member_id").references(() => members.id),
  claimedByMemberId: uuid("claimed_by_member_id").references(() => members.id),
  status: occurrenceStatusEnum("status").notNull().default("open").$type<OccurrenceStatus>(),
  completedByMemberId: uuid("completed_by_member_id").references(() => members.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  index("occurrences_family_due_id_idx").on(table.familyId, table.dueDate, table.id),
  index("occurrences_family_completed_id_idx").on(table.familyId, table.completedAt, table.id).where(sql`${table.status} = 'completed'`),
  index("occurrences_family_status_date_idx").on(table.familyId, table.status, table.dueDate),
  uniqueIndex("occurrences_shared_generation_once_idx").on(table.taskId, table.generationDate)
    .where(sql`${table.responsibilityMemberId} IS NULL AND ${table.generationDate} IS NOT NULL AND ${table.status} <> 'archived'`),
  uniqueIndex("occurrences_individual_generation_once_idx").on(table.taskId, table.generationDate, table.responsibilityMemberId)
    .where(sql`${table.responsibilityMemberId} IS NOT NULL AND ${table.generationDate} IS NOT NULL AND ${table.status} <> 'archived'`),
  uniqueIndex("occurrences_shared_no_date_once_idx").on(table.taskId)
    .where(sql`${table.responsibilityMemberId} IS NULL AND ${table.generationDate} IS NULL AND ${table.status} <> 'archived'`),
  uniqueIndex("occurrences_individual_no_date_once_idx").on(table.taskId, table.responsibilityMemberId)
    .where(sql`${table.responsibilityMemberId} IS NOT NULL AND ${table.generationDate} IS NULL AND ${table.status} <> 'archived'`),
  uniqueIndex("occurrences_shared_open_carry_once_idx").on(table.taskId)
    .where(sql`${table.responsibilityMemberId} IS NULL AND ${table.status} = 'open' AND ${table.carryForward} = true`),
  uniqueIndex("occurrences_individual_open_carry_once_idx").on(table.taskId, table.responsibilityMemberId)
    .where(sql`${table.responsibilityMemberId} IS NOT NULL AND ${table.status} = 'open' AND ${table.carryForward} = true`),
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
}, (table) => [index("audit_family_created_idx").on(table.familyId, table.createdAt.desc()), index("audit_occurrence_cause_idx").on(table.familyId, table.entityId, table.action).where(sql`${table.entityType} = 'occurrence'`)]);

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

export const mealSlots = pgTable("meal_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  mealDate: date("meal_date", { mode: "string" }).notNull(),
  mealType: mealTypeEnum("meal_type").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("meal_slots_family_date_type_unique").on(table.familyId, table.mealDate, table.mealType),
  index("meal_slots_family_date_idx").on(table.familyId, table.mealDate),
]);

export const mealSuggestions = pgTable("meal_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  slotId: uuid("slot_id").notNull().references(() => mealSlots.id, { onDelete: "cascade" }),
  authorMemberId: uuid("author_member_id").notNull().references(() => members.id),
  title: varchar("title", { length: 160 }).notNull(),
  note: varchar("note", { length: 1000 }),
  catalogIdeaId: uuid("catalog_idea_id").references(() => mealIdeas.id),
  version: integer("version").notNull().default(1),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("meal_suggestions_slot_created_idx").on(table.slotId, table.createdAt)]);

export const mealAttendance = pgTable("meal_attendance", {
  slotId: uuid("slot_id").notNull().references(() => mealSlots.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  status: mealAttendanceStatusEnum("status"),
  updatedByMemberId: uuid("updated_by_member_id").notNull().references(() => members.id),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("meal_attendance_pk").on(table.slotId, table.memberId), index("meal_attendance_member_idx").on(table.memberId)]);

export const mealSelections = pgTable("meal_selections", {
  slotId: uuid("slot_id").primaryKey().references(() => mealSlots.id, { onDelete: "cascade" }),
  suggestionId: uuid("suggestion_id").references(() => mealSuggestions.id),
  confirmedByMemberId: uuid("confirmed_by_member_id").notNull().references(() => members.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
  consumedByAuthUserId: text("consumed_by_auth_user_id"),
  createdAt: createdAt(),
});

export const codeRateLimits = pgTable("code_rate_limits", {
  bucketKey: varchar("bucket_key", { length: 128 }).primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: updatedAt(),
});

export const shoppingLists = pgTable("shopping_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  createdByMemberId: uuid("created_by_member_id").notNull().references(() => members.id),
  ownerMemberId: uuid("owner_member_id").notNull().references(() => members.id),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("shopping_lists_family_idx").on(table.familyId, table.createdAt)]);

export const shoppingItems = pgTable("shopping_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull().references(() => shoppingLists.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  brand: varchar("brand", { length: 160 }),
  quantity: varchar("quantity", { length: 100 }),
  version: integer("version").notNull().default(1),
  purchased: boolean("purchased").notNull().default(false),
  purchasedByMemberId: uuid("purchased_by_member_id").references(() => members.id),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  updatedByMemberId: uuid("updated_by_member_id").notNull().references(() => members.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("shopping_items_list_idx").on(table.listId, table.createdAt, table.id)]);

export const shoppingEditors = pgTable("shopping_editors", {
  listId: uuid("list_id").notNull().references(() => shoppingLists.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("shopping_editors_unique").on(table.listId, table.memberId)]);

export const shoppingSuggestions = pgTable("shopping_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  normalizedName: text("normalized_name").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("shopping_suggestions_family_name_unique").on(table.familyId, table.normalizedName)]);


export const libraryWorks = pgTable("library_works", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id),
  title: text("title").notNull(),
  normalizedTitle: text("titulo_normalizado").notNull(),
  kind: text("kind").notNull(),
  creator: text("creator"),
  normalizedCreator: text("creador_normalizado").notNull().default(""),
  year: integer("year"),
  referenceUrl: text("reference_url"),
  createdByMemberId: uuid("created_by_member_id").notNull(),
  updatedByMemberId: uuid("updated_by_member_id").notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("library_works_id_family_unique").on(t.id, t.familyId),
  index("library_works_duplicate_idx").on(t.familyId, t.kind, t.normalizedTitle),
  index("library_works_family_created_idx").on(t.familyId, t.createdAt, t.id),
  foreignKey({ columns: [t.createdByMemberId, t.familyId], foreignColumns: [members.id, members.familyId] }),
  foreignKey({ columns: [t.updatedByMemberId, t.familyId], foreignColumns: [members.id, members.familyId] }),
  check("library_works_title_length", sql`char_length(btrim(${t.title})) BETWEEN 1 AND 200`),
  check("library_works_creator_length", sql`${t.creator} IS NULL OR char_length(${t.creator}) BETWEEN 1 AND 200`),
  check("library_works_url", sql`${t.referenceUrl} IS NULL OR (char_length(${t.referenceUrl}) BETWEEN 1 AND 2048 AND ${t.referenceUrl} ~* '^https?://[^[:space:]]+$')`),
  check("library_works_year", sql`${t.year} IS NULL OR ${t.year} BETWEEN 1 AND 9999`),
  check("library_works_kind", sql`${t.kind} IN ('movie', 'series', 'book', 'music', 'art', 'video_game', 'tabletop_game')`),
  check("library_works_version", sql`${t.version} > 0`),
]);

export const libraryPersonal = pgTable("library_personal", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull(),
  workId: uuid("work_id").notNull(),
  memberId: uuid("member_id").notNull(),
  status: text("status"),
  rating: integer("rating"),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("library_personal_work_member_unique").on(t.workId, t.memberId),
  index("library_personal_member_status_idx").on(t.familyId, t.memberId, t.status),
  foreignKey({ columns: [t.workId, t.familyId], foreignColumns: [libraryWorks.id, libraryWorks.familyId] }),
  foreignKey({ columns: [t.memberId, t.familyId], foreignColumns: [members.id, members.familyId] }),
  check("library_personal_status", sql`${t.status} IS NULL OR ${t.status} IN ('pending', 'in_progress', 'finished')`),
  check("library_personal_rating", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  check("library_personal_version", sql`${t.version} > 0`),
]);

export const libraryContributions = pgTable("library_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull(),
  workId: uuid("work_id").notNull(),
  authorMemberId: uuid("author_member_id").notNull(),
  body: text("body").notNull(),
  spoiler: boolean("spoiler").notNull().default(false),
  experienceYear: integer("experience_year"),
  experienceMonth: integer("experience_month"),
  experienceDay: integer("experience_day"),
  version: integer("version").notNull().default(1),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("library_contributions_id_family_unique").on(t.id, t.familyId),
  index("library_contributions_work_created_idx").on(t.workId, t.createdAt, t.id),
  foreignKey({ columns: [t.workId, t.familyId], foreignColumns: [libraryWorks.id, libraryWorks.familyId] }),
  foreignKey({ columns: [t.authorMemberId, t.familyId], foreignColumns: [members.id, members.familyId] }),
  check("library_contributions_body_length", sql`char_length(btrim(${t.body})) BETWEEN 1 AND 5000`),
  check("library_contributions_version", sql`${t.version} > 0`),
  check("library_contributions_experience", sql`
    (${t.experienceYear} IS NULL AND ${t.experienceMonth} IS NULL AND ${t.experienceDay} IS NULL)
    OR (${t.experienceYear} BETWEEN 1 AND 9999 AND
      ((${t.experienceMonth} IS NULL AND ${t.experienceDay} IS NULL) OR
       (${t.experienceMonth} BETWEEN 1 AND 12 AND (${t.experienceDay} IS NULL OR
        CASE WHEN ${t.experienceYear} BETWEEN 1 AND 9999 AND ${t.experienceMonth} BETWEEN 1 AND 12
        THEN ${t.experienceDay} BETWEEN 1 AND extract(day from (make_date(${t.experienceYear}, ${t.experienceMonth}, 1) + interval '1 month - 1 day'))
        ELSE false END)))) IS TRUE`),
]);

export const libraryCompanions = pgTable("library_companions", {
  familyId: uuid("family_id").notNull(),
  contributionId: uuid("contribution_id").notNull(),
  memberId: uuid("member_id").notNull(),
}, (t) => [
  uniqueIndex("library_companions_unique").on(t.contributionId, t.memberId),
  foreignKey({ columns: [t.contributionId, t.familyId], foreignColumns: [libraryContributions.id, libraryContributions.familyId] }),
  foreignKey({ columns: [t.memberId, t.familyId], foreignColumns: [members.id, members.familyId] }),
]);


export const mealGroupKindEnum = pgEnum("meal_group_kind", ["home", "packed", "shared"]);
export const mealParticipationEnum = pgEnum("meal_participation", ["home", "packed", "away", "unknown"]);

export const mealGroups = pgTable("meal_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  slotId: uuid("slot_id").notNull().references(() => mealSlots.id, { onDelete: "cascade" }),
  kind: mealGroupKindEnum("kind").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  followsHome: boolean("follows_home").notNull().default(false),
  suggestionId: uuid("suggestion_id").references(() => mealSuggestions.id),
  confirmedByMemberId: uuid("confirmed_by_member_id").references(() => members.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  version: integer("version").notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [index("meal_groups_slot_idx").on(table.slotId), uniqueIndex("meal_groups_default_unique").on(table.slotId, table.kind).where(sql`${table.isDefault} = true`)]);

export const mealDistributions = pgTable("meal_distributions", {
  slotId: uuid("slot_id").primaryKey().references(() => mealSlots.id, { onDelete: "cascade" }),
  participants: jsonb("participants").$type<Participation[]>().notNull(),
  adjusted: boolean("adjusted").notNull().default(false),
  updatedByMemberId: uuid("updated_by_member_id").references(() => members.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const mealExceptions = pgTable("meal_exceptions", {
  slotId: uuid("slot_id").notNull().references(() => mealSlots.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  status: mealParticipationEnum("status").notNull(),
  groupId: uuid("group_id").references(() => mealGroups.id, { onDelete: "set null" }),
  updatedByMemberId: uuid("updated_by_member_id").notNull().references(() => members.id),
  updatedAt: updatedAt(),
}, table => [uniqueIndex("meal_exceptions_unique").on(table.slotId, table.memberId)]);

export const mealRoutines = pgTable("meal_routines", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  mealType: mealTypeEnum("meal_type").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  name: varchar("name", { length: 80 }).notNull().default("Rutina habitual"),
  weekdays: jsonb("weekdays").$type<WeeklyParticipation>().notNull(),
  updatedByMemberId: uuid("updated_by_member_id").notNull().references(() => members.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [uniqueIndex("meal_routines_version_unique").on(table.memberId, table.mealType, table.startsOn), index("meal_routines_family_idx").on(table.familyId, table.startsOn)]);


export const mealIdeas = pgTable("meal_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  authorMemberId: uuid("author_member_id").notNull().references(() => members.id),
  title: varchar("title", { length: 160 }).notNull(),
  note: varchar("note", { length: 1000 }),
  mealTypes: jsonb("meal_types").$type<(typeof MEAL_TYPES)[number][]>().notNull().default([]),
  packedSuitable: boolean("packed_suitable").notNull().default(false),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [index("meal_ideas_family_idx").on(table.familyId, table.archivedAt)]);
