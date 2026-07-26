# Build & Blast — 1v1-Arena-Shooter für den Handy-Browser

Ein 3D-Shooter im Stil von *1v1.lol*: Wände und Rampen bauen, darüber klettern,
den Gegner ausschalten. Läuft direkt im Browser auf dem Handy — keine App, kein
Store, kein Build-Schritt. Gegner ist ein Bot, also komplett offline spielbar.

## Spielen

Online: **https://levithomas15.github.io/Mobilegame/**

Damit diese Adresse funktioniert, muss GitHub Pages einmalig eingeschaltet
werden — das kann nur der Repo-Besitzer, ein Workflow darf es nicht:

1. `Settings` → `Pages`
2. Unter **Source**: `GitHub Actions` wählen

Danach veröffentlicht der Workflow `.github/workflows/pages.yml` bei jedem Push
auf den Standard-Branch automatisch neu.

Am Handy: die Adresse in Safari/Chrome öffnen, Gerät ins Querformat drehen und
über „Teilen → Zum Home-Bildschirm" ablegen. Dann startet das Spiel im Vollbild
wie eine App.

## Lokal starten

Es reicht ein beliebiger statischer Webserver im Projektordner:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Auf dem Handy: dieselbe Adresse im WLAN öffnen (`http://<Rechner-IP>:8000`) und
das Gerät ins Querformat drehen. Das Spiel fragt beim Start Vollbild an.

Ein Öffnen per `file://` funktioniert **nicht** — ES-Module und die Importmap
brauchen HTTP.

## Steuerung

**Handy**

| Aktion | Bedienung |
|---|---|
| Laufen | Linke Bildschirmhälfte wischen (virtueller Joystick erscheint) |
| Sprinten | Joystick bis zum Anschlag nach vorn |
| Umsehen | Rechte Bildschirmhälfte wischen |
| Schießen | Großer Knopf unten rechts |
| Springen / Zielen / Nachladen | Knöpfe links davon |
| Wand / Rampe bauen | Knöpfe unten links (halten baut weiter) |
| Waffe wechseln | Leiste oben rechts (AR / SG / SR) |

Laufen, Umsehen und Schießen funktionieren gleichzeitig — die Eingabe verfolgt
jeden Finger einzeln.

**PC** (zum Testen)

`WASD` laufen · Maus umsehen · Linksklick schießen · Rechtsklick zielen ·
`Leertaste` springen · `Shift` sprinten · `Q` Wand · `E` Rampe · `R` nachladen ·
`1`/`2`/`3` Waffe · `F` Baumodus umschalten

## Spielregeln

Best-of-5 gegen den Bot — drei Rundensiege gewinnen das Match. Wer ausgeschaltet
wird, verliert die Runde; danach werden Arena und alle Bauten zurückgesetzt.
Schwierigkeit (leicht / normal / schwer) wird im Startbildschirm gewählt und
steuert Zielgenauigkeit, Reaktionszeit und Bau-Neigung des Bots.

### Waffen

| Waffe | Schaden | Feuerrate | Magazin | Stärke |
|---|---|---|---|---|
| Sturmgewehr (AR) | 19 | 600/min, Automatik | 30 | Allrounder auf mittlere Distanz |
| Schrotflinte (SG) | 12 × 8 Kugeln | 80/min | 8 | Nahkampf, fällt stark mit der Entfernung ab |
| Scharfschütze (SR) | 88 | 48/min | 5 | Weite Distanz, beim Zielen fast streuungsfrei |

Kopftreffer machen mehr Schaden. Sprinten und Springen vergrößern die Streuung
deutlich, Zielen verkleinert sie. Der Bot wählt seine Waffe nach Entfernung.

### Bauen

Wände und Rampen rasten auf ein Raster mit 3 Einheiten Kantenlänge ein und sind
mittig auf die Blickrichtung ausgerichtet. Beide Teile sind zerstörbar
(Wand 150 HP, Rampe 120 HP) — Deckung hält also nicht ewig. Rampen lassen sich
stapeln, damit man Etagen bauen kann. In eine Figur hinein kann niemand bauen.

## Aufbau

Statische Seite ohne Bundler. Three.js liegt fest eingebunden unter `vendor/`
und wird per Importmap geladen, damit das Spiel auch offline und reproduzierbar
läuft.

```
index.html          Canvas, HUD, Touch-Elemente, Importmap
styles.css          HUD- und Bedienlayout
vendor/             Three.js r169 (unverändert) + Lizenz
src/config.js       Alle Spielkonstanten an einer Stelle
src/main.js         Spielschleife, Runden- und Match-Ablauf
src/physics.js      AABB-Kollision, Step-Up, Raycast
src/input.js        Touch und Maus/Tastatur hinter einer Schnittstelle
src/world.js        Arena, Deckung, Licht
src/building.js     Rasterbau, Zerstörung, Instanz-Rendering
src/weapons.js      Waffendefinitionen, Munition, Trefferauflösung
src/actor.js        Gemeinsame Basis von Spieler und Bot
src/player.js       Eingabe, Kamera, Waffenmodell
src/bot.js          KI-Gegner als Zustandsautomat
src/hud.js          Anzeigen
src/effects.js      Leuchtspur, Einschläge, Mündungsfeuer
```

Ein paar Entscheidungen, die den Code prägen:

- **Feste Simulationsrate (60 Hz)** mit Akkumulator, Rendering davon entkoppelt
  und interpoliert. Sonst spielt sich das Spiel auf einem 120-Hz-Handy anders
  als auf einem 60-Hz-Gerät.
- **Alles ist eine AABB.** Spieler, Bot, Arena und Bauteile sind achsenparallele
  Boxen, damit eine einzige Kollisionsroutine Bewegung, Bauen und Schüsse
  bedient.
- **Rampen sind intern sechs gestapelte Kästen**, keine schiefen Ebenen. Damit
  bleibt die Kollision reine AABB, und das Hochlaufen erledigt die Step-Up-Logik.
  Gerendert wird trotzdem eine glatte, geneigte Fläche.
- **Bauteile als `InstancedMesh`** (je ein Pool für Wände und Rampen), damit auch
  bei zweihundert Teilen die Bildrate hält. Die Matrizen werden nur beim Bauen
  und Zerstören neu geschrieben, nicht pro Bild.
- **Keine Schattenkarte.** Auf schwachen Handys ist der Shadow-Pass der teuerste
  Einzelposten; die Flat-Shading-Optik bleibt auch ohne lesbar.
- **Der Bot benutzt dieselben Funktionen wie der Spieler** — gleiche Physik,
  gleiches `building.js`. Er hat keine Sonderregeln, nur Zielfehler und
  Reaktionsverzögerung.

## Grenzen

- Kein Online-Multiplayer. Die Struktur lässt ihn nachrüsten (Eingabe, Simulation
  und Darstellung sind getrennt), aber es gibt weder Netcode noch Server.
- Der Bot hat keine Wegfindung. Er läuft direkt auf sein Ziel zu, weicht bei
  Blockade seitlich aus und baut notfalls eine Rampe darüber.
- Kein Ton.
