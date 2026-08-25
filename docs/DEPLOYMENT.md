# Die App aufs Handy bekommen

Soccer World ist eine installierbare Web-App. Es gibt keinen App-Store-Eintrag —
die App landet über den Browser auf dem Startbildschirm und sieht danach aus wie
jede andere App: eigenes Symbol, Vollbild, keine Adresszeile.

Damit das geht, braucht ihr **einen Server, den alle erreichen können**. Der
Markt läuft für alle gleichzeitig, die Spieltage werden zentral simuliert — ohne
laufenden Server gibt es kein Spiel.

---

## Der wichtigste Punkt vorweg: HTTPS

**Ohne HTTPS lässt sich die App nicht installieren.** Browser erlauben Service
Worker und die Installation nur über eine verschlüsselte Verbindung. Die einzige
Ausnahme ist `localhost` auf demselben Gerät.

Das heißt konkret: Der Server im heimischen WLAN unter `http://192.168.1.42:3000`
funktioniert zum **Ausprobieren im Browser**, aber die App lässt sich von dort
nicht auf den Startbildschirm legen. Für das echte Spiel mit Freunden führt kein
Weg an einer Adresse mit HTTPS vorbei.

---

## Weg 1: Kostenlos — dein Rechner ist der Server

Kein Hoster, keine Kreditkarte. Dein eigener Rechner betreibt das Spiel, ein
Gratis-Tunnel gibt ihm eine öffentliche HTTPS-Adresse. Damit lässt sich die App
auf allen Handys installieren.

**Einmalig einrichten:**

```bash
# 1. Spiel starten (Docker Desktop ist für Privatnutzung kostenlos)
docker compose up -d --build
docker compose exec app npm run new-league -- "Freitagsliga" Ali Marco Lisa

# 2. Tailscale installieren, kostenloses Konto anlegen: https://tailscale.com
tailscale funnel 3000
```

Der zweite Befehl gibt eine feste Adresse aus, etwa
`https://dein-rechner.tail1234.ts.net`. Die schickst du deinen Freunden — fertig.

Die Adresse bleibt gleich, auch wenn du den Rechner zwischendurch ausmachst. Das
ist wichtig: Eine installierte App merkt sich ihre Adresse. Wechselt sie, zeigt
das Symbol auf dem Startbildschirm ins Leere.

> Es gibt auch `cloudflared tunnel --url http://localhost:3000` — ganz ohne
> Konto, aber mit einer **neuen zufälligen Adresse bei jedem Start**. Zum
> Ausprobieren gut, für eine installierte App unbrauchbar.

### Der Haken: der Rechner muss laufen

Solange dein Rechner aus ist, ist das Spiel für alle offline. Das ist weniger
schlimm, als es klingt, weil das Spiel so gebaut ist, dass es aufholt:

- **Verpasste Spieltage werden nachgeholt.** Der Server arbeitet beim Start
  alles ab, was fällig war. Machst du den Rechner morgens an, laufen die Spiele
  der letzten Nacht sofort durch.
- **Die Aufholjagd bleibt fair.** Eine Auktion endet zu ihrer eingetragenen
  Uhrzeit, nicht zum Zeitpunkt der Verarbeitung — ein Gebot nach Ablauf wird
  auch dann abgelehnt, wenn der Server erst Stunden später wieder läuft.
  Niemand kann sich durch die Ausfallzeit einen Vorteil holen.

Was ihr verliert, ist nur die Uhrzeit: Das 20-Uhr-Spiel läuft dann eben um 8 Uhr
morgens, wenn der Rechner angeht. Für eine Runde unter Freunden reicht das.
Praktikabel wird es, wenn ihr den Rechner an den Spielabenden anlasst.

---

### Vorher lokal ausprobieren (ohne HTTPS)

Zum Ausprobieren auf dem eigenen Rechner und im eigenen WLAN.

```bash
git clone <dein-repo> && cd Soccer-World-
docker compose up -d --build
docker compose exec app npm run new-league -- "Freitagsliga" Ali Marco Lisa Tom
```

Das Werkzeug gibt eine Liga-Kennung und je eine Vereins-Kennung pro Freund aus.
Beides braucht ihr beim ersten Start der App.

Danach:

- auf dem Rechner: `http://localhost:3000`
- auf dem Handy im selben WLAN: `http://<IP-des-Rechners>:3000`

Die IP findest du mit `ip addr` (Linux), `ifconfig` (macOS) oder `ipconfig`
(Windows). Es funktioniert alles, nur die Installation auf dem Startbildschirm
noch nicht.

---

## Weg 2: Gehostet (kostet Geld, läuft dafür immer)

Nur nötig, wenn die Liga rund um die Uhr laufen soll, ohne dass jemand einen
Rechner anlässt. **Fly.io** kostet mit Datenbank wenige Euro im Monat.

```bash
# Einmalig: Werkzeug installieren und anmelden
curl -L https://fly.io/install.sh | sh
fly auth signup

# Im Projektverzeichnis — fly.toml liegt fertig im Repo
fly launch --no-deploy --copy-config
fly postgres create --name soccer-world-db
fly postgres attach soccer-world-db   # setzt DATABASE_URL automatisch
fly deploy

# Liga anlegen
fly ssh console -C "npm run new-league -- 'Freitagsliga' Ali Marco Lisa Tom"
```

Danach läuft die App unter `https://<dein-name>.fly.dev`.

Andere Anbieter funktionieren genauso, solange sie ein Dockerfile und eine
PostgreSQL-Datenbank unterstützen — etwa Railway, Render oder ein eigener
kleiner Server mit Caddy als Reverse-Proxy.

### Die Maschine darf nicht schlafen

In `fly.toml` steht `auto_stop_machines = false` und `min_machines_running = 1`.
Das ist Absicht: Spieltage stoßen um 17, 20 und 22 Uhr an, Auktionen schließen
nachts von selbst. Ein Server, der beim letzten Seitenaufruf einschläft,
verpasst all das — die Liga steht am nächsten Morgen genau da, wo sie abends
stand. Wer hier spart, spart die Spieltage weg.

### Die Zeitzone ist keine Kleinigkeit

`TZ` bestimmt, wann Spieltage und Marktabschluss stattfinden. Steht der Server
auf UTC, stößt euer 20-Uhr-Spiel um 22 Uhr an. In `fly.toml` und `compose.yaml`
ist `Europe/Berlin` gesetzt — wohnt die Gruppe woanders, ändert das dort.

---

## Auf dem Handy installieren

**Android (Chrome)**
1. Adresse öffnen
2. Menü ⋮ → *App installieren* — oder das Banner antippen, das von selbst kommt

**iPhone (Safari — nur Safari, nicht Chrome)**
1. Adresse öffnen
2. Teilen-Symbol antippen
3. *Zum Home-Bildschirm*

Beim ersten Start fragt die App nach Liga- und Vereins-Kennung. Die stehen in
der Ausgabe von `new-league`. Danach merkt sie sich beides.

### Der erste Tag ist die Aufbauphase

`new-league` startet die Saison **nicht** sofort. Stattdessen liegt der ganze
Marktpool ausgeschrieben da, und ihr habt 24 Stunden, um Kader zu bauen
(GDD §2.4). Danach startet die Liga von selbst.

- **Pflichtkader:** 14 Spieler, mindestens 1 Torwart und 3 Verteidiger.
- **Wer zu wenige hat**, bekommt die schlechtesten freien Spieler zugeteilt —
  zu 120 % Gehalt. Das ist Absicht: Die Liga darf nicht daran scheitern, dass
  einer die Aufbauphase verschläft, aber billig soll es auch nicht sein.
- **Kürzere Frist zum Ausprobieren:** `BUILD_HOURS=1` vor den Befehl setzen.

Der Rechner muss in dieser Zeit nicht durchlaufen. Verpasste Auktionsschlüsse
werden beim nächsten Start nachgeholt, und Gebote nach Ablauf werden ohnehin
abgelehnt.

---

## Was noch fehlt

**Push-Benachrichtigungen.** Ohne sie merkt niemand, dass er überboten wurde —
und der Marktabschluss lebt genau davon. Das ist der nächste Ausbauschritt und
funktioniert auf beiden Systemen, sobald die App installiert ist.

**Eine richtige Anmeldung.** Aktuell identifiziert die Vereins-Kennung den
Spieler. Wer die Kennung eines Freundes hat, kann in dessen Namen bieten. Für
eine Gruppe, die sich kennt, ist das vertretbar — aber es ist keine Sicherheit,
sondern eine Absprache.

**Ein Backup.** `docker compose exec db pg_dump -U postgres soccerworld > sicherung.sql`
dauert Sekunden. Die gemeinsame Historie über mehrere Saisons ist der eigentliche
Wert des Spiels; ein verlorener Datenbestand nimmt euch mehr als eine Saison.
