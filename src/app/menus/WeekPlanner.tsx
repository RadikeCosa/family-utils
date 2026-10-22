"use client";
import { useEffect, useRef } from "react";
import { addDays, isMenuDateInRange, type MealType } from "@/lib/meals/rules";
import type { Meal, WeekData, Group } from "@/lib/meals/types";
import styles from "./menus.module.css";

function groupPeople(meal:Meal,group:Group) {
 return meal.attendance.filter(person=>group.id?person.groupId===group.id:!person.groupId&&person.status===group.kind).length;
}
function MainMeal({meal,label}:{meal:Meal;label:string}) {
 const home=meal.groups.find(group=>group.kind==="home");
 const linked=meal.groups.filter(group=>group.followsHome&&group.selection);
 const counts={home:0,packed:0,away:0,unknown:0};
 for(const person of meal.attendance)counts[person.status]++;
 return <section className={styles.weekMeal} aria-label={label}>
  <h3>{label}</h3>
  {meal.groups.filter(group=>!group.followsHome||!group.selection).map(group=><p className={styles.weekDish} key={group.id??group.kind}>
   <span>{group.kind==="home"&&linked.length>0?`Casa (${home?groupPeople(meal,home):0}) + ${linked.map(item=>`${item.name.toLowerCase()} (${groupPeople(meal,item)})`).join(" + ")}`:group.name}</span>
   <strong className={!group.selection?styles.pendingText:undefined}>{group.selection?.title??(group.followsHome?"Todavía no eligieron la comida de casa":"Todavía no elegimos qué comer")}</strong>
  </p>)}
  <small className={styles.weekPeople}>{counts.home} en casa · {counts.packed} llevan{counts.away>0?` · ${counts.away} afuera`:""}{counts.unknown>0?` · ${counts.unknown} por definir`:""}</small>
 </section>;
}
export default function WeekPlanner({data,onSelect}:{data:WeekData|null;onSelect:(day:string)=>void}) {
 const todayCard=useRef<HTMLElement>(null);
 const weekStart=data?.weekStart,todayDate=data?.today;
 useEffect(()=>{
  todayCard.current?.scrollIntoView({block:"start",inline:"nearest"});
 },[weekStart,todayDate]);
 if(!data)return <p className={styles.loading}>Cargando la semana…</p>;
 return <section className={styles.weekGrid} aria-label="Plan de la semana">
  {Array.from({length:7},(_,index)=>addDays(data.weekStart,index)).map(date=>{
   const meals=data.meals.filter(meal=>meal.date===date);
   const meal=(type:MealType)=>meals.find(item=>item.mealType===type);
   const short=new Intl.DateTimeFormat("es-AR",{timeZone:"UTC",weekday:"long",day:"numeric"}).format(new Date(`${date}T12:00:00.000Z`));
   const full=new Intl.DateTimeFormat("es-AR",{timeZone:"UTC",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(`${date}T12:00:00.000Z`));
   const today=date===data.today;
   const lunch=meal("lunch"),dinner=meal("dinner");
   return <article className={`${styles.weekDay} ${today?styles.weekToday:""}`} key={date} ref={today?todayCard:undefined}>
    <h2><button aria-label={`Ver ${today?"hoy, ":""}${full}`} aria-current={today?"date":undefined} disabled={!isMenuDateInRange(date,data.today)} onClick={()=>onSelect(date)}>{short.charAt(0).toUpperCase()+short.slice(1)}{today&&<span>Hoy</span>}</button></h2>
    {date<data.today&&<p className={styles.weekReadOnly}>Solo lectura</p>}
    <p className={styles.weekSecondary}><span>Desayuno</span> {meal("breakfast")?.selection?.title??"Todavía no elegimos qué comer"}</p>
    {lunch&&<MainMeal meal={lunch} label="Almuerzo" />}
    <p className={styles.weekSecondary}><span>Merienda</span> {meal("snack")?.selection?.title??"Todavía no elegimos qué comer"}</p>
    {dinner&&<MainMeal meal={dinner} label="Cena" />}
   </article>;
  })}
 </section>;
}
