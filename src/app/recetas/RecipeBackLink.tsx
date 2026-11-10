"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { catalogOrigin } from "./catalog-memory";
type Origin = NonNullable<typeof catalogOrigin.current>;
export default function RecipeBackLink({ recipeId }: { recipeId: string }) {
  const router = useRouter(), [origin, setOrigin] = useState<Origin | null>(null);
  useEffect(() => {
    let live = true;
    const pending = catalogOrigin.current;
    const saved: Origin | undefined = window.history.state?.recipeReturn;
    const from = pending?.pending && pending.recipeId === recipeId ? pending : saved?.recipeId === recipeId ? saved : null;
    if (from) {
      from.pending = false;
      window.history.replaceState({ ...window.history.state, recipeReturn: from }, "");
    }
    queueMicrotask(() => { if (live) setOrigin(from); });
    return () => { live = false; };
  }, [recipeId]);
  return <Link href={origin?.href ?? "/recetas"} onClick={event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && origin) {
      event.preventDefault(); router.back();
    }
  }}>Volver a Recetas</Link>;
}
