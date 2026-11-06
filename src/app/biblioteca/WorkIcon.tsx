import type { ComponentType, SVGProps } from "react";
import type { WorkKind } from "@/lib/library/types";

type IconProps = SVGProps<SVGSVGElement>;
type IconComponent = ComponentType<IconProps>;
const shared = { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
const icons: Record<WorkKind, IconComponent> = {
  movie: (props) => <svg {...shared} {...props}><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="13" cy="7" r="1"/><circle cx="7" cy="13" r="1"/><circle cx="13" cy="13" r="1"/><path d="M15.5 14.5c3 0 4.5 2 4.5 4V21h2"/></svg>,

};
export default function WorkIcon({ kind, ...props }: IconProps & { kind: WorkKind }) {
  const Icon = icons[kind];
  return <Icon {...props} />;
}
