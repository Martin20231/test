# Relay — Messenger

Echtzeit-Messenger mit Node.js, Express, Socket.io und SQLite. UI bewusst anders als WhatsApp (Kreise, Impulse, Umfragen).

## Features

- Registrieren / Anmelden, 1:1 und Gruppen („Kreise“)
- Echtzeit, Tippen, Lesebestätigungen, Reaktionen, Bearbeiten/Löschen
- Fotos, Sprachnotizen, Impulse (24h), Umfragen, Anheften
- DSGVO-Funktionen (siehe unten)

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

## Datenschutz / deutsches Recht

- Datenschutzerklärung: `/datenschutz.html` (Version 2026-08-08.3)
- Impressum (§&nbsp;5 DDG): `/impressum.html` — Platzhalter via `IMPRESSUM_*` Env
- Granulare Einwilligungen: Policy, Nachrichten, Medien, Impulse (Widerruf Art.&nbsp;7 Abs.&nbsp;3)
- Art.&nbsp;15/20 Export, Art.&nbsp;17 Kontolöschung, Art.&nbsp;18 Verarbeitungseinschränkung
- Privacy by Default: „Zuletzt online“ aus; Aufbewahrung 30/90/180/365 Tage
- Verschlüsselung at rest (AES-256-GCM), Session-Timeout 30 Tage, Orphan-Upload-Cleanup
- Lokale Fonts (kein Google Fonts CDN)
- Schlüssel: `RELAY_ENCRYPTION_KEY` setzen (Produktion)

**Hinweis:** Keine E2E-Verschlüsselung. Für Produktivbetrieb Impressum-Daten und Hosting (idealerweise EU) konkretisieren.

## Deploy (z. B. Render)

Die App braucht einen laufenden Node-Server (WebSockets).  
`render.yaml` ist vorbereitet — Free-Plan reicht für den Test.
