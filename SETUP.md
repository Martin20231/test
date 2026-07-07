# Einmaliges Setup (1 Klick)

Der Code ist auf GitHub gemergt. Für die Webseite fehlt nur noch **ein Schritt**, den nur du als Repo-Besitzer machen kannst:

## GitHub Pages aktivieren

1. Öffne: **https://github.com/Martin20231/test/settings/pages**
2. Unter **Build and deployment** → **Source** wähle: **Deploy from a branch**
3. Branch: **gh-pages** · Ordner: **/ (root)**
4. Auf **Save** klicken
5. Nach 1–2 Minuten erreichbar unter: **https://martin20231.github.io/test/**

> Der `gh-pages`-Branch mit dem Frontend wurde bereits für dich erstellt.

## Backend (optional, für Speichern & Charts)

Für volle Funktion online:

1. https://render.com → mit GitHub anmelden
2. **New** → **Web Service** → Repo `test` auswählen
3. Render erkennt `render.yaml` automatisch → **Deploy**
4. Nach dem Deploy die URL kopieren (z.B. `https://einkaufs-tracker-api.onrender.com`)
5. In `public/config.js` eintragen und auf `main` pushen

```js
window.APP_CONFIG = {
  API_BASE: 'https://einkaufs-tracker-api.onrender.com/api',
};
```

## Lokal sofort testen (alles funktioniert)

```bash
npm install
npm start
```

→ http://localhost:3000
