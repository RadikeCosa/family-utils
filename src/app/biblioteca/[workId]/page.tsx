import { headers } from "next/headers";
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "@/lib/library/config";
import { cinematecaUrl } from "@/lib/library/urls";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function LegacyLibraryPage({ searchParams, params }: { searchParams: Promise<Record<string, string | string[] | undefined>>; params: Promise<{ workId: string }> }) {
  if (!libraryEnabled()) notFound();
  if (!await getMemberContext(await headers())) redirect("/acceso");
  permanentRedirect(cinematecaUrl(await searchParams, (await params).workId));
}
