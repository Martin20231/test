const STORAGE_KEY = 'einkaufs-tracker-demo';

const SEED = {
  stores: [
    { id: 1, name: 'Lidl' },
    { id: 2, name: 'Aldi' },
    { id: 3, name: 'REWE' },
  ],
  products: [
    { id: 1, name: 'Milch', category: 'Milchprodukte' },
    { id: 2, name: 'Butter', category: 'Milchprodukte' },
    { id: 3, name: 'Brot', category: 'Backwaren' },
    { id: 4, name: 'Eier', category: 'Milchprodukte' },
    { id: 5, name: 'Kaffee', category: 'Getränke' },
  ],
  receipts: [
    {
      id: 1,
      store_id: 1,
      date: '2026-06-15',
      total_price: 3.28,
      items: [
        { id: 1, product_id: 1, price: 1.09 },
        { id: 2, product_id: 2, price: 2.19 },
      ],
    },
    {
      id: 2,
      store_id: 3,
      date: '2026-07-01',
      total_price: 3.38,
      items: [
        { id: 3, product_id: 1, price: 1.19 },
        { id: 4, product_id: 2, price: 2.19 },
      ],
    },
  ],
};

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const data = structuredClone(SEED);
    save(data);
    return data;
  }
  return JSON.parse(raw);
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function storeName(data, storeId) {
  return data.stores.find((s) => s.id === storeId)?.name ?? 'Unbekannt';
}

function productName(data, productId) {
  return data.products.find((p) => p.id === productId)?.name ?? 'Unbekannt';
}

function mockReweProducts(query) {
  const q = query.toLowerCase();
  const samples = [
    { name: 'Hemme Milch Frische Vollmilch 3,7% 1l', price: 1.59, grammage: '1l' },
    { name: 'ja! Natürlich Bio H-Milch 3,8% 1l', price: 1.29, grammage: '1l' },
    { name: 'Kerrygold Butter 250g', price: 2.49, grammage: '250g' },
    { name: 'Vollkornbrot 500g', price: 1.99, grammage: '500g' },
    { name: 'Freilandeier 10 Stück', price: 3.49, grammage: '10 Stk' },
    { name: 'Jacobs Krönung 500g', price: 5.99, grammage: '500g' },
  ];
  return samples
    .filter((s) => s.name.toLowerCase().includes(q) || q.length < 3)
    .slice(0, 6)
    .map((s, i) => ({
      store: 'REWE',
      source: 'shop.rewe.de (Demo)',
      name: s.name,
      brand: null,
      price: s.price,
      grammage: s.grammage,
      product_id: `demo-${i}`,
      url: null,
      tags: [],
    }));
}

export function isDemoMode() {
  return true;
}

export async function demoApi(path, options = {}) {
  await new Promise((r) => setTimeout(r, 150));
  const data = load();
  const method = (options.method || 'GET').toUpperCase();

  if (path === '/stores' && method === 'GET') {
    return { stores: data.stores };
  }

  if (path === '/products' && method === 'GET') {
    return { products: data.products };
  }

  if (path.startsWith('/products/history/') && method === 'GET') {
    const productId = Number(path.split('/').pop());
    const product = data.products.find((p) => p.id === productId);
    if (!product) throw new Error(`Produkt mit ID ${productId} nicht gefunden.`);

    const history = [];
    for (const receipt of data.receipts) {
      for (const item of receipt.items) {
        if (item.product_id === productId) {
          history.push({
            date: receipt.date,
            price: item.price,
            store_id: receipt.store_id,
            store_name: storeName(data, receipt.store_id),
            receipt_id: receipt.id,
          });
        }
      }
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    return { product_id: product.id, product_name: product.name, history };
  }

  if (path.startsWith('/prices/lookup') && method === 'GET') {
    const query = new URLSearchParams(path.split('?')[1] || '').get('q') || '';
    const internet = mockReweProducts(query);
    const pattern = query.toLowerCase();
    const localMatches = data.products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(pattern) ||
          p.category.toLowerCase().includes(pattern)
      )
      .map((product) => {
        const prices = [];
        const seen = new Set();
        for (const receipt of [...data.receipts].reverse()) {
          const store = storeName(data, receipt.store_id);
          if (seen.has(store)) continue;
          const item = receipt.items.find((i) => i.product_id === product.id);
          if (item) {
            seen.add(store);
            prices.push({ store_name: store, price: item.price, latest_date: receipt.date });
          }
        }
        return { ...product, prices };
      });

    const comparisons = localMatches.map((local) => {
      const localCheapest = local.prices.length
        ? local.prices.reduce((min, s) => (s.price < min.price ? s : min))
        : null;
      const internetCheapest = internet.length
        ? internet.reduce((min, p) => (p.price < min.price ? p : min))
        : null;
      let verdict = null;
      if (localCheapest && internetCheapest) {
        const diff = localCheapest.price - internetCheapest.price;
        if (Math.abs(diff) < 0.05) verdict = 'Ähnlicher Preis wie REWE Online (Demo)';
        else if (diff < 0)
          verdict = `Dein ${localCheapest.store_name}-Preis ist ${Math.abs(diff).toFixed(2)} € günstiger`;
        else
          verdict = `REWE Online ist ${diff.toFixed(2)} € günstiger (Demo-Daten)`;
      }
      return {
        local_product_id: local.id,
        local_product_name: local.name,
        local_prices: local.prices,
        local_cheapest: localCheapest,
        internet_cheapest: internetCheapest,
        verdict,
      };
    });

    return {
      query,
      fetched_at: new Date().toISOString(),
      internet: {
        available: internet.length > 0,
        error: null,
        disclaimer: 'Demo-Modus: Beispiel-Preise. Für echte REWE-Preise Backend nutzen.',
        products: internet,
      },
      local: { matches: localMatches },
      comparisons,
    };
  }

  if (path === '/compare' && method === 'GET') {
    const comparisons = data.products.map((product) => {
      const stores = [];
      const seen = new Set();
      for (const receipt of [...data.receipts].reverse()) {
        const sName = storeName(data, receipt.store_id);
        if (seen.has(sName)) continue;
        const item = receipt.items.find((i) => i.product_id === product.id);
        if (item) {
          seen.add(sName);
          stores.push({
            store_id: receipt.store_id,
            store_name: sName,
            latest_price: item.price,
            latest_date: receipt.date,
          });
        }
      }
      const cheapest = stores.length
        ? stores.reduce((min, s) => (s.latest_price < min.latest_price ? s : min))
        : null;
      return {
        product_id: product.id,
        product_name: product.name,
        category: product.category,
        cheapest_store: cheapest?.store_name ?? null,
        cheapest_price: cheapest?.latest_price ?? null,
        stores,
      };
    });
    return { comparisons };
  }

  if (path === '/receipts' && method === 'POST') {
    const body = JSON.parse(options.body);
    const nextId = Math.max(0, ...data.receipts.map((r) => r.id)) + 1;
    let itemId = Math.max(0, ...data.receipts.flatMap((r) => r.items.map((i) => i.id))) + 1;
    const items = body.items.map((item) => ({
      id: itemId++,
      product_id: item.product_id,
      price: item.price,
    }));
    const receipt = {
      id: nextId,
      store_id: body.store_id,
      date: body.date,
      total_price: body.total_price,
      items,
    };
    data.receipts.push(receipt);
    save(data);
    return receipt;
  }

  throw new Error(`Demo-API: ${method} ${path} nicht unterstützt.`);
}
