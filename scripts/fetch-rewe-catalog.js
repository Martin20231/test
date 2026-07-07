/**
 * Holt Produkte von shop.rewe.de und schreibt productCatalog.js
 * Ausführung: node scripts/fetch-rewe-catalog.js
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REWE_API = 'https://www.rewe.de/shop/api/suggestions';

const CATEGORY_QUERIES = {
  Milchprodukte: [
    'milch', 'butter', 'käse', 'joghurt', 'quark', 'sahne', 'eier', 'margarine',
    'schmand', 'creme fraiche', 'mozzarella', 'gouda', 'emmentaler', 'feta',
    'parmesan', 'frischkäse', 'hüttenkäse', 'skyr', 'kefir', 'buttermilch',
  ],
  Backwaren: [
    'brot', 'brötchen', 'toast', 'croissant', 'baguette', 'kuchen', 'muffin',
    'laugenbrezel', 'knäckebrot', 'zwieback', 'wrap', 'tortilla', 'pizza teig',
  ],
  Getränke: [
    'wasser', 'saft', 'cola', 'bier', 'wein', 'kaffee', 'tee', 'limonade',
    'energy drink', 'smoothie', 'kakao', 'sprudel', 'mineralwasser', 'apfelschorle',
    'orangensaft', 'multivitamin', 'eistee', 'prosecco', 'sekt', 'whisky',
  ],
  'Obst & Gemüse': [
    'apfel', 'banane', 'tomate', 'gurke', 'kartoffel', 'zwiebel', 'salat',
    'paprika', 'möhre', 'brokkoli', 'spinat', 'zitrone', 'orange', 'erdbeere',
    'traube', 'avocado', 'champignon', 'knoblauch', 'ingwer', 'mango',
  ],
  'Fleisch & Fisch': [
    'hähnchen', 'rind', 'schwein', 'wurst', 'schinken', 'salami', 'hackfleisch',
    'lachs', 'thunfisch', 'forelle', 'garnelen', 'pute', 'steak', 'bratwurst',
    'leberwurst', 'speck', 'minced meat', 'fisch', 'meeresfrüchte',
  ],
  Grundnahrungsmittel: [
    'nudeln', 'reis', 'mehl', 'zucker', 'öl', 'essig', 'salz', 'pfeffer',
    'tomatenmark', 'ketchup', 'senf', 'mayonnaise', 'honig', 'marmelade',
    'müsli', 'cornflakes', 'haferflocken', 'linsen', 'bohnen', 'nüsse',
    'nutella', 'erdnussbutter', 'reiswaffeln', 'couscous', 'bulgur', 'sojasauce',
  ],
  Tiefkühl: [
    'tiefkühl', 'eis', 'pizza tiefkühl', 'pommes', 'gemüse tiefkühl', 'fischstäbchen',
    'nuggets', 'lasagne tiefkühl', 'spinat tiefkühl', 'beeren tiefkühl',
  ],
  Süßigkeiten: [
    'schokolade', 'chips', 'kekse', 'gummibärchen', 'bonbons', 'riegel',
    'pralinen', 'lakritz', 'popcorn', 'nussriegel', 'schokoriegel',
  ],
  'Haushalt & Drogerie': [
    'spülmittel', 'waschmittel', 'toilettenpapier', 'küchenrolle', 'müllbeutel',
    'shampoo', 'duschgel', 'zahnpasta', 'seife', 'deo', 'spülbürste',
    'alufolie', 'frischhaltefolie', 'feuchttücher', 'windeln',
  ],
};

function centsToEuro(cents) {
  return +(cents / 100).toFixed(2);
}

async function fetchSuggestions(query) {
  const url = `${REWE_API}?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.products ?? [];
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const seen = new Map();

  for (const [category, queries] of Object.entries(CATEGORY_QUERIES)) {
    for (const query of queries) {
      const products = await fetchSuggestions(query);
      for (const p of products) {
        if (seen.has(p.productId)) continue;
        seen.set(p.productId, {
          name: p.name,
          category,
          image_url: p.image ?? null,
          rewe_id: p.productId,
          rewe_price: centsToEuro(p.price),
          grammage: p.grammage ?? null,
          brand: p.brand ?? null,
        });
      }
      await sleep(120);
      process.stdout.write(`\r${seen.size} Produkte… (${category}: ${query})   `);
    }
  }

  const catalog = Array.from(seen.values()).sort((a, b) => {
    const cat = a.category.localeCompare(b.category, 'de');
    return cat !== 0 ? cat : a.name.localeCompare(b.name, 'de');
  });

  console.log(`\nGesamt: ${catalog.length} REWE-Produkte`);

  const content = `export const PRODUCT_CATALOG = ${JSON.stringify(catalog, null, 2)};

export const DEFAULT_PRODUCT_IMAGES = Object.fromEntries(
  PRODUCT_CATALOG.map((p) => [p.name, p.image_url]).filter(([, u]) => u)
);
`;

  const targets = [
    join(__dirname, '../catalog/productCatalog.js'),
    join(__dirname, '../public/productCatalog.js'),
  ];

  for (const target of targets) {
    writeFileSync(target, content, 'utf8');
    console.log('Geschrieben:', target);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
