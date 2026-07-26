// Der KI-Gegner. Zustandsautomat mit genau einem Wechsel pro Tick.
// Der Bot baut Deckung über dieselbe building.js wie der Spieler — das ist der
// Kern des 1v1.lol-Wechselspiels aus Bauen und Wegschießen.

import * as THREE from 'three';
import { TEAM_BOT, EYE_HEIGHT, CELL } from './config.js';
import { Actor } from './actor.js';
import { hasLineOfSight, raycast } from './physics.js';
import { planPlacement } from './building.js';

const STATE = {
  SEEK: 'seek',
  ENGAGE: 'engage',
  COVER: 'cover',
  RELOAD: 'reload',
};

// Bevorzugte Kampfdistanz je Waffe — daraus wählt der Bot auch die Waffe.
const PREFERRED_RANGE = { shotgun: 7, rifle: 20, sniper: 42 };

const DIFFICULTY = {
  easy:   { turnRate: 3.0, aimError: 0.075, reaction: 0.42, buildChance: 0.35, strafe: 0.6 },
  normal: { turnRate: 5.5, aimError: 0.040, reaction: 0.26, buildChance: 0.65, strafe: 0.85 },
  hard:   { turnRate: 8.5, aimError: 0.018, reaction: 0.14, buildChance: 0.9,  strafe: 1.0 },
};

const _toTarget = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _probeDir = new THREE.Vector3();

export class Bot extends Actor {
  constructor(scene, difficulty = 'normal') {
    super(TEAM_BOT);
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.state = STATE.SEEK;
    this.stateTime = 0;
    this.reactionTimer = 0;
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.jumpTimer = 0;
    this.aimNoise = new THREE.Vector2();
    this.noiseTimer = 0;
    this.sawTarget = false;
    this.lastKnownPosition = new THREE.Vector3();

    // Steckenbleiben erkennen: kommt der Bot nicht voran, weicht er seitlich
    // aus, statt sich an breiter Deckung festzulaufen.
    this.progressPos = new THREE.Vector3();
    this.progressTimer = 0;
    this.detourTimer = 0;
    this.detourCooldown = 0;
    this.detourDir = 1;

    this.mesh = buildBotMesh();
    scene.add(this.mesh);
  }

  setDifficulty(name) {
    this.cfg = DIFFICULTY[name] || DIFFICULTY.normal;
  }

  /**
   * `enemyPosition` ist der Startpunkt, auf den der Bot zuläuft, bevor er den
   * Spieler zum ersten Mal gesehen hat. Ohne das bliebe er stehen: sein
   * Suchziel wäre der eigene Spawnpunkt, den er schon erreicht hat.
   */
  spawn(spawnPoint, enemyPosition = null) {
    super.spawn(spawnPoint);
    this.state = STATE.SEEK;
    this.stateTime = 0;
    this.reactionTimer = this.cfg.reaction;
    this.sawTarget = false;
    this.lastKnownPosition.copy(enemyPosition || new THREE.Vector3(0, 0, 0));
    this.progressPos.copy(spawnPoint.position);
    this.progressTimer = 0.7;
    this.detourTimer = 0;
    this.detourCooldown = 0;
    this.mesh.visible = true;
  }

  update(dt, game) {
    const target = game.player;
    if (!this.alive) { this.mesh.visible = false; return; }

    this.tickTimers(dt);
    this.stateTime += dt;
    this.strafeTimer -= dt;
    this.jumpTimer -= dt;
    this.noiseTimer -= dt;
    this._trackProgress(dt);

    _eye.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    _targetEye.set(target.position.x, target.position.y + EYE_HEIGHT, target.position.z);
    _toTarget.subVectors(_targetEye, _eye);
    const distance = _toTarget.length();

    const visible = target.alive && hasLineOfSight(_eye, _targetEye, game.colliders);
    if (visible) {
      this.lastKnownPosition.copy(target.position);
      this.reactionTimer = Math.max(0, this.reactionTimer - dt);
      this.sawTarget = true;
    } else {
      this.reactionTimer = this.cfg.reaction; // beim Wiederauftauchen erneut reagieren
    }

    this._chooseWeapon(distance);
    this._aim(dt, _targetEye, distance);
    this._updateState(visible, distance, game);
    this._act(dt, visible, distance, game);
    this._syncMesh();
  }

  _chooseWeapon(distance) {
    if (this.loadout.reloading) return;
    let bestIndex = this.loadout.index;
    let bestScore = Infinity;
    this.loadout.slots.forEach((slot, i) => {
      if (slot.ammo <= 0) return;
      const pref = PREFERRED_RANGE[slot.def.id] ?? 20;
      const score = Math.abs(distance - pref);
      if (score < bestScore) { bestScore = score; bestIndex = i; }
    });
    this.loadout.select(bestIndex);
  }

  _aim(dt, targetEye, distance) {
    // Zielfehler als langsamer Zufallslauf: der Bot zittert nicht pro Frame,
    // sondern verzieht über kurze Zeiträume — das wirkt menschlicher und ist
    // fair kontrbar.
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 0.25 + Math.random() * 0.35;
      this.aimNoise.set(
        (Math.random() * 2 - 1) * this.cfg.aimError,
        (Math.random() * 2 - 1) * this.cfg.aimError * 0.6,
      );
    }

    _toTarget.subVectors(targetEye, _eye);
    const desiredYaw = Math.atan2(_toTarget.x, _toTarget.z) + this.aimNoise.x;
    const flat = Math.hypot(_toTarget.x, _toTarget.z);
    const desiredPitch = -Math.atan2(_toTarget.y, flat) + this.aimNoise.y;

    // Auf kurze Distanz schneller drehen, sonst dreht sich der Bot im
    // Nahkampf endlos an einem vorbeilaufenden Ziel fest.
    const rate = this.cfg.turnRate * (distance < 12 ? 1.8 : 1);
    const k = Math.min(1, rate * dt);

    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * k;
    this.pitch += (desiredPitch - this.pitch) * k;
  }

  _updateState(visible, distance, game) {
    const slot = this.loadout.current;
    const lowAmmo = slot.ammo === 0 || this.loadout.reloading;
    const hurt = this.health < 42;

    if (lowAmmo && this.state !== STATE.RELOAD) {
      this._setState(STATE.RELOAD);
      return;
    }
    if (this.state === STATE.RELOAD && !this.loadout.reloading && slot.ammo > 0) {
      this._setState(visible ? STATE.ENGAGE : STATE.SEEK);
      return;
    }
    if (hurt && visible && this.stateTime > 0.8 && Math.random() < this.cfg.buildChance * 0.05) {
      this._setState(STATE.COVER);
      return;
    }
    if (this.state === STATE.COVER && this.stateTime > 1.1) {
      this._setState(visible ? STATE.ENGAGE : STATE.SEEK);
      return;
    }
    if (this.state !== STATE.COVER && this.state !== STATE.RELOAD) {
      this._setState(visible ? STATE.ENGAGE : STATE.SEEK);
    }
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
  }

  _act(dt, visible, distance, game) {
    let wishX = 0;
    let wishZ = 0;
    let jump = false;
    let sprinting = false;

    const forward = this.flatForward;
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));

    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.7 + Math.random() * 1.1;
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    switch (this.state) {
      case STATE.SEEK: {
        // Am letzten bekannten Ort angekommen und noch nichts gesehen? Weiter
        // in Richtung des Gegners nachsetzen — sonst bleiben beide in
        // verschiedenen Ecken stehen und die Runde läuft ins Leere.
        const to = _probeDir.subVectors(this.lastKnownPosition, this.position);
        to.y = 0;
        if (to.lengthSq() < 6.25) {
          this.lastKnownPosition.copy(game.player.position);
          to.subVectors(this.lastKnownPosition, this.position);
          to.y = 0;
        }
        if (to.lengthSq() > 1) {
          to.normalize();
          wishX = to.x; wishZ = to.z;
          sprinting = true;
        }
        if (this.detourTimer > 0) {
          wishX += right.x * this.detourDir * 1.5;
          wishZ += right.z * this.detourDir * 1.5;
        }
        break;
      }
      case STATE.ENGAGE: {
        const pref = PREFERRED_RANGE[this.loadout.def.id] ?? 20;
        const gap = distance - pref;
        // Abstand halten und dabei seitlich ausweichen.
        if (Math.abs(gap) > 3) {
          const sign = Math.sign(gap);
          wishX += forward.x * sign;
          wishZ += forward.z * sign;
        }
        wishX += right.x * this.strafeDir * this.cfg.strafe;
        wishZ += right.z * this.strafeDir * this.cfg.strafe;
        if (this.jumpTimer <= 0 && Math.random() < 0.012) {
          jump = true;
          this.jumpTimer = 1.4;
        }
        break;
      }
      case STATE.COVER: {
        if (this.canBuild && this.stateTime < 0.5) {
          this._buildCover(game);
        }
        // Hinter der frischen Wand zurückweichen.
        wishX = -forward.x * 0.6;
        wishZ = -forward.z * 0.6;
        break;
      }
      case STATE.RELOAD: {
        this.loadout.startReload();
        wishX = -forward.x * 0.5 + right.x * this.strafeDir * 0.6;
        wishZ = -forward.z * 0.5 + right.z * this.strafeDir * 0.6;
        break;
      }
    }

    // Vor einem Hindernis: erst seitlich herumgehen, und nur wenn das nichts
    // bringt, eine Rampe darüber bauen. Umgekehrt verbaut sich der Bot die
    // halbe Arena, sobald er einmal in eine Deckung läuft.
    if ((this.state === STATE.SEEK || this.state === STATE.ENGAGE) && this._blockedAhead(game)) {
      if (this.detourTimer > 0) {
        // läuft schon außen herum
      } else if (this.detourCooldown <= 0) {
        this._startDetour();
      } else if (this.canBuild && Math.random() < this.cfg.buildChance) {
        this._buildRamp(game);
      } else {
        jump = true;
      }
    }

    this.step(dt, game.colliders, { wishX, wishZ, jump, sprinting, ads: false });

    // Feuern: bei freier Sicht auf das Ziel, oder auf die Wand dazwischen,
    // damit sich der Bot nicht selbst aussperrt.
    if (this.reactionTimer <= 0 && this.loadout.canFire() && this.state !== STATE.RELOAD) {
      const shootable = visible || (this.sawTarget && this._blockedByBuild(game, distance));
      if (shootable && distance < this.loadout.def.range) {
        game.shoot(this);
      }
    }
  }

  /**
   * Kaum Fortschritt über ein knappes Zeitfenster? Dann steckt der Bot fest
   * (breite Deckung, Ecke, eigenes Bauteil) und weicht seitlich aus.
   */
  _trackProgress(dt) {
    this.progressTimer -= dt;
    this.detourTimer -= dt;
    this.detourCooldown -= dt;
    if (this.progressTimer > 0) return;

    const moved = this.position.distanceTo(this.progressPos);
    if (moved < 0.9 && this.detourTimer <= 0 && this.detourCooldown <= 0) {
      this._startDetour();
    }
    this.progressPos.copy(this.position);
    this.progressTimer = 0.7;
  }

  _startDetour() {
    this.detourTimer = 1.4;
    this.detourCooldown = 3.2;
    this.detourDir = Math.random() < 0.5 ? -1 : 1;
  }

  _buildCover(game) {
    const plan = planPlacement('wall', this.position, this.flatForward);
    if (game.tryBuildPlan(this, plan)) this.markBuilt();
  }

  _buildRamp(game) {
    const plan = planPlacement('ramp', this.position, this.flatForward);
    if (game.tryBuildPlan(this, plan)) this.markBuilt();
  }

  /** Steht direkt vor dem Bot etwas Hüfthohes im Weg? */
  _blockedAhead(game) {
    const from = new THREE.Vector3(this.position.x, this.position.y + 0.9, this.position.z);
    const dir = this.flatForward;
    const hit = raycast(from, dir, CELL * 0.75, game.colliders);
    return hit !== null;
  }

  /** Liegt zwischen Bot und Ziel ein gebautes Teil (und nicht nur die Arena)? */
  _blockedByBuild(game, distance) {
    const from = new THREE.Vector3(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    const hit = raycast(from, this.forward, Math.min(distance, this.loadout.def.range), game.colliders);
    return hit !== null && hit.collider !== null && hit.collider.type === 'build';
  }

  _syncMesh() {
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw + Math.PI;
  }
}

/** Kantiger Low-Poly-Gegner in Team-Rot. */
function buildBotMesh() {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xd94f3d, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x7d2b21, flatShading: true });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.38), body);
  torso.position.y = 1.12;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.36), body);
  head.position.y = 1.68;

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.04), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  visor.position.set(0, 1.7, -0.19);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.74, 0.26), dark);
  legL.position.set(-0.16, 0.37, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.2), dark);
  armL.position.set(-0.4, 1.14, 0);
  const armR = armL.clone();
  armR.position.x = 0.4;

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), new THREE.MeshLambertMaterial({ color: 0x2b3138, flatShading: true }));
  gun.position.set(0.34, 1.16, -0.36);

  group.add(torso, head, visor, legL, legR, armL, armR, gun);
  return group;
}
