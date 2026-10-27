import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { addDays, getDayInTimeZone, startOfWeek } from "../../src/lib/meals/rules";

const connectionString=process.env.FAMILY_UTILS_TEST_DATABASE_URL;
test.skip(!connectionString,"requires isolated PostgreSQL");
const baseURL="http://localhost:3318";
let pool:pg.Pool,api:APIRequestContext,familyId:string;
let users:string[];
test.beforeEach(async({page})=>{
  pool=new pg.Pool({connectionString});users=[];
  const {rows:[family]}=await pool.query("INSERT INTO families(name) VALUES('Menus mobile fixture') RETURNING id");familyId=family.id;
  api=await apiRequest.newContext({baseURL,extraHTTPHeaders:{"x-forwarded-for":`2001:db8:${randomUUID().slice(0,4)}::1`}});
  expect((await api.post("/api/access/prepare",{headers:{Origin:baseURL}})).status()).toBe(200);
  const session=await api.get("/api/auth/get-session").then(r=>r.json());users.push(session.user.id);
  for(const [name,role] of [["Alex","administrator"],["Vicky","administrator"],["Pedro","member"],["Camí","member"]]){
    const {rows:[member]}=await pool.query("INSERT INTO members(family_id,name,role) VALUES($1,$2,$3) RETURNING id",[familyId,name,role]);
    if(name==="Alex"){await pool.query("INSERT INTO member_devices(member_id,auth_user_id) VALUES($1,$2)",[member.id,session.user.id]);}
  }
  await page.context().addCookies((await api.storageState()).cookies);
  await page.setViewportSize({width:360,height:800});
});
test.afterEach(async()=>{
  await api?.dispose();
  try {
    if(familyId){
      for(const table of ["meal_daily_plans","meal_groups","meal_selections","meal_suggestions"]) {
        await pool.query(`DELETE FROM ${table} WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)`,[familyId]);
      }
      await pool.query("DELETE FROM families WHERE id=$1",[familyId]);
    }
    if(users?.length) await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[users]);
  } finally { await pool?.end(); }
});
async function addDish(title:string,menu=1){const state=await api.get("/api/meals/planner").then(r=>r.json());const meal=state.meals.find((m:{date:string;mealType:string})=>m.date===getDayInTimeZone()&&m.mealType==="lunch");const response=await api.put("/api/meals/planner",{headers:{Origin:baseURL},data:{date:meal.date,mealType:"lunch",expectedVersion:meal.version,action:"confirm",menu,title}});expect(response.status()).toBe(200);}

test("360px: blank choices, acknowledged saves, failure/retry, undo and two menus",async({page})=>{
  await page.goto("/menus");
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true}),alex=lunch.getByRole("group",{name:"Preparación para Alex"});
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:/Quiénes comen/}).click();
  await expect(lunch.getByText("Falta indicar",{exact:true})).toHaveCount(5);
  await expect(alex.locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.route("**/api/meals/planner",route=>route.abort("failed"));
  await alex.getByRole("button",{name:"Come en casa",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"Reintentar"})).toBeVisible();
  await expect(alex.getByRole("button",{name:"Come en casa",exact:true})).toHaveAttribute("aria-pressed","false");
  await page.unroute("**/api/meals/planner");await page.getByRole("button",{name:"Reintentar",exact:true}).click();
  await expect(alex.getByRole("button",{name:"Come en casa",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Deshacer",exact:true}).click();
  await expect(alex.locator('[aria-pressed="true"]')).toHaveCount(0);
  await lunch.getByRole("button",{name:"Agregar comida",exact:true}).click();
  let dialog=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await dialog.getByLabel("¿Qué vamos a comer?").fill("Milanesas");
  await dialog.getByRole("button",{name:"Agregar “Milanesas”",exact:true}).click();
  await expect(lunch.getByText("Milanesas",{exact:true}).first()).toBeVisible();
  await lunch.getByRole("button",{name:"Agregar otra opción",exact:true}).click();
  await expect(lunch.getByText("OPCIÓN 2",{exact:true})).toBeVisible();
  const pedro=lunch.getByRole("group",{name:"Preparación para Pedro"});await pedro.getByRole("button",{name:"Se lleva comida",exact:true}).click();
  await expect(lunch.getByLabel("Comida de Pedro",{exact:true})).toBeVisible();
  await lunch.getByLabel("Comida de Pedro",{exact:true}).selectOption("2");
  await expect(page.getByRole("status").filter({hasText:"Comida asignada."})).toBeVisible();
  const optionTwo=lunch.locator("[class*=dailyMenu]").filter({hasText:"OPCIÓN 2"});
  await optionTwo.getByRole("button",{name:"Agregar comida",exact:true}).click();
  dialog=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await dialog.getByLabel("¿Qué vamos a comer?").fill("Ensalada");
  await dialog.getByRole("button",{name:"Agregar “Ensalada”",exact:true}).click();
  await expect(lunch.getByText("Ensalada",{exact:true}).first()).toBeVisible();
  await optionTwo.getByRole("button",{name:"Quitar opción 2",exact:true}).click();
  dialog=page.getByRole("dialog");
  await expect(dialog).toContainText("Pedro");await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();
  await expect(lunch.getByLabel("Comida de Pedro",{exact:true})).toHaveValue("2");
  await optionTwo.getByRole("button",{name:"Quitar opción 2",exact:true}).click();await dialog.getByRole("button",{name:"Quitar y reasignar"}).click();
  await expect(lunch.getByText("OPCIÓN 2",{exact:true})).toHaveCount(0);
  await expect(lunch.getByText("0 en casa · 1 para llevar").first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({path:"test-results/menus-360.png",fullPage:true});
});

test("entry is today/day; dated reload, back/forward and secondary week preserve context",async({page})=>{
  const today=getDayInTimeZone(),future=addDays(today,8);
  await page.goto("/menus");await expect(page.getByRole("button",{name:"Día",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  await page.getByLabel("Ir a una fecha").fill(future);await expect(page).toHaveURL(new RegExp(`fecha=${future}`));
  await page.reload();await expect(page.getByLabel("Ir a una fecha")).toHaveValue(future);
  await page.getByRole("button",{name:"Semana",exact:true}).click();await expect(page.getByRole("region",{name:"Semana, solo lectura"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Proponer idea",exact:true})).toHaveCount(0);
  await page.reload();await expect(page.getByRole("button",{name:"Semana",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.goBack();await expect(page.getByRole("button",{name:"Día",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.goForward();await expect(page.getByRole("button",{name:"Semana",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("link",{name:"Menús",exact:true}).click();await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);await expect(page.getByRole("button",{name:"Día",exact:true})).toHaveAttribute("aria-pressed","true");
});

test("adult conflict keeps the current dish visible before saving a replacement",async({page})=>{
  await addDish("Pasta");await page.goto("/menus");const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:/Quiénes comen/}).click();
  const state=await api.get("/api/meals/planner").then(r=>r.json()),meal=state.meals.find((m:{date:string;mealType:string})=>m.date===getDayInTimeZone()&&m.mealType==="lunch");
  expect((await api.put("/api/meals/planner",{headers:{Origin:baseURL},data:{date:meal.date,mealType:"lunch",expectedVersion:meal.version,action:"confirm",menu:1,title:"Sopa",replace:true}})).status()).toBe(200);
  await lunch.getByRole("button",{name:"Cambiar comida",exact:true}).click();
  let dialog=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await dialog.getByLabel("¿Qué vamos a comer?").fill("Pasta");
  await dialog.getByRole("button",{name:/Agregar.*Pasta/}).click();
  dialog=page.getByRole("dialog",{name:"Cambiar comida",exact:true});
  await dialog.getByRole("button",{name:"Guardar cambio",exact:true}).click();
  await expect(dialog.getByRole("alert").filter({hasText:"Alguien cambió"})).toBeVisible();
  await expect(dialog).toContainText("Sopa");
  await dialog.getByRole("button",{name:"Guardar cambio",exact:true}).click();await expect(dialog).toBeHidden();
  await expect(lunch.getByText("Pasta",{exact:true}).first()).toBeVisible();
});

test("annotating a dish does not add it to the day and it can be reused",async({page})=>{
  await page.goto("/menus");const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:/Quiénes comen/}).click();
  await lunch.getByRole("button",{name:"Agregar comida",exact:true}).click();
  let bank=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await bank.getByLabel("¿Qué vamos a comer?").fill("Puré familiar");
  await bank.getByRole("button",{name:"Anotar para otro día",exact:true}).click();
  const annotation=page.getByRole("dialog",{name:"Anotar para otro día",exact:true});
  await annotation.getByLabel("Nota opcional",{exact:true}).fill("Sin sal");
  await annotation.getByRole("button",{name:"Guardar plato",exact:true}).click();
  bank=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await expect(lunch.getByText("Todavía no elegimos qué comer",{exact:true})).toBeVisible();
  await expect(bank.getByRole("heading",{name:"Agregar comida",exact:true})).toBeVisible();
  await bank.getByLabel("¿Qué vamos a comer?").fill("Puré familiar");
  await bank.getByRole("button",{name:/Agregar.*Puré familiar/}).click();
  await expect(bank).toBeHidden();
  await expect(lunch.getByText("Puré familiar",{exact:true}).first()).toBeVisible();
  await lunch.getByRole("button",{name:"Cambiar comida",exact:true}).click();
  await bank.getByRole("button",{name:"Ver todos los platos",exact:true}).click();
  await bank.getByRole("button",{name:/Editar.*Puré familiar/}).click();
  const edit=page.getByRole("dialog",{name:"Editar plato",exact:true});
  await edit.getByLabel("Nombre",{exact:true}).fill("Puré con calabaza");
  await edit.getByRole("button",{name:"Guardar plato",exact:true}).click();
  bank=page.getByRole("dialog",{name:"Agregar comida",exact:true});
  await expect(bank.getByRole("heading",{name:"Puré con calabaza",exact:true})).toBeVisible();
  await expect(lunch.getByText("Puré familiar",{exact:true}).first()).toBeVisible();
  await bank.getByRole("button",{name:"Cerrar repertorio",exact:true}).click();
  await expect(lunch.getByText("Puré familiar",{exact:true}).first()).toBeVisible();
});

test("back during a pending save cannot replace the selected week's data",async({page})=>{
  const today=getDayInTimeZone(),future=addDays(today,8);
  await page.goto("/menus");await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  await page.getByLabel("Ir a una fecha").fill(future);
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:/Quiénes comen/}).click();
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"})).toBeVisible();
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/meals/planner",async route=>{await blocked;await route.continue();});
  const started=page.waitForRequest(r=>r.method()==="PUT"&&r.url().endsWith("/api/meals/planner"));
  await lunch.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Come en casa",exact:true}).click();
  await started;await page.goBack();
  await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  const saved=page.waitForResponse(r=>r.request().method()==="PUT"&&r.url().endsWith("/api/meals/planner"));release();await saved;
  await expect(lunch.getByRole("button",{name:"Almuerzo",exact:true})).toHaveAttribute("aria-expanded","false");
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:/Quiénes comen/}).click();
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"})).toBeVisible();
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Come en casa",exact:true})).toHaveAttribute("aria-pressed","false");
});

async function updateMeal(date:string,mealType:string,action:Record<string,unknown>) {
  const state=await api.get(`/api/meals/planner?weekStart=${startOfWeek(date)}`).then(r=>r.json());
  const meal=state.meals.find((m:{date:string;mealType:string})=>m.date===date&&m.mealType===mealType);
  const response=await api.put("/api/meals/planner",{headers:{Origin:baseURL},data:{date,mealType,expectedVersion:meal.version,...action}});
  expect(response.status()).toBe(200);
}
async function refetchPlanner(page:Page) {
  const refreshed=page.waitForResponse(r=>r.request().method()==="GET"&&r.url().includes("/api/meals/planner?"));
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await refreshed;
}

test("four collapsed meals expose dishes, completion and long titles on mobile and desktop",async({page})=>{
  const today=getDayInTimeZone();
  await page.goto("/menus");
  await expect(page.getByText("0 de 4 comidas elegidas",{exact:true})).toBeVisible();
  for(const label of ["Desayuno","Almuerzo","Merienda","Cena"]){
    const article=page.getByRole("article",{name:label,exact:true});
    await expect(article.getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-expanded","false");
    await expect(article.getByText("Sin elegir",{exact:true}).first()).toBeVisible();
    await expect(article.getByRole("button",{name:"Agregar comida",exact:true})).toBeHidden();
  }
  await updateMeal(today,"breakfast",{action:"confirm",menu:1,title:"Tostadas"});
  await refetchPlanner(page);
  await expect(page.getByText("1 de 4 comidas elegidas",{exact:true})).toBeVisible();
  const longTitle="Milanesas de berenjena con ensalada de tomates y arroz integral "+"a".repeat(160-"Milanesas de berenjena con ensalada de tomates y arroz integral ".length);
  expect(longTitle.length).toBe(160);
  for(const [mealType,title] of [["lunch",longTitle],["snack","Yogur y fruta"],["dinner","Sopa de verduras"]]) await updateMeal(today,mealType,{action:"confirm",menu:1,title});
  await refetchPlanner(page);
  await expect(page.getByText("4 de 4 comidas elegidas",{exact:true})).toBeVisible();
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await expect(lunch.getByText(longTitle,{exact:true}).first()).toBeVisible();
  for(const width of [360,1280]){
    await page.setViewportSize({width,height:800});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({path:`test-results/menus-compact-${width}.png`,fullPage:true});
  }
  await updateMeal(today,"lunch",{action:"confirm",menu:1,title:"Milanesas con ensalada",replace:true});
  await refetchPlanner(page);
  await page.setViewportSize({width:360,height:800});
  await page.screenshot({path:"test-results/menus-compact-day.png",fullPage:true});
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  await lunch.getByRole("button",{name:"Agregar otra opción",exact:true}).click();
  await expect(lunch.getByText("Falta elegir opción 2",{exact:true})).toBeVisible();
  await expect(page.getByText("3 de 4 comidas elegidas",{exact:true})).toBeVisible();
  const optionTwo=lunch.locator("[class*=dailyMenu]").filter({hasText:"OPCIÓN 2"});
  await optionTwo.getByRole("button",{name:"Quitar opción 2",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Quitar y reasignar"}).click();
  await expect(page.getByText("4 de 4 comidas elegidas",{exact:true})).toBeVisible();
  await expect(lunch.getByRole("button",{name:"Almuerzo",exact:true})).toBeFocused();
  await lunch.getByRole("button",{name:"Quitar comida",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Agregar comida",exact:true}).click();
  await expect(page.getByText("3 de 4 comidas elegidas",{exact:true})).toBeVisible();
});

test("disclosure survives saves, refresh, retry, undo and same-day week view; new dates reset it",async({page})=>{
  await page.goto("/menus");
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  const toggle=lunch.getByRole("button",{name:"Almuerzo",exact:true});
  await toggle.click();
  const people=lunch.getByRole("button",{name:/Quiénes comen/});
  await people.click();
  const home=lunch.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Come en casa",exact:true});
  await home.click();
  await expect(home).toHaveAttribute("aria-pressed","true");
  await expect(people).toHaveAttribute("aria-expanded","true");
  await expect(page.getByText("0 de 4 comidas elegidas",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Deshacer",exact:true}).click();
  await expect(home).toHaveAttribute("aria-pressed","false");
  await page.route("**/api/meals/planner",route=>route.abort("failed"));
  await home.click();
  await expect(page.getByRole("alert").filter({hasText:"El cambio no se guardó"})).toBeVisible();
  await expect(people).toHaveAttribute("aria-expanded","true");
  await page.unroute("**/api/meals/planner");
  await page.getByRole("button",{name:"Reintentar",exact:true}).click();
  await expect(home).toHaveAttribute("aria-pressed","true");
  await refetchPlanner(page);
  await expect(people).toHaveAttribute("aria-expanded","true");
  await toggle.click();await toggle.click();
  await expect(home).toBeVisible();
  await page.getByRole("button",{name:"Semana",exact:true}).click();
  await page.getByRole("button",{name:"Día",exact:true}).click();
  await expect(toggle).toHaveAttribute("aria-expanded","true");
  await expect(people).toHaveAttribute("aria-expanded","true");
  const today=getDayInTimeZone();
  await page.getByLabel("Ir a una fecha").fill(addDays(today,8));
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await page.goBack();
  await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await toggle.click();
  await expect(people).toHaveAttribute("aria-expanded","false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded","false");
});

test("incompatible history preserves three original dishes and past days remain read-only",async({page})=>{
  const today=getDayInTimeZone(),past=addDays(today,-1);
  const state=await api.get("/api/meals/planner").then(r=>r.json());
  const admin=state.members.find((m:{name:string})=>m.name==="Alex");
  for(const day of [today,past]){
    const {rows:[slot]}=await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,$2,'lunch') RETURNING id",[familyId,day]);
    for(let i=0;i<3;i++){
      const {rows:[idea]}=await pool.query("INSERT INTO meal_suggestions(slot_id,author_member_id,title) VALUES($1,$2,$3) RETURNING id",[slot.id,admin.id,`Plato anterior ${i+1}`]);
      await pool.query("INSERT INTO meal_groups(slot_id,kind,name,suggestion_id) VALUES($1,$2,$3,$4)",[slot.id,i===0?"home":"packed",`Grupo ${i}`,idea.id]);
    }
  }
  await updateMeal(today,"dinner",{action:"confirm",menu:1,title:"Cena elegida"});
  await page.goto("/menus");
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await expect(lunch.getByText("Revisar plan anterior",{exact:true})).toBeVisible();
  await expect(page.getByText("1 de 4 comidas elegidas",{exact:true})).toBeVisible();
  await lunch.getByRole("button",{name:"Almuerzo",exact:true}).click();
  for(let i=1;i<=3;i++)await expect(lunch.getByText(`Plato anterior ${i}`,{exact:false})).toBeVisible();
  await expect(lunch.getByRole("button",{name:"Agregar comida",exact:true})).toHaveCount(0);
  const {rows:[pastSlot]}=await pool.query("INSERT INTO meal_slots(family_id,meal_date,meal_type) VALUES($1,$2,'dinner') RETURNING id",[familyId,past]);
  const {rows:[pastIdea]}=await pool.query("INSERT INTO meal_suggestions(slot_id,author_member_id,title) VALUES($1,$2,'Sopa de ayer') RETURNING id",[pastSlot.id,admin.id]);
  await pool.query("INSERT INTO meal_selections(slot_id,suggestion_id,confirmed_by_member_id) VALUES($1,$2,$3)",[pastSlot.id,pastIdea.id,admin.id]);
  await refetchPlanner(page);
  await page.getByLabel("Ir a una fecha").fill(past);
  await expect(page.getByText("1 de 4 comidas elegidas",{exact:true})).toBeVisible();
  const dinner=page.getByRole("article",{name:"Cena",exact:true});
  await dinner.getByRole("button",{name:"Cena",exact:true}).click();
  await expect(dinner.getByText("Sopa de ayer",{exact:true}).first()).toBeVisible();
  await expect(dinner.getByRole("button",{name:"Cambiar comida",exact:true})).toHaveCount(0);
  await expect(dinner.getByRole("button",{name:"Agregar otra opción",exact:true})).toHaveCount(0);
  await dinner.getByRole("button",{name:/Quiénes comen/}).click();
  await expect(dinner.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Come en casa",exact:true})).toBeDisabled();
});
