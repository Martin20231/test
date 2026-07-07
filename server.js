import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, initDatabase } from './db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

initDatabase();

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/stores', (_req, res, next) => {
  try {
    const stores = getDb().prepare('SELECT id, name FROM stores ORDER BY name').all();
    res.json({ stores });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', (_req, res, next) => {
  try {
    const products = getDb()
      .prepare('SELECT id, name, category FROM products ORDER BY name')
      .all();
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

app.post('/api/receipts', (req, res, next) => {
  try {
    const { store_id, date, total_price, items } = req.body;

    if (store_id == null || !date || total_price == null) {
      return res.status(400).json({
        error: 'store_id, date und total_price sind Pflichtfelder.',
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'items muss ein nicht-leeres Array sein.',
      });
    }

    for (const item of items) {
      if (item.product_id == null || item.price == null) {
        return res.status(400).json({
          error: 'Jedes Item benötigt product_id und price.',
        });
      }
      if (typeof item.price !== 'number' || item.price <= 0) {
        return res.status(400).json({
          error: 'Der Preis muss eine Zahl größer als 0 sein.',
        });
      }
    }

    const db = getDb();

    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(store_id);
    if (!store) {
      return res.status(400).json({ error: `Store mit ID ${store_id} existiert nicht.` });
    }

    for (const item of items) {
      const product = db
        .prepare('SELECT id FROM products WHERE id = ?')
        .get(item.product_id);
      if (!product) {
        return res.status(400).json({
          error: `Produkt mit ID ${item.product_id} existiert nicht.`,
        });
      }
    }

    const insertReceipt = db.prepare(`
      INSERT INTO receipts (store_id, date, total_price)
      VALUES (?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO receipt_items (receipt_id, product_id, price)
      VALUES (?, ?, ?)
    `);

    const createReceipt = db.transaction(() => {
      const result = insertReceipt.run(store_id, date, total_price);
      const receiptId = result.lastInsertRowid;

      const savedItems = items.map((item) => {
        const itemResult = insertItem.run(receiptId, item.product_id, item.price);
        return {
          id: itemResult.lastInsertRowid,
          product_id: item.product_id,
          price: item.price,
        };
      });

      return {
        id: receiptId,
        store_id,
        date,
        total_price,
        items: savedItems,
      };
    });

    const receipt = createReceipt();
    res.status(201).json(receipt);
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/history/:id', (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Ungültige Produkt-ID.' });
    }

    const db = getDb();

    const product = db
      .prepare('SELECT id, name FROM products WHERE id = ?')
      .get(productId);

    if (!product) {
      return res.status(404).json({ error: `Produkt mit ID ${productId} nicht gefunden.` });
    }

    const history = db
      .prepare(`
        SELECT
          r.date,
          ri.price,
          r.store_id,
          s.name AS store_name,
          r.id AS receipt_id
        FROM receipt_items ri
        JOIN receipts r ON r.id = ri.receipt_id
        JOIN stores s ON s.id = r.store_id
        WHERE ri.product_id = ?
        ORDER BY r.date ASC, r.id ASC
      `)
      .all(productId);

    res.json({
      product_id: product.id,
      product_name: product.name,
      history,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/compare', (_req, res, next) => {
  try {
    const db = getDb();

    const latestPrices = db
      .prepare(`
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.category,
          s.id AS store_id,
          s.name AS store_name,
          (
            SELECT ri.price
            FROM receipt_items ri
            JOIN receipts r ON r.id = ri.receipt_id
            WHERE ri.product_id = p.id AND r.store_id = s.id
            ORDER BY r.date DESC, r.id DESC
            LIMIT 1
          ) AS latest_price,
          (
            SELECT r.date
            FROM receipt_items ri
            JOIN receipts r ON r.id = ri.receipt_id
            WHERE ri.product_id = p.id AND r.store_id = s.id
            ORDER BY r.date DESC, r.id DESC
            LIMIT 1
          ) AS latest_date
        FROM products p
        CROSS JOIN stores s
        ORDER BY p.id, s.id
      `)
      .all();

    const productsMap = new Map();

    for (const row of latestPrices) {
      if (!productsMap.has(row.product_id)) {
        productsMap.set(row.product_id, {
          product_id: row.product_id,
          product_name: row.product_name,
          category: row.category,
          stores: [],
        });
      }

      if (row.latest_price != null) {
        productsMap.get(row.product_id).stores.push({
          store_id: row.store_id,
          store_name: row.store_name,
          latest_price: row.latest_price,
          latest_date: row.latest_date,
        });
      }
    }

    const comparisons = Array.from(productsMap.values()).map((product) => {
      if (product.stores.length === 0) {
        return {
          ...product,
          cheapest_store: null,
          cheapest_price: null,
        };
      }

      const cheapest = product.stores.reduce((min, store) =>
        store.latest_price < min.latest_price ? store : min
      );

      return {
        product_id: product.product_id,
        product_name: product.product_name,
        category: product.category,
        cheapest_store: cheapest.store_name,
        cheapest_price: cheapest.latest_price,
        stores: product.stores,
      };
    });

    res.json({ comparisons });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

app.listen(PORT, () => {
  console.log(`Einkaufs-Tracker Backend läuft auf http://localhost:${PORT}`);
});
