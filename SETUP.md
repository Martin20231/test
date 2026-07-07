# GitHub Pages Setup

## Problem behoben

GitHub Pages hat vorher die **README** als Webseite angezeigt (Jekyll).  
Die App liegt jetzt im **`docs/`**-Ordner mit `.nojekyll` (kein Jekyll).

## Einmalig in GitHub Settings ändern

1. Öffne: **https://github.com/Martin20231/test/settings/pages**
2. **Source** → **Deploy from a branch**
3. Branch: **`main`** · Ordner: **`/docs`**
4. **Save** klicken
5. 1–2 Minuten warten

## Deine App-URL

**https://martin20231.github.io/test/**

## Lokal testen

```bash
npm install
npm start
```

→ http://localhost:3000
