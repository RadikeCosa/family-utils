import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "@/lib/library/config";
import LibraryApp from "../biblioteca/LibraryApp";
import { readLibraryFilters } from "@/lib/library/filters";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!libraryEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  return <LibraryApp initialFilters={readLibraryFilters(query)} />;
}

export default async function Page(props: Parameters<typeof LibraryPage>[0]) {
  return <Experience>{await LibraryPage(props)}</Experience>;
}
