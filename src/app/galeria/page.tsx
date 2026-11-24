import Experience from "@/components/platform/Experience";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getMemberContext } from "@/lib/auth/context";
import { galleryEnabled } from "@/lib/gallery/config";
import GalleryApp from "./GalleryApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GalleryPage() {
  if (!galleryEnabled()) notFound();
  const actor = await getMemberContext(await headers());
  if (!actor) redirect("/acceso");
  return <GalleryApp currentMemberId={actor.memberId} canManageAll={actor.role === "administrator"} />;
}

export default async function Page() {
  return <Experience>{await GalleryPage()}</Experience>;
}
