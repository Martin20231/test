# Relay — Messenger

Echtzeit-Messenger mit Node.js, Express, Socket.io und SQLite.
Chat-Inhalte sind **Ende-zu-Ende verschlüsselt** (Browser → Ciphertext auf dem Server).

## Features

- Registrieren / Anmelden, 1:1-Chats und Gruppen
- E2E für Text, Umfragen und Medien (ECDH P-256 + AES-GCM)
- Echtzeit, Tippen, Lesebestätigungen, Reaktionen, Bearbeiten/Löschen
- Fotos, Sprachnotizen, Status (24h), Umfragen, Anheften
- Standard-Speicherfrist 30 Tage (7/30/90/180 wählbar)

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

Beide Seiten müssen sich einmal anmelden, damit E2E-Schlüssel vorhanden sind.

## Datenschutz

- Datenschutzerklärung: `/datenschutz.html`
- Impressum: `/impressum.html`
- Private E2E-Schlüssel nur im Browser (`localStorage`)
- Server speichert Chat-Inhalte als Ciphertext
- Hosting möglichst in der EU; Betreiber = Verantwortlicher

## Deploy

`render.yaml` ist vorbereitet. Für Produktion HTTPS und möglichst EU-Region wählen.
