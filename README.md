# Relay — Messenger

Echtzeit-Messenger (WhatsApp-ähnlich) mit Node.js, Express, Socket.io und SQLite.

## Features

- Registrieren / Anmelden
- 1:1-Chats in Echtzeit
- Online-Status & Tippanzeige
- Lesebestätigungen
- Responsive Layout (Desktop + Handy)

## Schnellstart

```bash
npm install
npm start
```

Öffne http://localhost:3000

### Demo-Accounts

| Benutzer | Passwort |
|----------|----------|
| anna     | demo     |
| ben      | demo     |
| clara    | demo     |
| david    | demo     |

Tipp: Zwei Browserfenster (oder ein normales + ein Inkognito-Fenster) öffnen und live schreiben.

## Datenschutz (DSGVO)

- Datenschutzerklärung: `/datenschutz.html`
- Einwilligung + Altersbestätigung (16+) bei Registrierung
- Datenexport und Kontolöschung unter Privatsphäre
- „Zuletzt online“ optional ausblendbar
- Keine Tracking-Cookies; nur technisch notwendiges Session-Token

## Deploy (z. B. Render)

Die App braucht einen laufenden Node-Server (WebSockets).  
`render.yaml` ist vorbereitet — Free-Plan reicht für den Test.
