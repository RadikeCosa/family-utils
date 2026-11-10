import type { AppId } from "@/lib/navigation/catalog";
const paths: Record<AppId, string> = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  tasks: "m4 6 2 2 3-4M12 6h8M4 13l2 2 3-4m3 2h8M4 20h16",
  menus: "M4 3v7m4-7v7M4 7h4m-2 3v11M18 3c-4 3-4 9 0 9V3Zm0 9v9",
  recipes: "M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3Zm3 0v18m4-13h5m-5 5h5",
  shopping: "m3 3 2 2 3 12h11l2-9H6m4 13h.01M18 21h.01",
  library: "M3 3h18v18H3Zm4 0v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4",
  sports:
    "M8 3h8v8a4 4 0 0 1-8 0Zm0 2H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5m-4 2v6m-4 0h8",
  training: "M3 9v6m3-9v12m12-12v12m3-9v6M6 12h12",
  kitchen: "M5 3h14v18H5Zm3 4h8m-8 4h2m4 0h2m-8 4h2m4 0h2m-8 3h2m4 0h2",
  family:
    "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a3 3 0 0 1 0 6M2 21v-3a6 6 0 0 1 12 0v3m3-7a5 5 0 0 1 5 5v2",
};
export default function AppIcon({ id }: { id: AppId }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[id]} />
    </svg>
  );
}
