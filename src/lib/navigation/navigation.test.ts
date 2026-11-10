import assert from "node:assert/strict";
import { test } from "node:test";
import { appCatalog, activeSection } from "./catalog.ts";
import { unifiedUIEnabled } from "./config.ts";
import {
  clearNavigation,
  navigationKey,
  originKey,
  readRecents,
  rememberOrigin,
  rememberRecent,
  validDestination,
} from "./storage.ts";
import { normalizeNavigationSearch } from "./query.ts";
const apps = appCatalog({
  recipes: true,
  library: true,
  sports: true,
  champions: true,
  training: true,
});
class MemoryStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  clear() {
    this.values.clear();
  }
}
test("activation is server-configured and preview requires an exact member match", () => {
  assert.equal(unifiedUIEnabled(null, {}), false);
  assert.equal(unifiedUIEnabled(null, { UNIFIED_UI_ENABLED: "true" }), true);
  assert.equal(
    unifiedUIEnabled("a", { UNIFIED_UI_PREVIEW_MEMBER_IDS: " b, a " }),
    true,
  );
  assert.equal(
    unifiedUIEnabled("ab", { UNIFIED_UI_PREVIEW_MEMBER_IDS: "a" }),
    false,
  );
});
test("catalog order and disabled capabilities", () => {
  assert.deepEqual(
    apps.map((app) => app.id),
    [
      "home",
      "tasks",
      "menus",
      "recipes",
      "shopping",
      "library",
      "sports",
      "training",
      "kitchen",
      "family",
    ],
  );
  const reduced = appCatalog({
    recipes: false,
    library: false,
    sports: true,
    champions: false,
    training: false,
  });
  assert.deepEqual(
    reduced
      .find((app) => app.id === "sports")
      ?.sections.map((section) => section.label),
    ["River", "UFC"],
  );
  assert.equal(validDestination("/recetas/a", reduced), null);
});
test("destinations reject external URLs, unknown routes and malformed paths", () => {
  for (const target of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/api/family",
    "/deportes/unavailable",
    "/compras/a/b",
    "/recetas/a\n",
  ])
    assert.equal(validDestination(target, apps), null, target);
  assert.equal(
    validDestination("/compras/list-1?archived=true", apps),
    "/compras/list-1?archived=true",
  );
});
test("recent views are isolated, deduplicated, limited and checked against enabled apps", () => {
  const storage = new MemoryStorage(),
    key = navigationKey("family", "one"),
    other = navigationKey("family", "two");
  for (const app of apps.filter((app) => !["home", "family"].includes(app.id)))
    rememberRecent(storage, key, apps, { appId: app.id, href: app.href });
  rememberRecent(storage, key, apps, {
    appId: "shopping",
    href: "/compras?archived=true",
  });
  assert.equal(readRecents(storage, key, apps).length, 4);
  assert.deepEqual(readRecents(storage, key, apps)[0], {
    appId: "shopping",
    href: "/compras?archived=true",
  });
  assert.deepEqual(readRecents(storage, other, apps), []);
  assert.equal(
    readRecents(
      storage,
      key,
      apps.filter((app) => app.id !== "shopping"),
    ).some((item) => item.appId === "shopping"),
    false,
  );
  storage.setItem(key, '[{"appId":"shopping","href":"//external.invalid"}]');
  assert.deepEqual(readRecents(storage, key, apps), []);
  storage.setItem(key, "broken");
  assert.deepEqual(readRecents(storage, key, apps), []);
});
test("origins are explicit and cleanup only affects the outgoing profile", () => {
  const local = new MemoryStorage(),
    session = new MemoryStorage(),
    a = navigationKey("f", "a"),
    b = navigationKey("f", "b");
  rememberOrigin(session, a, apps, "/recetas/r", "/menus?fecha=2026-11-10");
  rememberOrigin(session, b, apps, "/recetas/r", "/recetas?q=tarta");
  rememberOrigin(session, a, apps, "/compras", "/compras");
  assert.equal(session.getItem(originKey(a, "/compras")), null);
  assert.equal(
    session.getItem(originKey(a, "/recetas/r")),
    "/menus?fecha=2026-11-10",
  );
  clearNavigation(local, session, a);
  assert.equal(session.getItem(originKey(a, "/recetas/r")), null);
  assert.equal(session.getItem(originKey(b, "/recetas/r")), "/recetas?q=tarta");
});
test("blocked storage does not break navigation", () => {
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  assert.deepEqual(readRecents(blocked, "key", apps), []);
  assert.doesNotThrow(() =>
    rememberRecent(blocked, "key", apps, {
      appId: "shopping",
      href: "/compras",
    }),
  );
  assert.doesNotThrow(() =>
    rememberOrigin(blocked, "key", apps, "/compras/a", "/compras"),
  );
});
test("URL normalization retains supported state, rejects invalid parameters and respects existing library filters", () => {
  assert.equal(
    normalizeNavigationSearch(
      "/tareas",
      new URLSearchParams(
        "fecha=2026-02-30&seccion=historial&estado=completed&cursor=x",
      ),
      apps,
    ),
    "seccion=historial&estado=completed",
  );
  assert.equal(
    normalizeNavigationSearch(
      "/menus",
      new URLSearchParams("fecha=2026-11-10&vista=semana&unknown=x"),
      apps,
    ),
    "fecha=2026-11-10&vista=semana",
  );
  assert.equal(
    normalizeNavigationSearch(
      "/cinemateca",
      new URLSearchParams("q=algo&genre=drama&archived=true"),
      apps,
    ),
    "q=algo&archived=true&genre=drama",
  );
  assert.equal(
    normalizeNavigationSearch(
      "/entrenamiento",
      new URLSearchParams("seccion=historial&detalle=abc&archived=wrong"),
      apps,
    ),
    "seccion=historial&detalle=abc",
  );
  const sports = apps.find((app) => app.id === "sports")!;
  assert.equal(
    activeSection(sports, "/deportes/champions/tabla", new URLSearchParams()),
    2,
  );
});

test("recipe tags remain in normalized URLs and recent views", () => {
  const search = normalizeNavigationSearch("/recetas", new URLSearchParams("q=Tarta&tag=Horno&tag=casera&tag=HORNO&archived=1&unknown=remove"), apps);
  const params = new URLSearchParams(search);
  assert.deepEqual(params.getAll("tag"), ["casera", "horno"]);
  assert.equal(params.get("archived"), "true");
  assert.equal(params.get("q"), "Tarta");
  assert.equal(params.has("unknown"), false);
});

test("training persistent navigation never retains private search terms", () => {
  assert.equal(validDestination("/entrenamiento?fecha=2026-11-10&q=private#q=private", apps), "/entrenamiento?fecha=2026-11-10");
});
