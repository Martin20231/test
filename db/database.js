import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PRODUCT_CATALOG, DEFAULT_PRODUCT_IMAGES } from '../catalog/productCatalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'einkauf.db');

let db;

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase() {
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id    INTEGER NOT NULL REFERENCES stores(id),
      date        TEXT NOT NULL,
      total_price REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      price      REAL NOT NULL
    );
  `);

  seedDatabase(db);
  migrateDatabase(db);

  return db;
}

function migrateDatabase(database) {
  const columns = database.prepare('PRAGMA table_info(products)').all();
  const colNames = columns.map((c) => c.name);

  if (!colNames.includes('image_url')) {
    database.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
  }
  if (!colNames.includes('rewe_id')) {
    database.exec('ALTER TABLE products ADD COLUMN rewe_id TEXT');
  }
  if (!colNames.includes('rewe_price')) {
    database.exec('ALTER TABLE products ADD COLUMN rewe_price REAL');
  }
  if (!colNames.includes('grammage')) {
    database.exec('ALTER TABLE products ADD COLUMN grammage TEXT');
  }
  if (!colNames.includes('brand')) {
    database.exec('ALTER TABLE products ADD COLUMN brand TEXT');
  }

  const findByReweId = database.prepare('SELECT id FROM products WHERE rewe_id = ?');
  const findByName = database.prepare('SELECT id FROM products WHERE name = ?');
  const insertProduct = database.prepare(`
    INSERT INTO products (name, category, image_url, rewe_id, rewe_price, grammage, brand)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateProduct = database.prepare(`
    UPDATE products
    SET image_url = ?, category = ?, rewe_id = ?, rewe_price = ?, grammage = ?, brand = ?
    WHERE id = ?
  `);

  for (const product of PRODUCT_CATALOG) {
    const existing =
      (product.rewe_id && findByReweId.get(product.rewe_id)) ||
      findByName.get(product.name);
    if (!existing) {
      insertProduct.run(
        product.name,
        product.category,
        product.image_url,
        product.rewe_id ?? null,
        product.rewe_price ?? null,
        product.grammage ?? null,
        product.brand ?? null
      );
    } else {
      updateProduct.run(
        product.image_url,
        product.category,
        product.rewe_id ?? null,
        product.rewe_price ?? null,
        product.grammage ?? null,
        product.brand ?? null,
        existing.id
      );
    }
  }
}

function seedDatabase(database) {
  const insertStore = database.prepare('INSERT OR IGNORE INTO stores (name) VALUES (?)');
  for (const name of ['Lidl', 'Aldi', 'REWE', 'Netto', 'EDEKA', 'ROSSMANN']) {
    insertStore.run(name);
  }

  const productCount = database.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (productCount === 0) {
    const insertProduct = database.prepare(`
      INSERT INTO products (name, category, image_url, rewe_id, rewe_price, grammage, brand)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const product of PRODUCT_CATALOG) {
      insertProduct.run(
        product.name,
        product.category,
        product.image_url,
        product.rewe_id ?? null,
        product.rewe_price ?? null,
        product.grammage ?? null,
        product.brand ?? null
      );
    }
  }
}
