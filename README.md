# Einkaufs-Tracker

Fullstack Einkaufs-Tracker-App mit **Node.js**, **Express**, **SQLite** und einem modernen **Frontend** (Tailwind CSS, Chart.js).

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

Der Server läuft standardmäßig auf `http://localhost:3000`. Das Frontend ist unter derselben URL erreichbar.

## Online über GitHub Pages

GitHub Pages hostet **nur das Frontend** (HTML/CSS/JS). Das Backend (Node.js + SQLite) muss separat laufen – z.B. kostenlos auf [Render.com](https://render.com).

### Schritt 1: PR mergen

Merge den Pull Request auf GitHub in den `main`-Branch.

### Schritt 2: GitHub Pages aktivieren

1. Öffne dein Repo auf GitHub: https://github.com/Martin20231/test
2. Gehe zu **Settings** → **Pages**
3. Unter **Build and deployment** → **Source** wähle: **GitHub Actions**
4. Nach dem nächsten Push auf `main` wird die Seite automatisch deployed

### Schritt 3: Webseite aufrufen

Deine App ist dann erreichbar unter:

**https://martin20231.github.io/test/**

### Schritt 4: Backend hosten (für volle Funktion)

Ohne Backend siehst du die Oberfläche, aber API-Aufrufe schlagen fehl.

1. Gehe zu [render.com](https://render.com) und verbinde dein GitHub-Repo
2. Wähle **New Web Service** → Repo `test` → Render erkennt `render.yaml` automatisch
3. Nach dem Deploy kopiere die URL (z.B. `https://einkaufs-tracker-api.onrender.com`)
4. Trage sie in [`public/config.js`](public/config.js) ein:

```js
window.APP_CONFIG = {
  API_BASE: 'https://einkaufs-tracker-api.onrender.com/api',
};
```

5. Commit & Push → GitHub Pages aktualisiert sich automatisch

> **Hinweis:** Der kostenlose Render-Plan schläft nach Inaktivität ein – der erste Aufruf kann ~30 Sekunden dauern.

## Frontend

Single-Page-App mit drei Dashboards:

| Ansicht | Beschreibung |
|---------|--------------|
| **Bon hochladen** | Drag-and-Drop für Kassenbon-Fotos, KI-Simulation, Speichern via API |
| **Preis-Checker** | Produktsuche mit Chart.js-Liniendiagramm für Preisverlauf |
| **Spar-Optimierer** | Übersicht: günstigster Laden pro Produkt (Lidl, Aldi, REWE) |

```
public/
├── index.html
├── style.css
└── app.js
```

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

- **Läden:** Lidl, Aldi, REWE
- **Produkte:** Milch, Butter, Brot, Eier, Kaffee

## API-Endpunkte

### Health-Check

```bash
curl http://localhost:3000/health
```

### Läden & Produkte

```bash
curl http://localhost:3000/api/stores
curl http://localhost:3000/api/products
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
├── public/
│   ├── index.html      # Frontend SPA
│   ├── style.css       # Custom Styles & Animationen
│   └── app.js          # Frontend-Logik
├── data/
│   └── einkauf.db      # SQLite-Datenbank (wird automatisch erstellt)
└── package.json
```
