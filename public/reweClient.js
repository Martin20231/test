const REWE_SUGGESTIONS = 'https://www.rewe.de/shop/api/suggestions';

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

function parseReweResponse(data, limit = 8) {
  return dedupeByProductId(data.products ?? [])
    .slice(0, limit)
    .map((item) => ({
      store: 'REWE',
      source: 'shop.rewe.de',
      name: item.name,
      brand: item.brand ?? null,
      price: centsToEuro(item.price),
      grammage: item.grammage ?? null,
      product_id: item.productId,
      image_url: item.image ?? null,
      url: item.url ? `https://www.rewe.de${item.url}` : null,
      tags: item.tags ?? [],
    }));
}

/**
 * Holt echte REWE-Preise – zuerst direkt, sonst über CORS-Proxy (GitHub Pages).
 */
export async function fetchRewePricesBrowser(query, limit = 8) {
  const target = `${REWE_SUGGESTIONS}?q=${encodeURIComponent(query)}`;

  try {
    const direct = await fetch(target, {
      headers: { Accept: 'application/json' },
      mode: 'cors',
    });
    if (direct.ok) {
      const data = await direct.json();
      const products = parseReweResponse(data, limit);
      if (products.length) return { products, live: true };
    }
  } catch {
    // CORS blockiert → Proxy
  }

  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(target)}`;
  const proxied = await fetch(proxyUrl);
  if (!proxied.ok) {
    throw new Error('REWE-Preise konnten nicht geladen werden.');
  }

  const data = await proxied.json();
  const products = parseReweResponse(data, limit);
  if (!products.length) {
    throw new Error('Keine REWE-Produkte gefunden.');
  }

  return { products, live: true };
}
