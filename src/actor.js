// Gemeinsame Basis für Spieler und Bot: Position, Physik, Leben, Waffen.
// Beide bewegen sich mit denselben Regeln — der Bot hat keine Sonderphysik.

import * as THREE from 'three';
import {
  PLAYER_HEIGHT, PLAYER_RADIUS, EYE_HEIGHT, MAX_HEALTH, GRAVITY,
  WALK_SPEED, SPRINT_SPEED, ADS_SPEED, JUMP_SPEED,
  GROUND_RESPONSE, AIR_RESPONSE, ARENA_HALF,
  BUILD_COOLDOWN,
} from './config.js';
import { moveEntity, broadphase, groundCheck, entityBox } from './physics.js';
import { Loadout } from './weapons.js';

const _wish = new THREE.Vector3();
const _motion = new THREE.Vector3();
const _forward = new THREE.Vector3();

export class Actor {
  constructor(team) {
    this.team = team;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.grounded = false;
    this.loadout = new Loadout();
    this.buildMode = false;
    this.buildCooldown = 0;
    this.radius = PLAYER_RADIUS;
    this.height = PLAYER_HEIGHT;
    this._box = new THREE.Box3();
    this._nearby = [];
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
  }

  /** Kollisionsbox am aktuellen Ort (wiederverwendet, nicht kopieren). */
  get box() {
    return entityBox(this.position, this.radius, this.height, this._box);
  }

  get forward() {
    return _forward.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize().clone();
  }

  /** Blickrichtung ohne Neigung — für Bewegung und Bauen. */
  get flatForward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  spawn(spawnPoint) {
    this.position.copy(spawnPoint.position);
    this.velocity.set(0, 0, 0);
    this.yaw = spawnPoint.yaw;
    this.pitch = 0;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.grounded = true;
    this.buildMode = false;
    this.buildCooldown = 0;
    this.loadout.resetAmmo();
  }

  applyDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true; // getötet
    }
    return false;
  }

  /**
   * Bewegung für einen Simulationsschritt.
   * `wishX`/`wishZ` sind die gewünschte Richtung in Weltkoordinaten (-1..1).
   */
  step(dt, colliders, { wishX, wishZ, jump, sprinting, ads }) {
    const speed = ads ? ADS_SPEED : (sprinting ? SPRINT_SPEED : WALK_SPEED);

    _wish.set(wishX, 0, wishZ);
    if (_wish.lengthSq() > 1) _wish.normalize();
    const target = _wish.multiplyScalar(speed);

    // In der Luft greift dieselbe Annäherung, nur viel schwächer — dadurch
    // bleibt ein Sprung berechenbar, ohne dass man in der Luft festklebt.
    const k = Math.min(1, (this.grounded ? GROUND_RESPONSE : AIR_RESPONSE) * dt);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;

    if (jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -60) this.velocity.y = -60;

    _motion.copy(this.velocity).multiplyScalar(dt);
    broadphase(colliders, this.position, this.radius, this.height, _motion, this._nearby);

    const before = this.position.y;
    const result = moveEntity(this.position, this.radius, this.height, _motion, this._nearby);

    if (result.grounded || (this.position.y > before && this.velocity.y <= 0)) {
      this.velocity.y = 0;
      this.grounded = true;
    } else if (result.hitCeiling) {
      this.velocity.y = 0;
      this.grounded = false;
    } else {
      this.grounded = groundCheck(this.position, this.radius, this.height, this._nearby);
      if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    }

    // Sicherheitsnetz: niemand verlässt die Arena.
    const limit = ARENA_HALF - this.radius - 0.2;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -limit, limit);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -limit, limit);
    if (this.position.y < -5) {
      this.position.y = 0.05;
      this.velocity.set(0, 0, 0);
    }
  }

  tickTimers(dt) {
    this.loadout.update(dt);
    this.buildCooldown = Math.max(0, this.buildCooldown - dt);
  }

  get canBuild() { return this.buildCooldown <= 0; }
  markBuilt() { this.buildCooldown = BUILD_COOLDOWN; }
}
