import type { ComponentType, SVGProps } from "react";
import type { WorkKind } from "@/lib/library/types";

type IconProps = SVGProps<SVGSVGElement>;
type IconComponent = ComponentType<IconProps>;
const shared = { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
const icons: Record<WorkKind, IconComponent> = {
  movie: (props) => <svg {...shared} {...props}><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="13" cy="7" r="1"/><circle cx="7" cy="13" r="1"/><circle cx="13" cy="13" r="1"/><path d="M15.5 14.5c3 0 4.5 2 4.5 4V21h2"/></svg>,
  series: (props) => <svg {...shared} {...props}><rect x="3" y="7" width="18" height="13" rx="2"/><path d="m8 3 4 4 4-4M9 12l6 3-6 3z"/></svg>,
  book: (props) => <svg {...shared} {...props}><path d="M12 6c-2-2-5-3-9-2v14c4-1 7 0 9 2m0-14c2-2 5-3 9-2v14c-4-1-7 0-9 2m0-14v14"/></svg>,
  music: (props) => <svg {...shared} {...props}><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>,
  art: (props) => <svg {...shared} {...props}><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.8 1.8 0 0 1 1.4-3h1.4A4.5 4.5 0 0 0 22 10.2C21 6 17 3 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="16" cy="8" r="1"/></svg>,
  video_game: (props) => <svg {...shared} {...props}><path d="M7 8h10a4 4 0 0 1 3.8 5l-1 3.4a2 2 0 0 1-3.3.9L14 14h-4l-2.5 3.3a2 2 0 0 1-3.3-.9l-1-3.4A4 4 0 0 1 7 8Z"/><path d="M7 10v4m-2-2h4m6-1h.01M18 13h.01"/></svg>,
  tabletop_game: (props) => <svg {...shared} {...props}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/><circle cx="9" cy="8" r=".7"/><circle cx="15" cy="16" r=".7"/></svg>,
};
export default function WorkIcon({ kind, ...props }: IconProps & { kind: WorkKind }) {
  const Icon = icons[kind];
  return <Icon {...props} />;
}
