import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, mealDistributions, mealExceptions, mealGroups, mealRoutines, mealSlots, mealSuggestions, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { MEAL_TYPES, hasMealAttendance, addDays, getDayInTimeZone, isValidDate, startOfWeek, resolveParticipation, routineFor } from "@/lib/meals/rules";

export const runtime="nodejs";
export async function GET(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 const supplied=new URL(request.url).searchParams.get("weekStart");
 if(supplied&&!isValidDate(supplied))return NextResponse.json({error:"Invalid week"},{status:400});
 const today=getDayInTimeZone(new Date(),actor.familyTimeZone);
 const weekStart=startOfWeek(supplied??today),weekEnd=addDays(weekStart,6);
 const db=getDb();
 const [state]=await db.select({revision:families.menusRevision}).from(families).where(eq(families.id,actor.familyId)).limit(1);
 const revision=state?.revision??0;
 const etag=`"menus-v3-${actor.familyId}-${weekStart}-r${revision}-${today}"`;
 if(request.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:{ETag:etag,"Cache-Control":"private, no-cache"}});
 const [activeMembers,allMembers,slots,routines]=await Promise.all([
  db.select({id:members.id,name:members.name,role:members.role}).from(members).where(and(eq(members.familyId,actor.familyId),isNull(members.archivedAt))).orderBy(asc(members.createdAt)),
  db.select({id:members.id,name:members.name}).from(members).where(eq(members.familyId,actor.familyId)),
  db.select().from(mealSlots).where(and(eq(mealSlots.familyId,actor.familyId),gte(mealSlots.mealDate,weekStart),lte(mealSlots.mealDate,weekEnd))),
  db.select().from(mealRoutines).where(and(eq(mealRoutines.familyId,actor.familyId),lte(mealRoutines.startsOn,weekEnd))),
 ]);
 const ids=slots.map(s=>s.id);
 const [ideas,groups,exceptions,distributions]=ids.length?await Promise.all([
  db.select().from(mealSuggestions).where(inArray(mealSuggestions.slotId,ids)).orderBy(asc(mealSuggestions.createdAt)),
  db.select().from(mealGroups).where(inArray(mealGroups.slotId,ids)).orderBy(asc(mealGroups.createdAt)),
  db.select().from(mealExceptions).where(inArray(mealExceptions.slotId,ids)),
  db.select().from(mealDistributions).where(inArray(mealDistributions.slotId,ids)),
 ]):[[],[],[],[]];
 const names=new Map(allMembers.map(m=>[m.id,m.name]));
 const ideaById=new Map(ideas.map(idea=>[idea.id,idea]));
 const slotByKey=new Map(slots.map(slot=>[`${slot.mealDate}:${slot.mealType}`,slot]));
 const meals=Array.from({length:7},(_,offset)=>addDays(weekStart,offset)).flatMap(date=>MEAL_TYPES.map(mealType=>{
  const slot=slotByKey.get(`${date}:${mealType}`);
  const slotGroups=groups.filter(g=>g.slotId===slot?.id);
  const main=slotGroups.find(g=>g.kind!=="packed");
  const defaultPacked=slotGroups.find(g=>g.kind==="packed"&&g.isDefault);
  const distribution=distributions.find(d=>d.slotId===slot?.id);
  const overrides=exceptions.filter(e=>e.slotId===slot?.id);
  const attendance=hasMealAttendance(mealType)?resolveParticipation({memberIds:activeMembers.map(m=>m.id),date,mealType,
    homeId:main?.id??null,packedId:defaultPacked?.id??null,routines,exceptions:overrides.map(e=>({...e,updatedAt:e.updatedAt.toISOString()})),snapshot:distribution?.participants}):[];
  const selectionFor=(group:typeof mealGroups.$inferSelect|undefined)=>{
   if(!group)return null;
   const source=group.followsHome?main:group;
   const idea=source?.suggestionId?ideaById.get(source.suggestionId):undefined;
   if(!idea)return null;
   return {suggestionId:idea.id,title:idea.title,note:idea.note,proposedById:idea.authorMemberId,proposedByName:names.get(idea.authorMemberId)??null,
    confirmedByMemberId:source!.confirmedByMemberId!,confirmedByName:names.get(source!.confirmedByMemberId!)??"Integrante archivado",confirmedAt:source!.confirmedAt,version:group.version};
  };
  const projected:Array<{id:string|null;kind:"home"|"packed"|"shared";name:string;isDefault:boolean;followsHome:boolean;selection:ReturnType<typeof selectionFor>;selectionVersion:number}>=slotGroups.map(g=>({id:g.id,kind:g.kind,name:g.name,isDefault:g.isDefault,followsHome:g.followsHome,selection:selectionFor(g),selectionVersion:g.version}));
  if(!main)projected.unshift({id:null,kind:hasMealAttendance(mealType)?"home":"shared",name:hasMealAttendance(mealType)?"Casa":"Compartido",isDefault:true,followsHome:false,selection:null,selectionVersion:0});
  if(!defaultPacked&&attendance.some(p=>p.status==="packed"&&!p.groupId))projected.push({id:null,kind:"packed",name:"Lunchera",isDefault:true,followsHome:false,selection:null,selectionVersion:0});
  const origin=distribution?distribution.adjusted?"Guardada · ajustada":"Guardada":overrides.some(e=>activeMembers.some(m=>m.id===e.memberId))?"Ajustada para esta fecha":activeMembers.some(m=>routineFor(routines,m.id,mealType,date))?"Según rutina":"Por definir";
  return {date,mealType,slotId:slot?.id??null,groups:projected,
   attendance:attendance.map(p=>({...p,updatedByName:p.updatedByMemberId?names.get(p.updatedByMemberId)??null:null})),
   distributionOrigin:origin,distributionSaved:!!distribution,
   noRoutineMemberIds:hasMealAttendance(mealType)?activeMembers.filter(m=>!routineFor(routines,m.id,mealType,date)).map(m=>m.id):[],
   suggestions:ideas.filter(idea=>idea.slotId===slot?.id&&!idea.withdrawnAt).map(idea=>({...idea,authorName:names.get(idea.authorMemberId)??"Integrante archivado"})),
   selection:selectionFor(main),selectionVersion:main?.version??0};
 }));
 return NextResponse.json({weekStart,weekEnd,today,timeZone:actor.familyTimeZone,revision,currentMemberId:actor.memberId,currentRole:actor.role,members:activeMembers,meals},{headers:{ETag:etag,"Cache-Control":"private, no-cache"}});
}
