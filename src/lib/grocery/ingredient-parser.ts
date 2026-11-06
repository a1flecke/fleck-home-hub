export type ParsedIngredient = {
  original: string;
  name: string;
  quantity: string;
  unit: string;
  needsReview: boolean;
};

const whitespace = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const unicodeFraction = '¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
const unicodeFractionPattern = `[${unicodeFraction}]`;
const quantityPattern = new RegExp(
  `^(?:\\d+\\s*${unicodeFractionPattern}|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|${unicodeFractionPattern})(?=\\s|$)`
);

/** Units that can be separated without guessing. Ambiguous package words are excluded on purpose. */
const units = new Set([
  'tsp', 'teaspoon', 'teaspoons',
  'tbsp', 'tablespoon', 'tablespoons',
  'cup', 'cups',
  'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds',
  'g', 'gram', 'grams',
  'kg', 'kilogram', 'kilograms',
  'ml', 'milliliter', 'milliliters',
  'l', 'liter', 'liters',
  'can', 'cans',
  'clove', 'cloves',
  'slice', 'slices',
  'pinch', 'pinches',
  'quart', 'quarts',
  'pint', 'pints',
  'gallon', 'gallons',
  'bunch', 'bunches',
  'handful', 'handfuls'
]);

/**
 * Unit-like package or cut words. A line that uses one stays whole so a reviewer can decide
 * whether it is a measurement, a package size or part of the item name.
 */
const ambiguousUnits = new Set([
  'pkg', 'pkgs', 'package', 'packages',
  'packet', 'packets',
  'box', 'boxes',
  'bag', 'bags',
  'bottle', 'bottles',
  'jar', 'jars',
  'container', 'containers',
  'tub', 'tubs',
  'pouch', 'pouches',
  'sleeve', 'sleeves',
  'loaf', 'loaves',
  'head', 'heads',
  'stalk', 'stalks',
  'sprig', 'sprigs',
  'piece', 'pieces',
  'strip', 'strips',
  'cube', 'cubes',
  'dash', 'dashes',
  'drop', 'drops',
  'knob', 'knobs',
  'fillet', 'fillets',
  'breast', 'breasts',
  'thigh', 'thighs',
  'wing', 'wings',
  'tb', 'tbs'
]);

const approximatePrefix = /^(?:about|approx\.?|approximately|roughly|around|nearly|scant|heaping|generous)\s+/i;
const rangePrefix = /^\d+(?:\.\d+)?\s*(?:[-–—]|to)\s*\d/i;

function normalizeWhitespace(value: string): string {
  return value.replace(whitespace, ' ').trim();
}

function uncertain(original: string, text: string): ParsedIngredient {
  return { original, name: text, quantity: '', unit: '', needsReview: true };
}

/**
 * Separation is deliberately conservative. If a number cannot be separated from an
 * unambiguous unit or counted item, the complete line is returned for review.
 */
export function parseIngredientLine(value: string): ParsedIngredient {
  const original = value.trim();
  const text = normalizeWhitespace(original);
  if (!text) return { original, name: '', quantity: '', unit: '', needsReview: false };

  if (text.includes('(') || text.includes(')')) return uncertain(original, text);
  if (rangePrefix.test(text)) return uncertain(original, text);
  if (/^\d+(?:\.\d+)?\s*\+/.test(text) || /^\d+\s+or\s+\d+/i.test(text)) return uncertain(original, text);
  if (/^~\s*\d/.test(text) || approximatePrefix.test(text)) return uncertain(original, text);

  const match = text.match(quantityPattern);
  if (!match) {
    const uncertainNumber = /^\d/.test(text) && !/^\d+\s*%/.test(text) && !/^\d+-/.test(text);
    return uncertainNumber ? uncertain(original, text) : { original, name: text, quantity: '', unit: '', needsReview: false };
  }

  const quantity = match[0];
  const rest = text.slice(quantity.length).trim();
  if (!rest) return uncertain(original, text);

  const [first, ...remaining] = rest.split(' ');
  const firstKey = first.toLowerCase().replace(/\.$/, '');

  if (units.has(firstKey)) {
    const name = remaining.join(' ').replace(/^of\s+/i, '').trim();
    if (!name) return uncertain(original, text);
    return { original, name, quantity, unit: first, needsReview: false };
  }

  if (ambiguousUnits.has(firstKey) || /^[a-z]\.?$/i.test(first)) return uncertain(original, text);

  return { original, name: rest.replace(/^of\s+/i, '').trim(), quantity, unit: '', needsReview: false };
}

export function parseIngredientLines(value: string): ParsedIngredient[] {
  return value.split(/\r?\n/).map(parseIngredientLine).filter(item => item.original);
}
