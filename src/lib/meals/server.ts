import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MemberContext } from "@/lib/auth/context";
import { getDb } from "@/db";
import { families, mealSlots, memberDevices, members } from "@/db/schema";
import type { MealType } from "./rules";

export type MealTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function lockFamilyActor(tx: MealTransaction, actor: MemberContext) {
  await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
  const [current] = await tx.select({ memberId: members.id, role: members.role })
    .from(memberDevices)
    .innerJoin(members, eq(memberDevices.memberId, members.id))
    .where(and(
      eq(memberDevices.authUserId, actor.authUser.id),
      isNull(memberDevices.revokedAt),
      isNull(members.archivedAt),
      eq(members.familyId, actor.familyId),
    ))
    .limit(1);
  return current ?? null;
}

export async function lockMealSlot(tx: MealTransaction, familyId: string, day: string, mealType: MealType) {
  await tx.insert(mealSlots).values({ familyId, mealDate: day, mealType }).onConflictDoNothing();
  const [slot] = await tx.select().from(mealSlots)
    .where(and(eq(mealSlots.familyId, familyId), eq(mealSlots.mealDate, day), eq(mealSlots.mealType, mealType)))
    .for("update")
    .limit(1);
  return slot ?? null;
}

export async function bumpMenusRevision(tx: MealTransaction, familyId: string) {
  await tx.execute(sql`UPDATE ${families} SET menus_revision = menus_revision + 1, updated_at = now() WHERE id = ${familyId}`);
}
