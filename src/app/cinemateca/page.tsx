import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "@/lib/library/config";
import LibraryApp from "../biblioteca/LibraryApp";
import { PERSONAL_STATUSES } from "@/lib/library/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!libraryEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const params = await searchParams;
  const value = (key: string) => Array.isArray(params[key]) ? params[key]![0] ?? "" : params[key] ?? "";
  const view = value("view") === "common_pending" ? "common_pending" : ""; const status = view ? "" : value("status");
  return <LibraryApp initialFilters={{ q: value("q").slice(0, 200), view, status: status === "none" || PERSONAL_STATUSES.includes(status as typeof PERSONAL_STATUSES[number]) ? status : "", archived: value("archived") === "true" ? "true" : "" }} />;
}
