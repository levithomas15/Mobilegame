// Spielkern: Aufbau der Szene, feste Simulationsrate, Runden-Ablauf.

import * as THREE from 'three';
import {
  TICK_DT, MAX_TICKS_PER_FRAME, FOV,
  ROUNDS_TO_WIN, ROUND_INTERMISSION, BUILD_RANGE,
} from './config.js';
import { World } from './world.js';
import { Building, planPlacement } from './building.js';
import { Player, baseFov } from './player.js';
import { Bot } from './bot.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Effects } from './effects.js';
import { fireWeapon, currentSpread } from './weapons.js';

const STATE = { MENU: 'menu', COUNTDOWN: 'countdown', PLAYING: 'playing', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd' };
const COUNTDOWN_TIME = 1.8;

const _muzzle = new THREE.Vector3();
const _builderBox = new THREE.Box3();

class Game {
  constructor() {
    this.root = document.getElementById('app');
    this.canvas = document.getElementById('game-canvas');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    // Über 2 bringt die Auflösung optisch fast nichts, kostet auf Handys aber
    // spürbar Bildrate.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
    this.scene.add(this.camera);

    this.world = new World(this.scene);
    this.colliders = this.world.colliders; // Welt und Bauten teilen sich das Array
    this.building = new Building(this.scene, this.colliders);
    this.effects = new Effects(this.scene);

    this.player = new Player(this.camera);
    this.bot = new Bot(this.scene, 'normal');
    this.hud = new Hud(this.root);
    this.input = new Input(this.root);

    this.state = STATE.MENU;
    this.stateTimer = 0;
    this.round = 0;
    this.score = { player: 0, bot: 0 };
    this.difficulty = 'normal';

    this.accumulator = 0;
    this.lastTime = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    this._bindUi();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.input.reset();
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame((t) => { this.lastTime = t; requestAnimationFrame(this.loop); });
  }

  _bindUi() {
    const startScreen = document.getElementById('start-screen');
    const choices = document.getElementById('difficulty-choices');

    choices.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-difficulty]');
      if (!btn) return;
      this.difficulty = btn.dataset.difficulty;
      for (const b of choices.children) b.classList.toggle('selected', b === btn);
    });

    document.getElementById('start-button').addEventListener('click', () => {
      startScreen.classList.add('hidden');
      this._requestImmersive();
      this.startMatch();
    });
  }

  /** Auf dem Handy Vollbild, am PC Mauszeiger-Fang. Beides darf fehlschlagen. */
  _requestImmersive() {
    const el = document.documentElement;
    if (window.matchMedia('(pointer: coarse)').matches) {
      // Bewusst keine Orientierungssperre: das Spiel läuft in beiden Lagen,
      // und eine Sperre würde Hochformat-Spielern das Bild verdrehen.
      el.requestFullscreen?.().catch(() => {});
    } else {
      this.canvas.requestPointerLock?.();
    }
  }

  _resize() {
    // Maßgeblich ist die Größe des Canvas, nicht die des Fensters: im
    // Hochformat nimmt das Spielbild nur den oberen Teil ein, darunter liegt
    // das Bedienfeld.
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    // Beim Drehen des Geräts den neuen Blickwinkel sofort übernehmen; sonst
    // würde die Kamera sichtbar dorthin zoomen statt einfach richtig zu stehen.
    if (!this.player.ads) this.camera.fov = baseFov(this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  // ---------- Match- und Runden-Ablauf ----------

  startMatch() {
    this.score.player = 0;
    this.score.bot = 0;
    this.round = 0;
    this.bot.setDifficulty(this.difficulty);
    this.hud.reset();
    this.hud.setScore(0, 0);
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.building.clear();
    this.effects.clear();
    this.input.reset();

    this.player.spawn(this.world.spawns[0]);
    this.bot.spawn(this.world.spawns[1], this.world.spawns[0].position);
    this.player.prevPosition.copy(this.player.position);

    this.hud.banner(`Runde ${this.round}`, 'Bereit machen…');
    this._setState(STATE.COUNTDOWN, COUNTDOWN_TIME);
  }

  _setState(state, timer = 0) {
    this.state = state;
    this.stateTimer = timer;
  }

  _endRound(playerWon) {
    if (playerWon) this.score.player += 1;
    else this.score.bot += 1;
    this.hud.setScore(this.score.player, this.score.bot);

    const matchOver = this.score.player >= ROUNDS_TO_WIN || this.score.bot >= ROUNDS_TO_WIN;
    if (matchOver) {
      const won = this.score.player >= ROUNDS_TO_WIN;
      this.hud.banner(
        won ? 'Match gewonnen!' : 'Match verloren',
        `${this.score.player} : ${this.score.bot} — Tippe zum Neustart`,
        won ? 'win' : 'lose',
      );
      this._setState(STATE.MATCH_END, 1.2); // kurze Sperre gegen Fehltipps
      return;
    }

    this.hud.banner(
      playerWon ? 'Runde gewonnen' : 'Runde verloren',
      `${this.score.player} : ${this.score.bot}`,
      playerWon ? 'win' : 'lose',
    );
    this._setState(STATE.ROUND_END, ROUND_INTERMISSION);
  }

  // ---------- Aktionen ----------

  /** Schuss einer Figur auflösen: Effekte, Schaden, Rückstoß. */
  shoot(actor) {
    if (!actor.alive || !actor.loadout.canFire()) return false;

    const def = actor.loadout.def;
    const isPlayer = actor === this.player;
    const spread = currentSpread(def, {
      ads: isPlayer ? this.player.ads : false,
      sprinting: isPlayer ? this.player.sprinting : false,
      airborne: !actor.grounded,
      moving: Math.hypot(actor.velocity.x, actor.velocity.z) > 1.5,
    });

    actor.loadout.consume();

    const origin = actor.eyePosition;
    const direction = actor.forward;
    const enemy = isPlayer ? this.bot : this.player;
    const targets = enemy.alive ? [{ box: enemy.box, owner: enemy }] : [];

    const hits = fireWeapon({ origin, direction, def, spread, colliders: this.colliders, targets });

    _muzzle.copy(origin).addScaledVector(direction, 0.55);
    this.effects.muzzleFlash(_muzzle);

    let hitTarget = false;
    let killed = false;

    for (const hit of hits) {
      this.effects.tracer(_muzzle, hit.end, isPlayer ? 0xfff0b0 : 0xffb0a0);
      if (hit.miss) continue;

      if (hit.target) {
        hitTarget = true;
        this.effects.impact(hit.end, hit.normal, 0xff5c5c);
        if (hit.target.applyDamage(hit.damage)) killed = true;
      } else {
        this.effects.impact(hit.end, hit.normal);
        if (hit.piece) this.building.damage(hit.piece, hit.damage);
      }
    }

    if (isPlayer) {
      if (hitTarget) this.hud.hitMarker(killed);
      this.player.kick(def.recoil.pitch * 8);
    }

    // Rückstoß wirkt auf die echte Zielrichtung, nicht nur auf die Sicht.
    actor.pitch -= def.recoil.pitch;
    actor.yaw += (Math.random() * 2 - 1) * def.recoil.yaw;

    // Das Rundenende wird nicht hier ausgelöst, sondern zentral in `tick()` —
    // so gibt es genau einen Pfad dorthin, egal wer wen wodurch ausschaltet.
    return true;
  }

  tryBuild(actor, type) {
    if (!actor.canBuild) return false;
    return this.tryBuildPlan(actor, planPlacement(type, actor.position, actor.flatForward));
  }

  tryBuildPlan(actor, plan) {
    if (!actor.canBuild || !actor.alive) return false;
    if (plan.center.distanceTo(actor.position) > BUILD_RANGE * 2) return false;

    // Eigene Körperbox verkleinert: leichtes Streifen ist erlaubt, sich selbst
    // einmauern nicht. Ohne die Verkleinerung schlüge jeder Bau fehl, sobald man
    // nah an einer Zellgrenze steht.
    const r = actor.radius * 0.45;
    _builderBox.min.set(actor.position.x - r, actor.position.y + 0.25, actor.position.z - r);
    _builderBox.max.set(actor.position.x + r, actor.position.y + actor.height - 0.15, actor.position.z + r);

    // Der Gegner zählt mit voller Box: in einen anderen Körper hinein darf
    // niemand bauen, sonst kann man ihn einsperren oder ihm die Kamera zubauen.
    const other = actor === this.player ? this.bot : this.player;
    const blocked = [_builderBox];
    if (other.alive) blocked.push(other.box);

    if (this.building.place(plan, actor.team, blocked)) {
      actor.markBuilt();
      return true;
    }
    return false;
  }

  // ---------- Schleife ----------

  tick(dt) {
    if (this.state === STATE.PLAYING) {
      this.player.update(dt, this.input, this);
      this.bot.update(dt, this);

      // Einziger Weg ins Rundenende: sobald eine Figur ausgeschaltet ist.
      // Bei einem Doppel-K.o. geht die Runde an den Bot.
      if (!this.bot.alive || !this.player.alive) {
        this._endRound(!this.bot.alive && this.player.alive);
      }
    } else {
      // Zwischen den Runden weiterlaufen lassen, aber ohne Schießen/Bauen —
      // sonst fällt die Kamera beim Rundenwechsel unangenehm hart.
      this.player.prevPosition.copy(this.player.position);
      this.player.tickTimers(dt);
      this.player.step(dt, this.colliders, { wishX: 0, wishZ: 0, jump: false, sprinting: false, ads: false });
    }
  }

  loop(now) {
    requestAnimationFrame(this.loop);

    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(raw, 0.25);

    // Blick pro Bild anwenden, nicht pro Simulationsschritt — sonst fühlt sich
    // das Umsehen auf 120-Hz-Displays zäh an.
    if (this.state === STATE.PLAYING || this.state === STATE.COUNTDOWN) {
      const look = this.input.takeLook();
      if (look.dx || look.dy) this.player.applyLook(look.dx, look.dy);
    } else {
      this.input.takeLook();
    }

    this._advanceState(dt);

    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.tick(TICK_DT);
      this.accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0; // nach einem Hänger nicht aufholen

    const alpha = this.accumulator / TICK_DT;
    this.player.updateCamera(this.camera, alpha, dt);
    this.effects.update(dt);
    this._updateGhost();

    const def = this.player.loadout.def;
    const spread = currentSpread(def, {
      ads: this.player.ads,
      sprinting: this.player.sprinting,
      airborne: !this.player.grounded,
      moving: this.player.moving,
    });
    this.hud.update(this.player, this.bot, spread, dt);

    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this.hud.perf(this.fps, this.building.pieces.length);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _advanceState(dt) {
    if (this.stateTimer > 0) this.stateTimer = Math.max(0, this.stateTimer - dt);

    switch (this.state) {
      case STATE.COUNTDOWN:
        if (this.stateTimer <= 0) {
          this.hud.hideBanner();
          this._setState(STATE.PLAYING);
        }
        break;
      case STATE.ROUND_END:
        if (this.stateTimer <= 0) this.startRound();
        break;
      case STATE.MATCH_END:
        // Nach der Sperrzeit startet jede Eingabe ein neues Match.
        if (this.stateTimer <= 0 && (this.input.consume('fire') || this.input.consume('jump'))) {
          this.startMatch();
        }
        break;
      default:
        break;
    }
  }

  /** Bauvorschau zeigen, solange gebaut werden darf. */
  _updateGhost() {
    if (this.state !== STATE.PLAYING || !this.player.alive) {
      this.building.updateGhost(null, false);
      return;
    }
    const type = this.input.isDown('ramp') ? 'ramp' : 'wall';
    const plan = this.player.currentPlan(type);
    const showAlways = this.player.buildMode || this.input.isDown('wall') || this.input.isDown('ramp');
    this.building.updateGhost(plan, showAlways);
  }
}

const game = new Game();

// Für Konsole und automatisierte Tests erreichbar.
window.__game = game;
window.__THREE = THREE;

// Auf dem Match-Ende-Bildschirm reicht ein Tipp irgendwohin.
document.getElementById('touch-layer').addEventListener('pointerdown', () => {
  if (game.state === STATE.MATCH_END && game.stateTimer <= 0) game.startMatch();
});
