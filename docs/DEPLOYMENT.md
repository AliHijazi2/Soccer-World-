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

## Weg 1: Erst mal anschauen (10 Minuten, ohne HTTPS)

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

## Weg 2: Richtig hosten (empfohlen)

Damit die App wirklich aufs Handy kommt und die Spieltage auch laufen, wenn dein
Rechner aus ist. **Fly.io** ist dafür geeignet: HTTPS ist automatisch dabei,
eine kleine Instanz mit Datenbank kostet wenige Euro im Monat.

```bash
# Einmalig: Werkzeug installieren und anmelden
curl -L https://fly.io/install.sh | sh
fly auth signup

# Im Projektverzeichnis
fly launch --no-deploy          # erkennt das Dockerfile
fly postgres create             # Datenbank anlegen
fly postgres attach <db-name>   # setzt DATABASE_URL automatisch
fly secrets set TZ=Europe/Berlin
fly deploy

# Liga anlegen
fly ssh console -C "npm run new-league -- 'Freitagsliga' Ali Marco Lisa Tom"
```

Danach läuft die App unter `https://<dein-name>.fly.dev`.

Andere Anbieter funktionieren genauso, solange sie ein Dockerfile und eine
PostgreSQL-Datenbank unterstützen — etwa Railway, Render oder ein eigener
kleiner Server mit Caddy als Reverse-Proxy.

### Die Zeitzone ist keine Kleinigkeit

`TZ` bestimmt, wann Spieltage und Marktabschluss stattfinden. Steht der Server
auf UTC, stößt euer 20-Uhr-Spiel um 22 Uhr an. Setz die Variable auf die
Zeitzone der Gruppe.

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
