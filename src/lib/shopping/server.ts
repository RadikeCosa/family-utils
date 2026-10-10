import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, families, memberDevices, members, shoppingEditors, shoppingItems, shoppingLists, shoppingSuggestions } from "@/db/schema";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { normalizeProductName, productInput, shoppingItemOrder, shoppingPermissions, UUID_PATTERN } from "./rules";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Command = "create" | "manage" | "editors" | "transfer" | "add" | "edit" | "remove" | "purchased" | "reset" | "suggestion";
class ShoppingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new ShoppingError(status, code, message); }
function expectVersion(actual: number, expected: unknown) {
  if (actual !== expected) fail(409, "CONFLICT", "Hubo otro cambio. Revisá los datos actuales antes de volver a guardar.");
}
async function activeActor(tx: Tx, actor: MemberContext) {
  const [current] = await tx.select({ id: members.id, name: members.name, role: members.role }).from(memberDevices)
    .innerJoin(members, eq(members.id, memberDevices.memberId))
    .where(and(eq(memberDevices.authUserId, actor.authUser.id), eq(members.id, actor.memberId), eq(members.familyId, actor.familyId),
      isNull(memberDevices.revokedAt), isNull(members.archivedAt))).limit(1);
  if (!current) fail(403, "NO_ACCESS", "Tu acceso a la familia ya no está disponible.");
  return current;
}
async function record(tx: Tx, actor: MemberContext, entityType: string, entityId: string, action: string, before: unknown, after: unknown) {
  await tx.insert(auditEvents).values({ familyId: actor.familyId, actorMemberId: actor.memberId, entityType, entityId, action, before, after });
  await tx.update(families).set({ shoppingRevision: sql`${families.shoppingRevision} + 1` }).where(eq(families.id, actor.familyId));
}

export async function readShopping(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "Ingresá a tu familia.", code: "NO_ACCESS" }, { status: 403 });
  try {
    return await getDb().transaction(async (tx) => {
      const current = await activeActor(tx, actor);
      const [family] = await tx.select({ revision: families.shoppingRevision, accessRevision: families.revision }).from(families).where(eq(families.id, actor.familyId));
      const etag = `"shopping-${actor.familyId}-${current.id}-${family.revision}-${family.accessRevision}"`;
      const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
      if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
      const profiles = await tx.select({ id: members.id, name: members.name, role: members.role, archivedAt: members.archivedAt }).from(members).where(eq(members.familyId, actor.familyId));
      const lists = await tx.select().from(shoppingLists).where(eq(shoppingLists.familyId, actor.familyId)).orderBy(asc(shoppingLists.createdAt), asc(shoppingLists.id));
      const ids = lists.map((list) => list.id);
      const items = ids.length ? await tx.select().from(shoppingItems).where(inArray(shoppingItems.listId, ids)) : [];
      const editors = ids.length ? await tx.select().from(shoppingEditors).where(inArray(shoppingEditors.listId, ids)) : [];
      const suggestions = await tx.select().from(shoppingSuggestions).where(eq(shoppingSuggestions.familyId, actor.familyId)).orderBy(asc(shoppingSuggestions.name));
      const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
      return NextResponse.json({ ...family, currentMemberId: current.id, currentRole: current.role, members: profiles, suggestions,
        lists: lists.map((list) => {
          const editorIds = editors.filter((editor) => editor.listId === list.id).map((editor) => editor.memberId);
          return { ...list, editorIds, ownerName: names.get(list.ownerMemberId), creatorName: names.get(list.createdByMemberId),
            ...shoppingPermissions(list.ownerMemberId, current.id, editorIds, !!list.archivedAt),
            items: items.filter((item) => item.listId === list.id).sort(shoppingItemOrder).map((item) => ({ ...item,
              updatedByName: names.get(item.updatedByMemberId), purchasedByName: item.purchasedByMemberId ? names.get(item.purchasedByMemberId) : null })) };
        }),
      }, { headers });
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof ShoppingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  // Do not log product names, family data or request bodies.
  console.error("shopping_request_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "unknown" });
  return NextResponse.json({ error: "No se pudo guardar. Intentá nuevamente.", code: "UNAVAILABLE" }, { status: 500 });
}

export async function mutateShopping(request: Request, command: Command, listId?: string, entityId?: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "Ingresá a tu familia.", code: "NO_ACCESS" }, { status: 403 });
  if ((listId && !UUID_PATTERN.test(listId)) || (entityId && !UUID_PATTERN.test(entityId))) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Datos inválidos." }, { status: 400 }); }
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
      const current = await activeActor(tx, actor);
      if (command === "create") {
        if (body.name !== undefined && typeof body.name !== "string") fail(400, "INVALID", "Nombre inválido.");
        const name = (body.name as string | undefined)?.trim() || current.name;
        if (name.length > 160) fail(400, "INVALID", "El nombre admite hasta 160 caracteres.");
        const [list] = await tx.insert(shoppingLists).values({ familyId: actor.familyId, name, createdByMemberId: current.id, ownerMemberId: current.id }).returning();
        await record(tx, actor, "shopping_list", list.id, "created", null, list);
        return { id: list.id };
      }
      if (command === "suggestion") {
        const [suggestion] = await tx.select().from(shoppingSuggestions).where(and(eq(shoppingSuggestions.id, entityId!), eq(shoppingSuggestions.familyId, actor.familyId))).for("update");
        if (!suggestion) fail(404, "NOT_FOUND", "Sugerencia no encontrada.");
        if (typeof body.hidden !== "boolean") fail(400, "INVALID", "Estado inválido.");
        expectVersion(suggestion.version, body.expectedVersion);
        if (suggestion.hidden === body.hidden) return { id: suggestion.id };
        const [updated] = await tx.update(shoppingSuggestions).set({ hidden: body.hidden, version: suggestion.version + 1, updatedAt: new Date() }).where(eq(shoppingSuggestions.id, suggestion.id)).returning();
        await record(tx, actor, "shopping_suggestion", suggestion.id, body.hidden ? "hidden" : "restored", suggestion, updated);
        return { id: suggestion.id };
      }
      const [list] = await tx.select().from(shoppingLists).where(and(eq(shoppingLists.id, listId!), eq(shoppingLists.familyId, actor.familyId))).for("update");
      if (!list) fail(404, "NOT_FOUND", "Lista no encontrada.");
      const editors = await tx.select().from(shoppingEditors).where(eq(shoppingEditors.listId, list.id));
      const permissions = shoppingPermissions(list.ownerMemberId, current.id, editors.map((editor) => editor.memberId), !!list.archivedAt);
      const managing = ["manage", "editors", "transfer"].includes(command);
      if (command === "transfer" ? current.role !== "administrator" : managing ? !permissions.canManage : !permissions.canEdit) {
        fail(403, list.archivedAt && !managing ? "ARCHIVED" : "PERMISSION_REVOKED", list.archivedAt && !managing ? "La lista está archivada. Conservamos tu borrador." : "Ya no tenés permiso para esta acción. Conservamos tu borrador.");
      }
      const now = new Date();
      if (managing) {
        expectVersion(list.version, body.expectedVersion);
        if (command === "manage") {
          if (body.action !== "rename" && body.action !== "archive" && body.action !== "restore") fail(400, "INVALID", "Acción inválida.");
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (body.action === "rename" && (!name || name.length > 160)) fail(400, "INVALID", "Ingresá un nombre de hasta 160 caracteres.");
          if ((body.action === "rename" && name === list.name) || (body.action === "archive" && !!list.archivedAt) || (body.action === "restore" && !list.archivedAt)) return { id: list.id };
          const [updated] = await tx.update(shoppingLists).set({ ...(body.action === "rename" ? { name } : { archivedAt: body.action === "archive" ? now : null }), version: list.version + 1, updatedAt: now }).where(eq(shoppingLists.id, list.id)).returning();
          await record(tx, actor, "shopping_list", list.id, body.action, list, updated);
        } else if (command === "editors") {
          if (!Array.isArray(body.memberIds) || body.memberIds.length > 100 || body.memberIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) fail(400, "INVALID", "Integrantes inválidos.");
          const memberIds = [...new Set(body.memberIds as string[])].filter((id) => id !== list.ownerMemberId).sort();
          if (memberIds.length) {
            const valid = await tx.select({ id: members.id }).from(members).where(and(eq(members.familyId, actor.familyId), isNull(members.archivedAt), inArray(members.id, memberIds)));
            if (valid.length !== memberIds.length) fail(400, "INVALID", "Elegí integrantes activos de tu familia.");
          }
          if (JSON.stringify(editors.map((editor) => editor.memberId).sort()) === JSON.stringify(memberIds)) return { id: list.id };
          await tx.delete(shoppingEditors).where(eq(shoppingEditors.listId, list.id));
          if (memberIds.length) await tx.insert(shoppingEditors).values(memberIds.map((memberId) => ({ listId: list.id, memberId })));
          await tx.update(shoppingLists).set({ version: list.version + 1, updatedAt: now }).where(eq(shoppingLists.id, list.id));
          await record(tx, actor, "shopping_list", list.id, "editors_changed", { editorIds: editors.map((editor) => editor.memberId) }, { editorIds: memberIds });
        } else {
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (typeof body.ownerMemberId !== "string" || !UUID_PATTERN.test(body.ownerMemberId) || !reason || reason.length > 1000) fail(400, "INVALID", "Elegí un nuevo dueño e indicá el motivo (hasta 1.000 caracteres).");
          const [owner] = await tx.select().from(members).where(and(eq(members.id, body.ownerMemberId), eq(members.familyId, actor.familyId), isNull(members.archivedAt)));
          if (!owner) fail(400, "INVALID", "Elegí un integrante activo de tu familia.");
          if (owner.id === list.ownerMemberId) return { id: list.id };
          await tx.delete(shoppingEditors).where(eq(shoppingEditors.listId, list.id));
          const [updated] = await tx.update(shoppingLists).set({ ownerMemberId: owner.id, version: list.version + 1, updatedAt: now }).where(eq(shoppingLists.id, list.id)).returning();
          await record(tx, actor, "shopping_list", list.id, "transferred", { ...list, editorIds: editors.map((editor) => editor.memberId) }, { ...updated, reason, editorIds: [] });
        }
        return { id: list.id };
      }
      if (command === "add") {
        const input = productInput(body);
        if (!input) fail(400, "INVALID", "Ingresá un nombre (hasta 160), marca (hasta 160) y cantidad (hasta 100 caracteres).");
        const [item] = await tx.insert(shoppingItems).values({ ...input, listId: list.id, updatedByMemberId: current.id }).returning();
        await record(tx, actor, "shopping_item", item.id, "created", null, item);
        return { id: item.id };
      }
      if (command === "reset") {
        const before = await tx.select().from(shoppingItems).where(and(eq(shoppingItems.listId, list.id), eq(shoppingItems.purchased, true)));
        if (!before.length) return { id: list.id };
        const after = await tx.update(shoppingItems).set({ purchased: false, purchasedAt: null, purchasedByMemberId: null, updatedByMemberId: current.id, updatedAt: now }).where(and(eq(shoppingItems.listId, list.id), eq(shoppingItems.purchased, true))).returning();
        await record(tx, actor, "shopping_list", list.id, "purchases_reset", before, after);
        return { id: list.id };
      }
      const [item] = await tx.select().from(shoppingItems).where(and(eq(shoppingItems.id, entityId!), eq(shoppingItems.listId, list.id))).for("update");
      if (!item) fail(404, "NOT_FOUND", "El producto ya no está en la lista. Conservamos tu borrador.");
      if (command === "purchased") {
        if (typeof body.purchased !== "boolean") fail(400, "INVALID", "Estado inválido.");
        if (body.purchased === item.purchased) return { id: item.id };
        const [updated] = await tx.update(shoppingItems).set({ purchased: body.purchased, purchasedByMemberId: body.purchased ? current.id : null, purchasedAt: body.purchased ? now : null, updatedByMemberId: current.id, updatedAt: now }).where(eq(shoppingItems.id, item.id)).returning();
        if (body.purchased) await tx.insert(shoppingSuggestions).values({ familyId: actor.familyId, name: item.name, normalizedName: normalizeProductName(item.name) }).onConflictDoNothing();
        await record(tx, actor, "shopping_item", item.id, body.purchased ? "purchased" : "unpurchased", item, updated);
      } else {
        expectVersion(item.version, body.expectedVersion);
        if (command === "remove") {
          await tx.delete(shoppingItems).where(eq(shoppingItems.id, item.id));
          await record(tx, actor, "shopping_item", item.id, "removed", item, null);
        } else {
          const input = productInput(body);
          if (!input) fail(400, "INVALID", "El nombre es obligatorio; revisá la longitud de los campos.");
          if (input.name === item.name && input.brand === item.brand && input.quantity === item.quantity) return { id: item.id };
          const [updated] = await tx.update(shoppingItems).set({ ...input, version: item.version + 1, updatedByMemberId: current.id, updatedAt: now }).where(eq(shoppingItems.id, item.id)).returning();
          await record(tx, actor, "shopping_item", item.id, "edited", item, updated);
        }
      }
      return { id: item.id };
    });
    return NextResponse.json(result, { status: command === "create" || command === "add" ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}
