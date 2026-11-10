export type AppId =
  | "home"
  | "tasks"
  | "menus"
  | "recipes"
  | "shopping"
  | "library"
  | "sports"
  | "training"
  | "kitchen"
  | "family";
export type Section = { label: string; href: string };
export type AppDefinition = {
  id: AppId;
  name: string;
  href: string;
  accent: "mint" | "peach" | "lavender";
  sections: Section[];
};
export type Capabilities = {
  recipes: boolean;
  library: boolean;
  sports: boolean;
  champions: boolean;
  training: boolean;
  trainingDiary?: boolean;
};
export function appCatalog(c: Capabilities): AppDefinition[] {
  const apps: AppDefinition[] = [
    { id: "home", name: "Inicio", href: "/", accent: "mint", sections: [] },
    {
      id: "tasks",
      name: "Tareas y rutinas",
      href: "/tareas",
      accent: "lavender",
      sections: [
        { label: "Tareas", href: "/tareas" },
        { label: "Historial", href: "/tareas?seccion=historial" },
      ],
    },
    {
      id: "menus",
      name: "Menús",
      href: "/menus",
      accent: "peach",
      sections: [
        { label: "Día", href: "/menus?vista=dia" },
        { label: "Semana", href: "/menus?vista=semana" },
      ],
    },
    ...(c.recipes
      ? [
          {
            id: "recipes" as const,
            name: "Recetas",
            href: "/recetas",
            accent: "peach" as const,
            sections: [
              { label: "Disponibles", href: "/recetas" },
              { label: "Ocultas", href: "/recetas?archived=true" },
            ],
          },
        ]
      : []),
    {
      id: "shopping",
      name: "Compras",
      href: "/compras",
      accent: "mint",
      sections: [
        { label: "Listas activas", href: "/compras" },
        { label: "Archivadas", href: "/compras?archived=true" },
      ],
    },
    ...(c.library
      ? [
          {
            id: "library" as const,
            name: "Cinemateca",
            href: "/cinemateca",
            accent: "lavender" as const,
            sections: [
              { label: "Colección", href: "/cinemateca" },
              { label: "Archivadas", href: "/cinemateca?archived=true" },
            ],
          },
        ]
      : []),
    ...(c.sports
      ? [
          {
            id: "sports" as const,
            name: "Deportes",
            href: "/deportes",
            accent: "mint" as const,
            sections: [
              { label: "River", href: "/deportes?sport=river" },
              { label: "UFC", href: "/deportes?sport=ufc" },
              ...(c.champions
                ? [{ label: "Champions", href: "/deportes?sport=champions" }]
                : []),
            ],
          },
        ]
      : []),
    ...(c.training
      ? [
          {
            id: "training" as const,
            name: "Entrenamiento",
            href: "/entrenamiento",
            accent: "mint" as const,
            sections: [
              { label: c.trainingDiary ? "Diario" : "Mis rutinas", href: "/entrenamiento" },
              { label: c.trainingDiary ? "Plantillas" : "Historial", href: c.trainingDiary ? "/entrenamiento?seccion=plantillas" : "/entrenamiento?seccion=historial" },
            ],
          },
        ]
      : []),
    {
      id: "kitchen",
      name: "Conversor de cocina",
      href: "/cocina",
      accent: "peach",
      sections: [],
    },
    {
      id: "family",
      name: "Mi familia",
      href: "/familia",
      accent: "mint",
      sections: [],
    },
  ];
  return apps;
}
export function findApp(path: string, apps: AppDefinition[]) {
  return apps.find((app) =>
    app.href === "/"
      ? path === "/"
      : path === app.href || path.startsWith(`${app.href}/`),
  );
}
export function activeSection(
  app: AppDefinition,
  path: string,
  query: URLSearchParams,
) {
  if (app.id === "menus") return query.get("vista") === "semana" ? 1 : 0;
  if (app.id === "training") return ["historial", "plantillas"].includes(query.get("seccion") ?? "") ? 1 : 0;
  if (app.id === "tasks")
    return query.get("seccion") === "historial" ? 1 : 0;
  if (["recipes", "shopping", "library"].includes(app.id))
    return query.get("archived") === "true" ? 1 : 0;
  if (app.id === "sports")
    return path.includes("champions") || query.get("sport") === "champions"
      ? 2
      : path.includes("ufc") || query.get("sport") === "ufc"
        ? 1
        : 0;
  return 0;
}
