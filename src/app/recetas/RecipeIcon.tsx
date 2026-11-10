import type { ReactNode } from "react";
type Name = "book" | "plus" | "search" | "filters" | "arrow" | "close" | "tag" | "bowl";
const paths: Record<Name, ReactNode> = {
  book: <><path d="M12 6.5C9.5 4.8 6.2 4.5 3 5v14c3.2-.5 6.5-.2 9 1.5 2.5-1.7 5.8-2 9-1.5V5c-3.2-.5-6.5-.2-9 1.5Z" /><path d="M12 6.5v14M6 9h3M6 12h3M15 9h3M15 12h3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></>,
  filters: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  arrow: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  tag: <><path d="M3.5 4h7l10 10-7 7-10-10V4Z" /><circle cx="8" cy="8.5" r="1" /></>,
  bowl: <><path d="M3 12h18a9 9 0 0 1-18 0ZM7 21h10M8 8c-2-2 2-3 0-5M13 8c-2-2 2-3 0-5M18 8c-2-2 2-3 0-5" /></>,
};
export default function RecipeIcon({ name, className }: { name: Name; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
