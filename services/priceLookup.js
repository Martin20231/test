const REWE_SUGGESTIONS_URL = 'https://www.rewe.de/shop/api/suggestions';

const USER_AGENT =
  'Mozilla/5.0 (compatible; EinkaufsTracker/1.0; +https://github.com/Martin20231/test)';

function centsToEuro(cents) {
  return +(cents / 100).toFixed(2);
}

function dedupeByProductId(products) {
  const seen = new Set();
  return products.filter((p) => {
    if (seen.has(p.productId)) return false;
    seen.add(p.productId);
    return true;
  });
}

export async function fetchRewePrices(query, limit = 8) {
  const url = new URL(REWE_SUGGESTIONS_URL);
  url.searchParams.set('q', query);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`REWE-API antwortete mit Status ${res.status}`);
  }

  const data = await res.json();
  const products = dedupeByProductId(data.products ?? []).slice(0, limit);

  return products.map((item) => ({
    store: 'REWE',
    source: 'shop.rewe.de',
    name: item.name,
    brand: item.brand ?? null,
    price: centsToEuro(item.price),
    grammage: item.grammage ?? null,
    product_id: item.productId,
    url: item.url ? `https://www.rewe.de${item.url}` : null,
    tags: item.tags ?? [],
  }));
}

export function findLocalProducts(db, query) {
  const pattern = `%${query.trim()}%`;
  return db
    .prepare(
      `
      SELECT id, name, category
      FROM products
      WHERE name LIKE ? COLLATE NOCASE
         OR category LIKE ? COLLATE NOCASE
      ORDER BY name
      LIMIT 10
    `
    )
    .all(pattern, pattern);
}

export function getLocalPricesForProduct(db, productId) {
  const rows = db
    .prepare(
      `
      SELECT
        s.name AS store_name,
        ri.price,
        r.date AS latest_date
      FROM receipt_items ri
      JOIN receipts r ON r.id = ri.receipt_id
      JOIN stores s ON s.id = r.store_id
      WHERE ri.product_id = ?
      ORDER BY r.date DESC, r.id DESC
    `
    )
    .all(productId);

  const byStore = new Map();
  for (const row of rows) {
    if (!byStore.has(row.store_name)) {
      byStore.set(row.store_name, {
        store_name: row.store_name,
        price: row.price,
        latest_date: row.latest_date,
      });
    }
  }

  return [...byStore.values()];
}

export function buildComparison(localMatches, internetPrices) {
  const comparisons = [];

  for (const local of localMatches) {
    const localStores = local.prices ?? [];
    const localCheapest = localStores.length
      ? localStores.reduce((min, s) => (s.price < min.price ? s : min))
      : null;

    const internetCheapest = internetPrices.length
      ? internetPrices.reduce((min, p) => (p.price < min.price ? p : min))
      : null;

    let verdict = null;
    if (localCheapest && internetCheapest) {
      const diff = localCheapest.price - internetCheapest.price;
      if (Math.abs(diff) < 0.05) {
        verdict = 'Ähnlicher Preis wie REWE Online';
      } else if (diff < 0) {
        verdict = `Dein ${localCheapest.store_name}-Preis ist ${Math.abs(diff).toFixed(2)} € günstiger als REWE Online`;
      } else {
        verdict = `REWE Online ist ${diff.toFixed(2)} € günstiger als dein ${localCheapest.store_name}-Preis`;
      }
    } else if (internetCheapest && !localCheapest) {
      verdict = `REWE Online: ${internetCheapest.price.toFixed(2)} € (keine lokalen Daten)`;
    } else if (localCheapest && !internetCheapest) {
      verdict = `Nur lokale Daten: ab ${localCheapest.price.toFixed(2)} € bei ${localCheapest.store_name}`;
    }

    comparisons.push({
      local_product_id: local.id,
      local_product_name: local.name,
      local_prices: localStores,
      local_cheapest: localCheapest,
      internet_cheapest: internetCheapest,
      verdict,
    });
  }

  if (localMatches.length === 0 && internetPrices.length > 0) {
    const cheapest = internetPrices.reduce((min, p) => (p.price < min.price ? p : min));
    comparisons.push({
      local_product_id: null,
      local_product_name: null,
      local_prices: [],
      local_cheapest: null,
      internet_cheapest: cheapest,
      verdict: `REWE Online ab ${cheapest.price.toFixed(2)} € für „${cheapest.name}"`,
    });
  }

  return comparisons;
}

export async function lookupPrices(db, query, { limit = 8 } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) {
    throw new Error('Suchbegriff (q) ist erforderlich.');
  }

  let internet = [];
  let internetError = null;

  try {
    internet = await fetchRewePrices(trimmed, limit);
  } catch (error) {
    internetError = error.message;
  }

  const localProducts = findLocalProducts(db, trimmed);
  const localMatches = localProducts.map((product) => ({
    ...product,
    prices: getLocalPricesForProduct(db, product.id),
  }));

  const comparisons = buildComparison(localMatches, internet);

  return {
    query: trimmed,
    fetched_at: new Date().toISOString(),
    internet: {
      available: internet.length > 0,
      error: internetError,
      disclaimer:
        'Online-Preise von shop.rewe.de – können von Preisen im Laden abweichen.',
      products: internet,
    },
    local: {
      matches: localMatches,
    },
    comparisons,
  };
}
