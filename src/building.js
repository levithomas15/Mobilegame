// Bau-System: rastergebundene Wände und Rampen, zerstörbar.
// Spieler und Bot benutzen dieselben Funktionen — der Bot baut Deckung mit
// exakt derselben Logik wie du.

import * as THREE from 'three';
import {
  CELL, RAMP_STEPS, WALL_THICKNESS, WALL_HP, RAMP_HP, MAX_PIECES,
  TEAM_PLAYER,
} from './config.js';
import { makeCollider } from './physics.js';

const RAMP_THICKNESS = 0.34;
const SQRT2 = Math.SQRT2;

const TEAM_COLOR = {
  [TEAM_PLAYER]: new THREE.Color(0x4ea8ff),
  bot: new THREE.Color(0xff6b57),
};

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _tmpColor = new THREE.Color();

/** Blickrichtung auf die dominante Rasterachse reduzieren. */
export function dominantDirection(forward) {
  return Math.abs(forward.x) > Math.abs(forward.z)
    ? { dx: Math.sign(forward.x) || 1, dz: 0 }
    : { dx: 0, dz: Math.sign(forward.z) || 1 };
}

// Waagerechtes Raster: Zellmitte liegt auf i * CELL, nicht auf der Kante.
// Dadurch erscheint eine Wand mittig vor dem Bauenden statt seitlich versetzt —
// bei kantenzentriertem Raster wäre genau der Spawnpunkt (x = 0) der schlimmste
// Fall gewesen.
function hCell(v) { return Math.round(v / CELL); }

// Senkrecht bleibt es kantenbasiert: Etagenböden liegen auf Vielfachen von CELL,
// und darauf steht man.
function floorCell(y) { return Math.floor((y + 0.1) / CELL); }

/**
 * Wohin käme das Bauteil, wenn jetzt gebaut wird? Reine Rechnung ohne
 * Seiteneffekte — Vorschau, Platzierung und Bot-KI teilen sich das Ergebnis.
 */
export function planPlacement(type, position, forward) {
  const dir = dominantDirection(forward);
  const ci = hCell(position.x);
  const ck = hCell(position.z);
  const cy = floorCell(position.y);
  const baseY = cy * CELL;

  if (type === 'wall') {
    // Wand steht auf der Zellgrenze in Blickrichtung, mittig vor dem Bauenden.
    // Der Schlüssel rechnet in Halbschritten, damit dieselbe Grenze von beiden
    // Seiten aus denselben Schlüssel ergibt.
    return {
      type: 'wall',
      key: `w:${ci * 2 + dir.dx}:${cy}:${ck * 2 + dir.dz}`,
      center: new THREE.Vector3(
        ci * CELL + (dir.dx * CELL) / 2,
        baseY + CELL / 2,
        ck * CELL + (dir.dz * CELL) / 2,
      ),
      dir,
      baseY,
    };
  }

  // Rampe belegt die Nachbarzelle und steigt in Blickrichtung an.
  return {
    type: 'ramp',
    key: `r:${ci + dir.dx}:${cy}:${ck + dir.dz}`,
    center: new THREE.Vector3((ci + dir.dx) * CELL, baseY + CELL / 2, (ck + dir.dz) * CELL),
    dir,
    baseY,
  };
}

function wallBox(plan) {
  const { center, dir } = plan;
  const halfW = CELL / 2;
  const halfT = WALL_THICKNESS / 2;
  const hx = dir.dx !== 0 ? halfT : halfW;
  const hz = dir.dz !== 0 ? halfT : halfW;
  return new THREE.Box3(
    new THREE.Vector3(center.x - hx, plan.baseY, center.z - hz),
    new THREE.Vector3(center.x + hx, plan.baseY + CELL, center.z + hz),
  );
}

/** Rampe als gestapelte Stufen — dadurch bleibt die Kollision reine AABB. */
function rampBoxes(plan) {
  const { center, dir, baseY } = plan;
  const boxes = [];
  const stepDepth = CELL / RAMP_STEPS;
  const stepRise = CELL / RAMP_STEPS;
  const runAxis = dir.dx !== 0 ? 'x' : 'z';
  const runSign = dir.dx !== 0 ? dir.dx : dir.dz;
  const startEdge = center[runAxis] - (CELL / 2) * runSign;

  for (let i = 0; i < RAMP_STEPS; i++) {
    const a = startEdge + stepDepth * i * runSign;
    const b = startEdge + stepDepth * (i + 1) * runSign;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const top = baseY + stepRise * (i + 1);

    const min = new THREE.Vector3();
    const max = new THREE.Vector3();
    if (runAxis === 'x') {
      min.set(lo, baseY, center.z - CELL / 2);
      max.set(hi, top, center.z + CELL / 2);
    } else {
      min.set(center.x - CELL / 2, baseY, lo);
      max.set(center.x + CELL / 2, top, hi);
    }
    boxes.push(new THREE.Box3(min, max));
  }
  return boxes;
}

export class Building {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders; // gemeinsames Array mit der Welt
    this.pieces = [];
    this.occupied = new Set();

    this.wallMesh = this._makeInstanced(new THREE.BoxGeometry(1, 1, 1), MAX_PIECES);
    this.rampMesh = this._makeInstanced(new THREE.BoxGeometry(1, 1, 1), MAX_PIECES);
    scene.add(this.wallMesh, this.rampMesh);

    this.ghost = this._makeGhost();
    scene.add(this.ghost);
  }

  _makeInstanced(geo, count) {
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  _makeGhost() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8ee6ff, transparent: true, opacity: 0.32,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Ist an dieser Stelle schon etwas? */
  isOccupied(plan) { return this.occupied.has(plan.key); }

  /**
   * Bauteil setzen. Gibt `false` zurück, wenn der Platz belegt ist oder das
   * Teil eine Figur einschließen würde. `blockedBoxes` enthält deshalb die
   * Körper *beider* Kämpfer — sonst könnte man dem Gegner eine Wand in den
   * Körper setzen und ihn damit einsperren.
   */
  place(plan, team, blockedBoxes = []) {
    if (this.occupied.has(plan.key)) return false;
    if (plan.baseY < -0.5) return false;

    const boxes = plan.type === 'wall' ? [wallBox(plan)] : rampBoxes(plan);
    for (const blocked of blockedBoxes) {
      for (const b of boxes) {
        if (b.intersectsBox(blocked)) return false;
      }
    }

    const piece = {
      key: plan.key,
      type: plan.type,
      team,
      center: plan.center.clone(),
      dir: plan.dir,
      baseY: plan.baseY,
      hp: plan.type === 'wall' ? WALL_HP : RAMP_HP,
      maxHp: plan.type === 'wall' ? WALL_HP : RAMP_HP,
      colliders: [],
      alive: true,
    };

    for (const box of boxes) {
      const c = makeCollider(box, { type: 'build', piece });
      piece.colliders.push(c);
      this.colliders.push(c);
    }

    this.pieces.push(piece);
    this.occupied.add(plan.key);

    // Ältestes Teil weichen lassen, damit die Instanz-Pools nicht überlaufen.
    if (this.pieces.length > MAX_PIECES) {
      this.destroy(this.pieces.find((p) => p.alive));
    }

    this._refreshInstances();
    return true;
  }

  /** Schaden auf ein Bauteil. Gibt `true` zurück, wenn es zerstört wurde. */
  damage(piece, amount) {
    if (!piece || !piece.alive) return false;
    piece.hp -= amount;
    if (piece.hp <= 0) { this.destroy(piece); return true; }
    this._refreshInstances();
    return false;
  }

  destroy(piece) {
    if (!piece || !piece.alive) return;
    piece.alive = false;
    this.occupied.delete(piece.key);
    for (const c of piece.colliders) {
      c.alive = false;
      const idx = this.colliders.indexOf(c);
      if (idx !== -1) this.colliders.splice(idx, 1);
    }
    piece.colliders.length = 0;
    const pi = this.pieces.indexOf(piece);
    if (pi !== -1) this.pieces.splice(pi, 1);
    this._refreshInstances();
  }

  clear() {
    for (const piece of [...this.pieces]) this.destroy(piece);
    this.pieces.length = 0;
    this.occupied.clear();
    this._refreshInstances();
  }

  /**
   * Instanz-Matrizen neu schreiben. Passiert nur beim Bauen und Zerstören,
   * nicht pro Frame — bei maximal ein paar hundert Teilen ist das billiger
   * als eine Freilisten-Verwaltung.
   */
  _refreshInstances() {
    let wallCount = 0;
    let rampCount = 0;

    for (const piece of this.pieces) {
      if (!piece.alive) continue;
      const isWall = piece.type === 'wall';
      const mesh = isWall ? this.wallMesh : this.rampMesh;
      const index = isWall ? wallCount++ : rampCount++;

      if (isWall) {
        _quat.identity();
        _scale.set(
          piece.dir.dx !== 0 ? WALL_THICKNESS : CELL,
          CELL,
          piece.dir.dz !== 0 ? WALL_THICKNESS : CELL,
        );
      } else {
        const yaw = Math.atan2(piece.dir.dx, piece.dir.dz);
        _euler.set(0, yaw, 0, 'YXZ');
        _quat.setFromEuler(_euler);
        // 45°-Neigung um die lokale X-Achse, danach in Laufrichtung gedreht.
        _quat.multiply(_tilt);
        _scale.set(CELL, RAMP_THICKNESS, CELL * SQRT2);
      }

      _pos.copy(piece.center);
      _mat4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(index, _mat4);

      // Beschädigte Teile werden sichtbar dunkler.
      const base = TEAM_COLOR[piece.team] || TEAM_COLOR[TEAM_PLAYER];
      const wear = 0.35 + 0.65 * Math.max(piece.hp / piece.maxHp, 0);
      mesh.setColorAt(index, _tmpColor.copy(base).multiplyScalar(wear));
    }

    this.wallMesh.count = wallCount;
    this.rampMesh.count = rampCount;
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.rampMesh.instanceMatrix.needsUpdate = true;
    if (this.wallMesh.instanceColor) this.wallMesh.instanceColor.needsUpdate = true;
    if (this.rampMesh.instanceColor) this.rampMesh.instanceColor.needsUpdate = true;
  }

  /** Vorschau anzeigen, solange der Baumodus aktiv ist. */
  updateGhost(plan, visible) {
    if (!visible || !plan) { this.ghost.visible = false; return; }
    this.ghost.visible = true;

    const blocked = this.isOccupied(plan);
    this.ghost.material.color.setHex(blocked ? 0xff5c5c : 0x8ee6ff);

    if (plan.type === 'wall') {
      this.ghost.quaternion.identity();
      this.ghost.scale.set(
        plan.dir.dx !== 0 ? WALL_THICKNESS : CELL,
        CELL,
        plan.dir.dz !== 0 ? WALL_THICKNESS : CELL,
      );
    } else {
      const yaw = Math.atan2(plan.dir.dx, plan.dir.dz);
      _euler.set(0, yaw, 0, 'YXZ');
      this.ghost.quaternion.setFromEuler(_euler);
      this.ghost.quaternion.multiply(_tilt);
      this.ghost.scale.set(CELL, RAMP_THICKNESS, CELL * SQRT2);
    }
    this.ghost.position.copy(plan.center);
  }
}
