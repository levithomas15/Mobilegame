// AABB-Physik. Spieler, Bot, Arena-Blöcke und gebaute Teile sind allesamt
// achsenparallele Boxen, deshalb reicht hier eine einzige Kollisionsroutine für
// Bewegung, Bauen und Schüsse.

import * as THREE from 'three';
import { STEP_HEIGHT } from './config.js';

const _box = new THREE.Box3();
const _probe = new THREE.Box3();
const _ray = new THREE.Ray();
const _hitPoint = new THREE.Vector3();

/** Collider-Objekt, wie es World und Building erzeugen. */
export function makeCollider(box, { type = 'world', piece = null, solid = true } = {}) {
  return { box, type, piece, solid, alive: true };
}

/** Achsenparallele Box einer Figur: Ursprung ist der Fußpunkt. */
export function entityBox(position, radius, height, target = new THREE.Box3()) {
  target.min.set(position.x - radius, position.y, position.z - radius);
  target.max.set(position.x + radius, position.y + height, position.z + radius);
  return target;
}

/**
 * Grobfilter: nur Collider zurückgeben, die in der Nähe der geplanten Bewegung
 * liegen. Spart bei ein paar hundert Bauteilen den Großteil der Box-Tests.
 */
export function broadphase(colliders, position, radius, height, motion, out = []) {
  out.length = 0;
  const pad = 0.5;
  const minX = Math.min(position.x, position.x + motion.x) - radius - pad;
  const maxX = Math.max(position.x, position.x + motion.x) + radius + pad;
  const minY = Math.min(position.y, position.y + motion.y) - pad - STEP_HEIGHT;
  const maxY = Math.max(position.y, position.y + motion.y) + height + pad;
  const minZ = Math.min(position.z, position.z + motion.z) - radius - pad;
  const maxZ = Math.max(position.z, position.z + motion.z) + radius + pad;

  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!c.alive || !c.solid) continue;
    const b = c.box;
    if (b.max.x < minX || b.min.x > maxX) continue;
    if (b.max.y < minY || b.min.y > maxY) continue;
    if (b.max.z < minZ || b.min.z > maxZ) continue;
    out.push(c);
  }
  return out;
}

function overlaps(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

/**
 * Bewegt eine Figur um `motion` und löst Kollisionen achsenweise auf
 * (erst Y, dann X, dann Z). Nutzt Step-Up, damit Rampenstufen und niedrige
 * Kanten überlaufen werden statt zu blockieren.
 *
 * Gibt zurück, welche Achsen blockiert wurden.
 */
export function moveEntity(position, radius, height, motion, nearby) {
  const result = { grounded: false, hitCeiling: false, hitWall: false };

  // --- Y ---
  if (motion.y !== 0) {
    position.y += motion.y;
    entityBox(position, radius, height, _box);
    for (let i = 0; i < nearby.length; i++) {
      const b = nearby[i].box;
      if (!overlaps(_box, b)) continue;
      if (motion.y < 0) {
        position.y = b.max.y;
        result.grounded = true;
      } else {
        position.y = b.min.y - height;
        result.hitCeiling = true;
      }
      entityBox(position, radius, height, _box);
    }
  }

  // --- Horizontal, mit Step-Up ---
  result.hitWall = moveAxis(position, radius, height, 'x', motion.x, nearby) || result.hitWall;
  result.hitWall = moveAxis(position, radius, height, 'z', motion.z, nearby) || result.hitWall;

  return result;
}

function moveAxis(position, radius, height, axis, delta, nearby) {
  if (delta === 0) return false;

  const before = position[axis];
  position[axis] += delta;
  entityBox(position, radius, height, _box);

  let blocker = null;
  for (let i = 0; i < nearby.length; i++) {
    if (overlaps(_box, nearby[i].box)) { blocker = nearby[i]; break; }
  }
  if (!blocker) return false;

  // Versuch, die Kante hochzusteigen: passt die Figur, wenn sie um bis zu
  // STEP_HEIGHT angehoben wird? Dann ist es eine Stufe und keine Wand.
  const stepTop = blocker.box.max.y;
  const rise = stepTop - position.y;
  if (rise > 0 && rise <= STEP_HEIGHT) {
    _probe.min.set(position.x - radius, stepTop, position.z - radius);
    _probe.max.set(position.x + radius, stepTop + height, position.z + radius);
    let free = true;
    for (let i = 0; i < nearby.length; i++) {
      if (overlaps(_probe, nearby[i].box)) { free = false; break; }
    }
    if (free) {
      position.y = stepTop;
      return false;
    }
  }

  // Echte Wand: an die Kante zurücksetzen.
  const b = blocker.box;
  position[axis] = delta > 0
    ? b.min[axis] - radius - 1e-4
    : b.max[axis] + radius + 1e-4;

  // Zweiter Collider auf gleicher Achse (z.B. Ecke) — konservativ zurücknehmen.
  entityBox(position, radius, height, _box);
  for (let i = 0; i < nearby.length; i++) {
    if (overlaps(_box, nearby[i].box)) { position[axis] = before; break; }
  }
  return true;
}

/** Steht die Figur auf festem Boden? Kurzer Test knapp unter den Füßen. */
export function groundCheck(position, radius, height, nearby) {
  _probe.min.set(position.x - radius, position.y - 0.08, position.z - radius);
  _probe.max.set(position.x + radius, position.y + 0.02, position.z + radius);
  for (let i = 0; i < nearby.length; i++) {
    if (overlaps(_probe, nearby[i].box)) return true;
  }
  return false;
}

function normalFromHit(box, point) {
  const eps = 1e-3;
  if (Math.abs(point.x - box.min.x) < eps) return new THREE.Vector3(-1, 0, 0);
  if (Math.abs(point.x - box.max.x) < eps) return new THREE.Vector3(1, 0, 0);
  if (Math.abs(point.y - box.min.y) < eps) return new THREE.Vector3(0, -1, 0);
  if (Math.abs(point.y - box.max.y) < eps) return new THREE.Vector3(0, 1, 0);
  if (Math.abs(point.z - box.min.z) < eps) return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 0, 1);
}

/**
 * Hitscan gegen alle Collider. `extraBoxes` nimmt Figuren-Boxen auf
 * (Spieler/Bot), damit Treffer und Weltgeometrie in einem Durchgang
 * gegeneinander sortiert werden.
 */
export function raycast(origin, direction, maxDist, colliders, extraBoxes = []) {
  _ray.origin.copy(origin);
  _ray.direction.copy(direction);

  let best = null;
  let bestDist = maxDist;

  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!c.alive || !c.solid) continue;
    if (_ray.intersectBox(c.box, _hitPoint)) {
      const d = origin.distanceTo(_hitPoint);
      if (d < bestDist) {
        bestDist = d;
        best = { distance: d, point: _hitPoint.clone(), collider: c, target: null };
      }
    }
  }

  for (let i = 0; i < extraBoxes.length; i++) {
    const e = extraBoxes[i];
    if (_ray.intersectBox(e.box, _hitPoint)) {
      const d = origin.distanceTo(_hitPoint);
      if (d < bestDist) {
        bestDist = d;
        best = { distance: d, point: _hitPoint.clone(), collider: null, target: e.owner };
      }
    }
  }

  if (best) best.normal = best.collider ? normalFromHit(best.collider.box, best.point) : new THREE.Vector3(0, 1, 0);
  return best;
}

/** Freie Sichtlinie zwischen zwei Punkten (ignoriert Figuren). */
export function hasLineOfSight(from, to, colliders) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist < 1e-4) return true;
  dir.divideScalar(dist);
  const hit = raycast(from, dir, dist - 0.05, colliders);
  return hit === null;
}
