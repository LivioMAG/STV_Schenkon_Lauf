# STV_Schenkon_Lauf

Web-App für einen Amateur-Sprintanlass (60m, 80m, 100m) mit öffentlicher Anmeldung und Admin-Verwaltung auf Basis von **Vanilla HTML/CSS/JS + Supabase**.

## Funktionen

- Öffentliche Anmeldung (Name, Geschlecht, optional Geburtsjahr)
- Admin-Login mit Supabase Auth (E-Mail/Passwort)
- Admin-Tabs für:
  - Anmeldungen (Suchen, Filtern, Bearbeiten, Löschen)
  - Kategorien (CRUD)
  - gesperrte Startnummern
  - Startaufstellungen / Läufe (pro Kategorie, deterministisch gruppiert)
  - PDF-Export der Startaufstellungen
  - Zeiten / Resultate pro Lauf
- Startnummern global eindeutig, automatische Vergabe, gesperrte Nummern werden übersprungen
- Datenmodell bereits vorbereitet für mehrere Runden (z. B. 1. Lauf, 2. Lauf, Königslauf)

---

## Projektstruktur

```text
.
├── index.html
├── assets/css/styles.css
├── js/app.js
├── config/
│   ├── public.supabase.json
│   ├── public.supabase.example.json
│   └── admin.secret.example.json
└── supabase/schema.sql
```

---

## Setup

### 1) Supabase-Projekt erstellen

1. Neues Supabase-Projekt erstellen.
2. In Supabase → SQL Editor den Inhalt aus `supabase/schema.sql` ausführen.

### 2) Frontend-Konfiguration (öffentlich, für Browser)

Datei `config/public.supabase.json` befüllen:

```json
{
  "supabaseUrl": "https://YOUR_PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR_PUBLIC_ANON_KEY"
}
```

- Diese Datei wird vom Browser geladen.
- Enthält **nur** öffentliche Werte (URL + Anon Key).

### 3) Admin-User in Supabase anlegen

1. Supabase → Authentication → Users: Admin-Benutzer mit E-Mail/Passwort erstellen.
2. Die User-ID (UUID) kopieren.
3. SQL ausführen:

```sql
insert into public.admin_users (user_id) values ('<AUTH_USER_UUID>');
```

### 4) Lokal starten

Einfach mit einem statischen Server starten (Beispiel):

```bash
python3 -m http.server 8080
```

Dann öffnen: `http://localhost:8080`

---

## Datenmodell

Implementierte Tabellen:

- `participants`
  - `id`, `name`, `gender`, `birth_year`, `start_number`, `category_id`, `created_at`
- `categories`
  - `id`, `name`, `gender`, `min_birth_year`, `max_birth_year`, `distance`, `created_at`
- `blocked_start_numbers`
  - `id`, `number`, `reason`, `created_at`
- `heats`
  - `id`, `category_id`, `round_number`, `round_name`, `heat_number`, `created_at`
- `heat_entries`
  - `id`, `heat_id`, `participant_id`, `lane_or_position`
- `results`
  - `id`, `heat_id`, `participant_id`, `time_value`, `created_at`
- `admin_users`
  - `user_id`, `created_at`

Zusatzlogik:

- Trigger `assign_next_start_number()` vergibt automatisch die nächste freie Startnummer.
- Gesperrte Nummern (`blocked_start_numbers`) werden bei Vergabe ausgelassen.

---

## Sicherheitskonzept (wichtig)

### Kein Secret im Frontend

- **Service Role Key darf nie im Browser landen.**
- `config/admin.secret.example.json` ist nur ein Beispiel für serverseitige Nutzung.
- In dieser App wird kein Service-Key clientseitig verwendet.

### Supabase Auth + RLS

- Öffentliche Anmeldung ist nur als `insert` auf `participants` erlaubt.
- Öffentliche Inserts sind eingeschränkt (`name`, `gender`, `category_id = null`, `start_number = null`).
- Alle Verwaltungsfunktionen (Select/Update/Delete + Kategorien/Läufe/Resultate) sind nur für Admins erlaubt.
- Admin-Rechte werden über `admin_users` + Funktion `is_admin()` geprüft.

---

## Fachlogik

### Startnummern

- Global eindeutig (`unique` auf `participants.start_number`).
- Automatisch bei Anmeldung per Trigger.
- Gesperrte Nummern werden nicht vergeben.

### Läufe / Startaufstellungen

- Gruppierung pro Kategorie.
- Deterministische Sortierung nach Startnummer.
- Gruppierung standardmäßig in 4er-Blöcke.
- Restgruppen werden mit 3 oder 2 erzeugt (kein 1er-Lauf).

Beispiel: 10 Teilnehmende → 4 / 4 / 2

### Resultate

- Zeiten pro Person und Lauf speicherbar (`results`).
- Rundenmodell bereits vorhanden (`heats.round_number`, `heats.round_name`) für spätere Erweiterung (2. Lauf / Königslauf).

---

## Bedienung

1. Öffentliche Startseite: Teilnehmende erfassen.
2. Admin-Login klicken und mit Admin-User anmelden.
3. In Tabs arbeiten:
   - Kategorien zuerst erfassen.
   - Teilnehmende Kategorien zuordnen.
   - Startaufstellungen je Kategorie generieren.
   - PDF exportieren.
   - Zeiten eintragen und speichern.

---

## Hinweise zur Weiterentwicklung

- Für bessere Bearbeitungsdialoge können die `prompt`-Eingaben im Teilnehmer-Tab durch Modal-Formulare ersetzt werden.
- Optionaler Server-/Edge-Function-Layer wäre möglich, ist für dieses Setup aber nicht nötig.
