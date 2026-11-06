import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "@/lib/library/config";
import LibraryApp from "../biblioteca/LibraryApp";
import { readLibraryFilters } from "@/lib/library/filters";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!libraryEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, Array.isArray(value) ? value[0] ?? "" : value);
  return <LibraryApp initialFilters={readLibraryFilters(query)} />;
}
