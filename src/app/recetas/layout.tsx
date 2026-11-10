import { getExperience } from "@/components/platform/Experience";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { recipesEnabled } from "@/lib/recipes/config";
import styles from "./recipes.module.css";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function RecipesLayout({ children }: { children: React.ReactNode }) {
  if (!recipesEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  if ((await getExperience()).enabled) return children;
  return <div className={styles.page}><header data-legacy-chrome className={styles.header}><Link href="/">Family Utils</Link><nav aria-label="Aplicaciones"><Link href="/recetas">Recetas</Link><Link href="/menus">Menús</Link><Link href="/compras">Compras</Link></nav></header>{children}</div>;
}
