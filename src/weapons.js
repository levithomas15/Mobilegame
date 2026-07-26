// Waffen: Definitionen, Magazin-/Nachlade-Zustand und Trefferauflösung.
// Alle drei Waffen sind Hitscan — bei Projektilflug müsste der Bot vorhalten,
// und das ist für den Prototyp unnötige Komplexität.

import * as THREE from 'three';
import { raycast } from './physics.js';

export const WEAPONS = [
  {
    id: 'rifle', name: 'Sturmgewehr', short: 'AR',
    damage: 19, headMultiplier: 1.9, rpm: 600, auto: true,
    hipSpread: 0.030, adsSpread: 0.009, pellets: 1,
    mag: 30, reloadTime: 2.0, range: 140,
    recoil: { pitch: 0.011, yaw: 0.004 },
    falloffStart: 45, falloffEnd: 120, falloffMin: 0.55,
    adsZoom: 0.72,
  },
  {
    id: 'shotgun', name: 'Schrotflinte', short: 'SG',
    damage: 12, headMultiplier: 1.4, rpm: 80, auto: false,
    hipSpread: 0.085, adsSpread: 0.055, pellets: 8,
    mag: 8, reloadTime: 2.6, range: 45,
    recoil: { pitch: 0.055, yaw: 0.010 },
    falloffStart: 9, falloffEnd: 30, falloffMin: 0.25,
    adsZoom: 0.85,
  },
  {
    id: 'sniper', name: 'Scharfschütze', short: 'SR',
    damage: 88, headMultiplier: 2.2, rpm: 48, auto: false,
    hipSpread: 0.070, adsSpread: 0.0008, pellets: 1,
    mag: 5, reloadTime: 3.1, range: 250,
    recoil: { pitch: 0.070, yaw: 0.012 },
    falloffStart: 250, falloffEnd: 260, falloffMin: 1.0,
    adsZoom: 0.34,
  },
];

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Munitions- und Nachladezustand einer Figur über alle Waffen hinweg. */
export class Loadout {
  constructor() {
    this.slots = WEAPONS.map((def) => ({
      def,
      ammo: def.mag,
      cooldown: 0,
      reloadTimer: 0,
    }));
    this.index = 0;
  }

  get current() { return this.slots[this.index]; }
  get def() { return this.slots[this.index].def; }
  get reloading() { return this.current.reloadTimer > 0; }

  select(index) {
    if (index < 0 || index >= this.slots.length || index === this.index) return false;
    this.current.reloadTimer = 0; // Waffenwechsel bricht das Nachladen ab
    this.index = index;
    return true;
  }

  update(dt) {
    for (const slot of this.slots) {
      slot.cooldown = Math.max(0, slot.cooldown - dt);
      if (slot.reloadTimer > 0) {
        slot.reloadTimer -= dt;
        if (slot.reloadTimer <= 0) {
          slot.reloadTimer = 0;
          slot.ammo = slot.def.mag;
        }
      }
    }
  }

  canFire() {
    const s = this.current;
    return s.cooldown <= 0 && s.reloadTimer <= 0 && s.ammo > 0;
  }

  /** Schuss abbuchen. Voraussetzung: `canFire()`. */
  consume() {
    const s = this.current;
    s.ammo -= 1;
    s.cooldown = 60 / s.def.rpm;
    if (s.ammo === 0) this.startReload();
  }

  startReload() {
    const s = this.current;
    if (s.reloadTimer > 0 || s.ammo === s.def.mag) return false;
    s.reloadTimer = s.def.reloadTime;
    return true;
  }

  resetAmmo() {
    for (const slot of this.slots) {
      slot.ammo = slot.def.mag;
      slot.cooldown = 0;
      slot.reloadTimer = 0;
    }
    this.index = 0;
  }
}

function damageAtRange(def, distance) {
  if (distance <= def.falloffStart) return def.damage;
  if (distance >= def.falloffEnd) return def.damage * def.falloffMin;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return def.damage * (1 - t * (1 - def.falloffMin));
}

/**
 * Einen Schuss auflösen. Liefert die Trefferliste; wer davon Schaden bekommt,
 * entscheidet der Aufrufer — so bleibt diese Datei frei von Spielzustand.
 */
export function fireWeapon({ origin, direction, def, spread, colliders, targets, random = Math.random }) {
  const hits = [];

  _right.crossVectors(direction, WORLD_UP).normalize();
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _up.crossVectors(_right, direction).normalize();

  for (let p = 0; p < def.pellets; p++) {
    // Gleichverteilte Streuung in einer Kreisscheibe um die Blickachse.
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * spread;
    _dir.copy(direction)
      .addScaledVector(_right, Math.cos(angle) * radius)
      .addScaledVector(_up, Math.sin(angle) * radius)
      .normalize();

    const hit = raycast(origin, _dir, def.range, colliders, targets);
    if (!hit) {
      hits.push({ miss: true, end: origin.clone().addScaledVector(_dir, def.range) });
      continue;
    }

    const isHead = hit.target ? hit.point.y > hit.target.position.y + 1.35 : false;
    const dmg = damageAtRange(def, hit.distance) * (isHead ? def.headMultiplier : 1);

    hits.push({
      miss: false,
      end: hit.point,
      normal: hit.normal,
      target: hit.target,
      piece: hit.collider ? hit.collider.piece : null,
      damage: dmg,
      headshot: isHead && !!hit.target,
    });
  }

  return hits;
}

/** Aktuelle Streuung: Zielen, Sprinten und Springen verändern sie deutlich. */
export function currentSpread(def, { ads, sprinting, airborne, moving }) {
  let spread = ads ? def.adsSpread : def.hipSpread;
  if (sprinting) spread *= 2.2;
  else if (moving) spread *= 1.35;
  if (airborne) spread *= 1.8;
  return spread;
}
