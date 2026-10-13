import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { addDays, getDayInTimeZone } from "../../src/lib/meals/rules";

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
test.afterEach(async()=>{await api?.dispose();if(familyId){await pool.query("DELETE FROM meal_daily_plans WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[familyId]);await pool.query("DELETE FROM meal_suggestions WHERE slot_id IN(SELECT id FROM meal_slots WHERE family_id=$1)",[familyId]);await pool.query("DELETE FROM families WHERE id=$1",[familyId]);}if(users?.length)await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[users]);await pool?.end();});
async function propose(title:string){const state=await api.get("/api/meals/planner").then(r=>r.json());const meal=state.meals.find((m:{date:string;mealType:string})=>m.date===getDayInTimeZone()&&m.mealType==="lunch");const response=await api.put("/api/meals/planner",{headers:{Origin:baseURL},data:{date:meal.date,mealType:"lunch",expectedVersion:meal.version,action:"propose",title}});expect(response.status()).toBe(200);}

test("360px: blank choices, acknowledged saves, failure/retry, undo and two menus",async({page})=>{
  await propose("Milanesas");await propose("Ensalada");
  await page.goto("/menus");
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true}),alex=lunch.getByRole("group",{name:"Preparación para Alex"});
  await expect(lunch.getByText("Falta definir",{exact:true})).toHaveCount(5);
  await expect(alex.locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.route("**/api/meals/planner",route=>route.abort("failed"));
  await alex.getByRole("button",{name:"Está",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"Reintentar"})).toBeVisible();
  await expect(alex.getByRole("button",{name:"Está",exact:true})).toHaveAttribute("aria-pressed","false");
  await page.unroute("**/api/meals/planner");await page.getByRole("button",{name:"Reintentar",exact:true}).click();
  await expect(alex.getByRole("button",{name:"Está",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Deshacer",exact:true}).click();
  await expect(alex.locator('[aria-pressed="true"]')).toHaveCount(0);
  await lunch.locator("[class*='suggestion']").filter({hasText:"Milanesas"}).getByRole("button",{name:"Confirmar",exact:true}).click();
  await expect(lunch.getByText("MENÚ 1 · Confirmado")).toBeVisible();
  await lunch.getByRole("button",{name:"Agregar segundo menú"}).click();
  await expect(lunch.getByText("Menú 2 pendiente de confirmar",{exact:true})).toBeVisible();
  const pedro=lunch.getByRole("group",{name:"Preparación para Pedro"});await pedro.getByRole("button",{name:"Se lleva",exact:true}).click();
  await expect(lunch.getByLabel("Menú de Pedro",{exact:true})).toBeVisible();
  await lunch.getByLabel("Menú de Pedro",{exact:true}).selectOption("2");
  await expect(page.getByRole("status").filter({hasText:"Menú asignado."})).toBeVisible();
  await lunch.locator("[class*='suggestion']").filter({hasText:"Ensalada"}).getByRole("button",{name:"Confirmar",exact:true}).click();
  const dialog=page.getByRole("dialog");await dialog.getByRole("radio",{name:/Menú 2/}).check();await dialog.getByRole("button",{name:"Confirmar",exact:true}).click();
  await expect(lunch.getByText("MENÚ 2 · Confirmado")).toBeVisible();
  await lunch.getByRole("button",{name:"Quitar menú 2",exact:true}).click();
  await expect(dialog).toContainText("Pedro");await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();
  await expect(lunch.getByLabel("Menú de Pedro",{exact:true})).toHaveValue("2");
  await lunch.getByRole("button",{name:"Quitar menú 2",exact:true}).click();await dialog.getByRole("button",{name:"Quitar y reasignar"}).click();
  await expect(lunch.getByText("MENÚ 2 · Confirmado")).toHaveCount(0);
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

test("adult conflict shows current dish before explicit reconfirmation",async({page})=>{
  await propose("Pasta");await page.goto("/menus");const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await expect(lunch.getByRole("button",{name:"Confirmar",exact:true})).toBeVisible();
  const state=await api.get("/api/meals/planner").then(r=>r.json()),meal=state.meals.find((m:{date:string;mealType:string})=>m.date===getDayInTimeZone()&&m.mealType==="lunch");
  expect((await api.put("/api/meals/planner",{headers:{Origin:baseURL},data:{date:meal.date,mealType:"lunch",expectedVersion:meal.version,action:"confirm",menu:1,title:"Sopa"}})).status()).toBe(200);
  await lunch.getByRole("button",{name:"Confirmar",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"Alguien cambió"})).toBeVisible();
  await lunch.getByRole("button",{name:"Cambiar",exact:true}).click();
  await lunch.getByRole("button",{name:"Confirmar",exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toContainText("Sopa");
  await dialog.getByRole("button",{name:"Confirmar reemplazo"}).click();await expect(dialog).toBeHidden();
  await expect(lunch.getByText("Pasta",{exact:true})).toBeVisible();
});

test("saved ideas remain usable and catalog editing does not change confirmed dishes",async({page})=>{
  const created=await api.post("/api/meals/ideas",{headers:{Origin:baseURL},data:{title:"Puré familiar",note:"Sin sal"}});expect(created.status()).toBe(201);
  await page.goto("/menus");const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await lunch.getByRole("button",{name:"Buscar guardadas",exact:true}).click();
  const bank=page.getByRole("dialog",{name:"Banco de ideas",exact:true});
  await bank.getByRole("button",{name:/Elegir.*Puré familiar/}).click();
  await expect(bank).toBeHidden();await expect(lunch.getByText("MENÚ 1 · Confirmado")).toBeVisible();
  await expect(lunch.getByText("Puré familiar",{exact:true})).toBeVisible();
  await lunch.getByRole("button",{name:"Cambiar",exact:true}).click();
  await lunch.getByRole("button",{name:"Buscar guardadas",exact:true}).click();
  await bank.getByRole("button",{name:/Editar.*Puré familiar/}).click();
  await bank.getByLabel("Nombre de la idea",{exact:true}).fill("Puré con calabaza");
  await bank.getByRole("button",{name:"Guardar en banco",exact:true}).click();
  await expect(bank.getByRole("heading",{name:"Puré con calabaza",exact:true})).toBeVisible();
  await bank.getByRole("button",{name:/Archivar.*Puré con calabaza/}).click();
  await expect(bank.getByRole("heading",{name:"Puré con calabaza",exact:true})).toHaveCount(0);
  await bank.getByRole("button",{name:"Cerrar banco de ideas",exact:true}).click();
  await expect(lunch.getByText("Puré familiar",{exact:true})).toBeVisible();
});

test("back during a pending save cannot replace the selected week's data",async({page})=>{
  const today=getDayInTimeZone(),future=addDays(today,8);
  await page.goto("/menus");await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  await page.getByLabel("Ir a una fecha").fill(future);
  const lunch=page.getByRole("article",{name:"Almuerzo",exact:true});
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"})).toBeVisible();
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/meals/planner",async route=>{await blocked;await route.continue();});
  const started=page.waitForRequest(r=>r.method()==="PUT"&&r.url().endsWith("/api/meals/planner"));
  await lunch.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Está",exact:true}).click();
  await started;await page.goBack();
  await expect(page.getByLabel("Ir a una fecha")).toHaveValue(today);
  const saved=page.waitForResponse(r=>r.request().method()==="PUT"&&r.url().endsWith("/api/meals/planner"));release();await saved;
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"})).toBeVisible();
  await expect(lunch.getByRole("group",{name:"Preparación para Alex"}).getByRole("button",{name:"Está",exact:true})).toHaveAttribute("aria-pressed","false");
});
