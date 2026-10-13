import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, mealGroups, mealSuggestions, members } from "@/db/schema";
import { hasMealAttendance, isUuid } from "@/lib/meals/rules";
import { mutateMeal, ensureMealGroup, freezeDistribution, effectiveParticipation, bumpMenusRevision, MealError } from "@/lib/meals/server";

export const runtime = "nodejs";
export async function PUT(request: Request) {
  return mutateMeal(request,true,async ({tx,slot,actor,memberId,body})=>{
    if(!Number.isSafeInteger(body.expectedVersion)||(body.expectedVersion as number)<0)throw new MealError("Revisá la versión del menú.");
    let group;
    if(body.groupId!=null) {
      if(!isUuid(body.groupId))throw new MealError("Grupo inválido.");
      [group]=await tx.select().from(mealGroups).where(and(eq(mealGroups.id,body.groupId),eq(mealGroups.slotId,slot.id))).limit(1);
      if(!group)throw new MealError("El grupo ya no existe. Actualizá la pantalla.",409);
    } else {
      const kind=hasMealAttendance(slot.mealType)?body.groupKind==="packed"?"packed":"home":"shared";
      group=await ensureMealGroup(tx,slot.id,kind);
    }
    if(group.version!==body.expectedVersion)throw new MealError("La comida cambió mientras guardabas. Revisá la elección actual.",409,"MEAL_SELECTION_CONFLICT");
    const mode=body.mode??"choose";
    if(!["choose","link","unlink"].includes(String(mode)))throw new MealError("Acción inválida.");
    const title=typeof body.title==="string"?body.title.trim():"";
    const note=typeof body.note==="string"?body.note.trim():"";
    const suggestionId=body.suggestionId??null;
    if((suggestionId!==null&&!isUuid(suggestionId))||title.length>160||note.length>1000||(suggestionId&&title))throw new MealError("Revisá la comida y la sugerencia.");
    let targetId:string|null=null;
    let followsHome=false;
    let linkedHomeHasMeal=false;
    let createdSuggestion=null;
    if(mode==="link"||mode==="unlink") {
      if(group.kind!=="packed")throw new MealError("Solo las luncheras pueden vincularse a Casa.");
      if(mode==="unlink"&&!group.followsHome)throw new MealError("La lunchera ya es independiente.",409);
      const home=await ensureMealGroup(tx,slot.id,"home");
      followsHome=mode==="link";
      linkedHomeHasMeal=!!home.suggestionId;
      targetId=mode==="unlink"?home.suggestionId:null;
    } else if(suggestionId) {
      const [idea]=await tx.select().from(mealSuggestions).where(and(eq(mealSuggestions.id,suggestionId),eq(mealSuggestions.slotId,slot.id),isNull(mealSuggestions.withdrawnAt))).limit(1);
      if(!idea)throw new MealError("La sugerencia ya no está disponible para esta comida.");
      targetId=idea.id;
    } else if(title) {
      const [idea]=await tx.insert(mealSuggestions).values({slotId:slot.id,authorMemberId:memberId,title,note:note||null}).returning();
      createdSuggestion=idea;targetId=idea.id;
      await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_suggestion",entityId:idea.id,action:"created_and_confirmed",after:idea});
    }
    const confirming=!!targetId||followsHome;
    if(confirming) {
      const [active]=await tx.select({id:members.id}).from(members).where(and(eq(members.familyId,actor.familyId),isNull(members.archivedAt))).limit(1);
      if(!active)throw new MealError("No hay integrantes activos para esta comida.",409);
      if(targetId||followsHome&&linkedHomeHasMeal)await freezeDistribution(tx,actor.familyId,slot,memberId);
    }
    const [saved]=await tx.update(mealGroups).set({suggestionId:targetId,followsHome,confirmedByMemberId:memberId,confirmedAt:new Date(),version:group.version+1,updatedAt:new Date()}).where(eq(mealGroups.id,group.id)).returning();
    await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_selection",entityId:slot.id,action:confirming?(group.suggestionId||group.followsHome?"changed":"confirmed"):"cleared",before:group,after:saved});
    await bumpMenusRevision(tx,actor.familyId);
    const people=hasMealAttendance(slot.mealType)?await effectiveParticipation(tx,actor.familyId,slot):[];
    return {selection:targetId||followsHome?saved:null,version:saved.version,pendingAttendance:people.some(p=>p.status==="unknown"),suggestion:createdSuggestion};
  });
}
