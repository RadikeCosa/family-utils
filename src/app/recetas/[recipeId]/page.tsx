import RecipeDetail from "../RecipeDetail";
export default async function RecipePage({ params }: { params: Promise<{ recipeId: string }> }) { return <RecipeDetail id={(await params).recipeId} />; }
