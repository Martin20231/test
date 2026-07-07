import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      category TEXT NOT NULL
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

  return db;
}

function seedDatabase(database) {
  const insertStore = database.prepare('INSERT OR IGNORE INTO stores (name) VALUES (?)');
  for (const name of ['Lidl', 'Aldi', 'REWE']) {
    insertStore.run(name);
  }

  const productCount = database.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (productCount === 0) {
    const insertProduct = database.prepare(
      'INSERT INTO products (name, category) VALUES (?, ?)'
    );
    const products = [
      ['Milch', 'Milchprodukte'],
      ['Butter', 'Milchprodukte'],
      ['Brot', 'Backwaren'],
      ['Eier', 'Milchprodukte'],
      ['Kaffee', 'Getränke'],
    ];
    for (const [name, category] of products) {
      insertProduct.run(name, category);
    }
  }
}
