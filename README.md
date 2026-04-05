# STV_Schenkon_Lauf

Web-App für einen Amateur-Sprintanlass (60m, 80m, 100m) mit öffentlicher Anmeldung und Admin-Verwaltung auf Basis von **Vanilla HTML/CSS/JS + Supabase**.

## Was wurde fachlich überarbeitet?

- Öffentliche Anmeldung funktioniert ohne Login mit Pflichtfeldern: **Nachname, Vorname, Geschlecht (exklusive Auswahl), Geburtsjahr**.
- Admin-Ansicht nutzt Teilnehmerdaten mit getrenntem Namen (`last_name`, `first_name`) und zeigt die gewünschte Spaltenreihenfolge.
- Kategorien wurden auf **Altersbereiche** umgestellt (`min_age`, `max_age`) statt Jahrgangsgrenzen.
- Laufmodell wurde auf `round_type` vereinheitlicht:
  - `first_run`
  - `second_run`
  - `kings_run` (global, kategorienübergreifend)
- Königslauf kann aus den **4 schnellsten Zeiten des zweiten Laufs** generiert werden.
- Startnummernlogik bleibt erhalten: global eindeutig, gesperrte Nummern werden nie vergeben.
- PDF-Export enthält Kategorie, Runde, Laufnummer, Startnummer, Nachname, Vorname, Geschlecht.

---

## Setup

### 1) Supabase-Projekt erstellen

1. Neues Supabase-Projekt erstellen.
2. In Supabase → SQL Editor den Inhalt aus `supabase/schema.sql` ausführen.

> `schema.sql` enthält sowohl eine Neuinstallation als auch Migrationen von älteren Ständen (inkl. Backfill für `name` → `first_name`/`last_name` und `round_number` → `round_type`).

### 2) Frontend-Konfiguration (öffentlich, für Browser)

Datei `config/public.supabase.json` befüllen:

```json
{
  "supabaseUrl": "https://YOUR_PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR_PUBLIC_ANON_KEY"
}
```

### 3) Admin-User in Supabase anlegen

1. Supabase → Authentication → Users: Admin-Benutzer mit E-Mail/Passwort erstellen.
2. User-ID (UUID) kopieren.
3. SQL ausführen:

```sql
insert into public.admin_users (user_id) values ('<AUTH_USER_UUID>');
```

### 4) Lokal starten

```bash
python3 -m http.server 8080
```

Dann öffnen: `http://localhost:8080`

---

## Datenmodell (Zielstand)

### participants
- `id`
- `last_name`
- `first_name`
- `gender`
- `birth_year`
- `start_number`
- `category_id`
- `created_at`

> Alter wird im Frontend aus `birth_year` berechnet (`aktuelles Jahr - birth_year`).

### categories
- `id`
- `name`
- `gender`
- `distance` (60/80/100)
- `min_age`
- `max_age`
- `created_at`

### blocked_start_numbers
- `id`
- `number`
- `reason`
- `created_at`

### heats
- `id`
- `category_id` (für Königslauf `NULL`)
- `round_type` (`first_run`, `second_run`, `kings_run`)
- `heat_number`
- `created_at`

### heat_entries
- `id`
- `heat_id`
- `participant_id`
- `lane_or_position`

### results
- `id`
- `heat_id`
- `participant_id`
- `time_value`
- `created_at`

---

## Sicherheitskonzept / RLS

Wichtige Punkte:

- Kein Service Role Key im Frontend.
- Browser nutzt nur `supabaseUrl` + `supabaseAnonKey`.
- Öffentliche Nutzer (`anon`) dürfen nur Teilnehmer anmelden (`insert` auf `participants`, nur vorgesehene Spalten).
- Admin-Funktionen sind per `is_admin()` + `admin_users` geschützt.
- Zusätzliche `GRANT`s auf Schema/Tabellen/Sequenzen verhindern `permission denied for public schema`, während RLS weiterhin den Zugriff einschränkt.

---

## Admin-Tabs

- Anmeldungen
- Kategorien
- Gesperrte Startnummern
- Läufe / Startaufstellungen
- Resultate
- PDF-Export

---

## Prüfhinweise

Nach Deployment prüfen:

1. Öffentliche Anmeldung ohne Login funktioniert.
2. Pflichtfelder werden validiert.
3. Admin-Login funktioniert per E-Mail/Passwort.
4. Admin kann alle Tabellen lesen/schreiben, ohne Permission-Fehler.
5. Kategorien mit Altersbereichen greifen fachlich korrekt.
6. Zweiter Lauf speichern + Königslauf aus Top-4 Zeiten generieren.
7. Gesperrte Startnummern werden bei automatischer Vergabe übersprungen.
