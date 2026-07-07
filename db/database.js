import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PRODUCT_IMAGES } from '../services/productImages.js';

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
  if (!columns.some((c) => c.name === 'image_url')) {
    database.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
  }

  const updateImage = database.prepare(
    'UPDATE products SET image_url = ? WHERE name = ? AND (image_url IS NULL OR image_url = \'\')'
  );
  for (const [name, url] of Object.entries(DEFAULT_PRODUCT_IMAGES)) {
    updateImage.run(url, name);
  }
}

function seedDatabase(database) {
  const insertStore = database.prepare('INSERT OR IGNORE INTO stores (name) VALUES (?)');
  for (const name of ['Lidl', 'Aldi', 'REWE']) {
    insertStore.run(name);
  }

  const productCount = database.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (productCount === 0) {
    const insertProduct = database.prepare(
      'INSERT INTO products (name, category, image_url) VALUES (?, ?, ?)'
    );
    const products = [
      ['Milch', 'Milchprodukte', DEFAULT_PRODUCT_IMAGES.Milch],
      ['Butter', 'Milchprodukte', DEFAULT_PRODUCT_IMAGES.Butter],
      ['Brot', 'Backwaren', DEFAULT_PRODUCT_IMAGES.Brot],
      ['Eier', 'Milchprodukte', DEFAULT_PRODUCT_IMAGES.Eier],
      ['Kaffee', 'Getränke', DEFAULT_PRODUCT_IMAGES.Kaffee],
    ];
    for (const [name, category, imageUrl] of products) {
      insertProduct.run(name, category, imageUrl);
    }
  }
}
