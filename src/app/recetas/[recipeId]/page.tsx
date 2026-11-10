import styles from "../recipes.module.css";
import Experience, { getExperience } from "@/components/platform/Experience";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { recipesEnabled } from "@/lib/recipes/config";
import RecipeDetail from "../RecipeDetail";
async function RecipePage({ params }: { params: Promise<{ recipeId: string }> }) { return <RecipeDetail id={(await params).recipeId} />; }

export default async function Page(props: Parameters<typeof RecipePage>[0]) {
 if (!recipesEnabled()) notFound();
 if (!await getMemberContext(await headers())) redirect("/acceso");
 return <Experience><main data-app-frame className={(await getExperience()).enabled ? styles.page : undefined}>{await RecipePage(props)}</main></Experience>;
}
