# Relay — Messenger

Echtzeit-Messenger mit Node.js, Express, Socket.io und SQLite.

## Features

- Registrieren / Anmelden, 1:1-Chats und Gruppen
- Echtzeit, Tippen, Lesebestätigungen, Reaktionen, Bearbeiten/Löschen
- Fotos, Sprachnotizen, Status (24h), Umfragen, Anheften
- Datenschutz-Funktionen (siehe unten)

## Schnellstart

```bash
npm install
npm start
```

Öffne http://localhost:3000

### Testzugänge

| Benutzer | Passwort |
|----------|----------|
| anna     | demo     |
| ben      | demo     |
| clara    | demo     |
| david    | demo     |

## Datenschutz

- Datenschutzerklärung: `/datenschutz.html`
- Impressum: `/impressum.html` — Platzhalter via `IMPRESSUM_*`
- Einwilligungen für Nachrichten, Medien und Status (Widerruf möglich)
- Datenexport, Kontolöschung, Verarbeitung pausieren
- „Zuletzt online“ standardmäßig aus; Aufbewahrung 30/90/180/365 Tage
- Verschlüsselung at rest, Session-Timeout, lokale Fonts
- Schlüssel: `RELAY_ENCRYPTION_KEY` (Produktion)

**Hinweis:** Keine Ende-zu-Ende-Verschlüsselung. Für Produktivbetrieb Impressum-Daten und Hosting (idealerweise EU) konkretisieren.

## Deploy (z. B. Render)

Die App braucht einen laufenden Node-Server (WebSockets).  
`render.yaml` ist vorbereitet.
