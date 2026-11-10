"use client";
import { useEffect } from "react";
import { watchTrainingIdentity } from "@/lib/training/drafts";
export default function TrainingIdentity({ scope }: { scope: string }) {
  useEffect(() => watchTrainingIdentity(scope), [scope]);
  return null;
}
