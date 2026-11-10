import styles from "./recipes.module.css";
import Experience, { getExperience } from "@/components/platform/Experience";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { recipesEnabled } from "@/lib/recipes/config";
import RecipeList from "./RecipeList";
function RecipesPage() { return <RecipeList />; }

export default async function Page() {
 if (!recipesEnabled()) notFound();
 if (!await getMemberContext(await headers())) redirect("/acceso");
 return <Experience><main data-app-frame className={(await getExperience()).enabled ? styles.page : undefined}>{await RecipesPage()}</main></Experience>;
}
