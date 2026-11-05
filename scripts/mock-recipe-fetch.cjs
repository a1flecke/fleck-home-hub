// E2E-only network fixture. This file is loaded with `node --require` by the
// isolated Playwright server so preview tests never contact the public internet.
const realFetch = globalThis.fetch;

const previewHtml = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Recipe",
      "name": "Synthetic Preview Bowl",
      "recipeYield": "4 servings",
      "totalTime": "PT25M",
      "recipeIngredient": ["1½ cups synthetic rice", "2 Tbsp synthetic oil"],
      "recipeInstructions": ["SECRET PREVIEW INSTRUCTION"],
      "image": "https://emeals.com/secret-preview.jpg"
    },
    {
      "@type": ["Recipe", "NewsArticle"],
      "name": "Synthetic Side Salad",
      "recipeYield": "2 servings",
      "prepTime": "PT10M",
      "cookTime": "PT5M",
      "recipeIngredient": ["1 synthetic lemon"]
    }
  ]
}
</script>
</head><body>Recipe page</body></html>`;

if (process.env.E2E_RECIPE_FIXTURE === '1') {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://emeals.com/recipes/synthetic-preview') {
      return new Response(previewHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url === 'https://emeals.com/recipes/synthetic-preview-failure') {
      return new Response('Synthetic preview unavailable', { status: 503, headers: { 'content-type': 'text/html' } });
    }
    if (url.startsWith('https://emeals.com/')) return new Response('Synthetic fixture not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return realFetch(input, init);
  };
}
