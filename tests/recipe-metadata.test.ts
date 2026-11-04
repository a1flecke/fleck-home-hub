import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewRecipe } from '../src/lib/server/recipe-preview';

const sourceUrl = 'https://emeals.com/recipes/synthetic-preview';
const recipeHtml = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Recipe",
      "name": "Synthetic Main",
      "recipeYield": "4 servings",
      "totalTime": "PT25M",
      "recipeIngredient": ["1½ cups synthetic rice", "2 Tbsp synthetic oil"],
      "recipeInstructions": ["SECRET INSTRUCTION"],
      "image": "https://emeals.com/secret.jpg"
    },
    {
      "@type": ["Recipe", "NewsArticle"],
      "name": "Synthetic Side",
      "recipeYield": ["2 servings"],
      "prepTime": "PT10M",
      "cookTime": "PT5M",
      "recipeIngredient": ["1 synthetic lemon"]
    }
  ]
}
</script>
<script type="application/ld+json">{ "@type": "WebPage", "name": "Not a recipe", "recipeIngredient": ["ignored"] }</script>
</head><body>Recipe page</body></html>`;

function htmlResponse(body = recipeHtml, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => handler(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('recipe preview fetch', () => {
  it('extracts named groups, yield, time and quantities from JSON-LD', async () => {
    const fetchMock = mockFetch(() => htmlResponse());
    const result = await previewRecipe(sourceUrl);
    expect(result).toMatchObject({
      status: 'ok',
      details: {
        sourceUrl,
        title: 'Synthetic Main',
        yield: '4 servings',
        totalTime: '25 min',
        groups: [
          { name: 'Synthetic Main', lines: ['1½ cups synthetic rice', '2 Tbsp synthetic oil'] },
          { name: 'Synthetic Side', lines: ['1 synthetic lemon'] }
        ]
      }
    });
    expect(JSON.stringify(result)).not.toContain('SECRET INSTRUCTION');
    expect(JSON.stringify(result)).not.toContain('secret.jpg');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [request, init] = fetchMock.mock.calls[0];
    expect(String(request)).toBe(sourceUrl);
    expect(init).toMatchObject({ redirect: 'manual', headers: expect.objectContaining({ accept: expect.stringContaining('text/html') }) });
  });

  it('formats durations and combines prep plus cook time', async () => {
    mockFetch(() => htmlResponse(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Timed', recipeIngredient: ['1 item'], totalTime: 'PT1H30M' })}</script>`));
    expect((await previewRecipe(sourceUrl)).details?.totalTime).toBe('1 hr 30 min');
    vi.unstubAllGlobals();
    mockFetch(() => htmlResponse(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Timed', recipeIngredient: ['1 item'], prepTime: 'PT10M', cookTime: 'PT5M' })}</script>`));
    expect((await previewRecipe(sourceUrl)).details?.totalTime).toBe('15 min');
  });

  it('does not fetch unrelated hosts', async () => {
    const fetchMock = mockFetch(() => htmlResponse());
    const result = await previewRecipe('https://example.test/recipes/synthetic-preview');
    expect(result).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a non-blocking failure for HTTP, content-type and parse errors', async () => {
    mockFetch(() => htmlResponse('nope', 500));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
    vi.unstubAllGlobals();
    mockFetch(() => new Response(recipeHtml, { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
    vi.unstubAllGlobals();
    mockFetch(() => htmlResponse('<html><body>no recipe metadata</body></html>'));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
    vi.unstubAllGlobals();
    mockFetch(() => htmlResponse('<script type="application/ld+json">{not json</script>'));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
  });

  it('rejects redirects to another host and follows approved redirects', async () => {
    const offHost = mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://example.test/evil' } }));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
    expect(offHost).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();

    const onHost = mockFetch(url => url === sourceUrl ? new Response(null, { status: 302, headers: { location: 'https://www.emeals.com/recipes/redirected' } }) : htmlResponse());
    expect((await previewRecipe(sourceUrl)).status).toBe('ok');
    expect(onHost).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized response before reading it', async () => {
    mockFetch(() => new Response('small', { status: 200, headers: { 'content-type': 'text/html', 'content-length': '2000000' } }));
    expect(await previewRecipe(sourceUrl)).toEqual({ status: 'failed' });
  });
});
