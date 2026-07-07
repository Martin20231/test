# Einkaufs-Tracker Backend

Backend für eine Einkaufs-Tracker-App mit **Node.js**, **Express** und **SQLite**.

Speichert Kassenbons, zeigt Preisentwicklungen einzelner Produkte und vergleicht Preise zwischen verschiedenen Läden.

## Voraussetzungen

- Node.js 18+
- npm

## Installation

```bash
npm install
```

## Server starten

```bash
npm start
```

Für Entwicklung mit automatischem Neustart:

```bash
npm run dev
```

Der Server läuft standardmäßig auf `http://localhost:3000`.

## Datenbank

SQLite-Datei: `data/einkauf.db` (wird beim ersten Start automatisch angelegt).

### Tabellen

| Tabelle | Spalten |
|---------|---------|
| `stores` | id, name |
| `products` | id, name, category |
| `receipts` | id, store_id, date, total_price |
| `receipt_items` | id, receipt_id, product_id, price |

Beim ersten Start werden Beispieldaten angelegt:

- **Läden:** Lidl, REWE
- **Produkte:** Milch, Butter (Kategorie: Milchprodukte)

## API-Endpunkte

### Health-Check

```bash
curl http://localhost:3000/health
```

### Kassenbon speichern

`POST /api/receipts`

```bash
curl -X POST http://localhost:3000/api/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "store_id": 1,
    "date": "2026-07-07",
    "total_price": 5.47,
    "items": [
      { "product_id": 1, "price": 1.09 },
      { "product_id": 2, "price": 2.19 }
    ]
  }'
```

### Preisentwicklung eines Produkts

`GET /api/products/history/:id`

```bash
curl http://localhost:3000/api/products/history/1
```

Gibt alle bekannten Preise für ein Produkt zurück, sortiert nach Datum.

### Preisvergleich zwischen Läden

`GET /api/compare`

```bash
curl http://localhost:3000/api/compare
```

Vergleicht für jedes Produkt die aktuellsten Preise in allen Läden und zeigt, wo es am günstigsten ist.

## Projektstruktur

```
├── server.js           # Express-Server und API-Routen
├── db/
│   └── database.js     # Datenbank-Initialisierung und Verbindung
├── data/
│   └── einkauf.db      # SQLite-Datenbank (wird automatisch erstellt)
└── package.json
```
