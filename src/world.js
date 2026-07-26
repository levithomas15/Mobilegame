// Arena: Boden, Begrenzung, Deckungsblöcke, Licht.
// Das Layout ist punktsymmetrisch, damit im 1v1 keine Seite bevorteilt ist.

import * as THREE from 'three';
import { ARENA_HALF } from './config.js';
import { makeCollider } from './physics.js';

// Halbe Arena; die andere Hälfte entsteht daraus gespiegelt.
const COVER_LAYOUT = [
  { x: 0, z: 12, w: 10, h: 3.2, d: 1.4 },
  { x: -9, z: 7, w: 1.4, h: 4.5, d: 8 },
  { x: 12, z: 16, w: 6, h: 2.2, d: 6 },
  { x: -16, z: 18, w: 5, h: 5.5, d: 5 },
  { x: 20, z: 6, w: 1.4, h: 3.4, d: 10 },
  { x: 6, z: 24, w: 7, h: 1.6, d: 1.4 },
  { x: -22, z: 3, w: 4, h: 2.6, d: 4 },
  { x: 0, z: 26, w: 3, h: 6.5, d: 3 },
];

const PALETTE = {
  ground: 0x4d5a66,
  grid: 0x38424c,
  cover: 0x7f8d9a,
  coverAlt: 0x9aa7b3,
  boundary: 0x59646f,
  sky: 0x8fb6d4,
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.spawns = [
      { position: new THREE.Vector3(0, 0.05, -ARENA_HALF + 7), yaw: 0 },
      { position: new THREE.Vector3(0, 0.05, ARENA_HALF - 7), yaw: Math.PI },
    ];

    this._buildLighting();
    this._buildGround();
    this._buildBoundary();
    this._buildCover();
  }

  _buildLighting() {
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.sky, 55, 130);

    // Intensitäten sind auf die physikalisch gerechneten Lichter ab three r155
    // ausgelegt. Mit den alten Werten (~1.0) wird die Arena fast schwarz.
    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x6e7885, 2.6);
    this.scene.add(hemi);

    // Richtungslicht ohne Schattenkarte: auf schwachen Handys ist der
    // Shadow-Pass der teuerste Einzelposten, die Flat-Shading-Optik trägt
    // die Lesbarkeit auch ohne.
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(28, 46, 18);
    this.scene.add(sun);

    // Gegenlicht: ohne das bleiben alle vom Spieler aus sichtbaren Rückseiten
    // dunkel, weil man der Sonne beim Vorrücken den Rücken zudreht.
    const fill = new THREE.DirectionalLight(0xbdd6ee, 1.2);
    fill.position.set(-24, 18, -22);
    this.scene.add(fill);
  }

  _addBox(x, y, z, w, h, d, color, { solid = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    this.group.add(mesh);

    const box = new THREE.Box3(
      new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    );
    this.colliders.push(makeCollider(box, { type: 'world', solid }));
    return mesh;
  }

  _buildGround() {
    const size = ARENA_HALF * 2;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.ground });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    const grid = new THREE.GridHelper(size, size / 3, PALETTE.grid, PALETTE.grid);
    grid.position.y = 0.01;
    grid.material.opacity = 0.65;
    grid.material.transparent = true;
    this.group.add(grid);

    // Boden als dicker Collider, damit nichts durchfallen kann.
    this.colliders.push(makeCollider(new THREE.Box3(
      new THREE.Vector3(-ARENA_HALF - 10, -8, -ARENA_HALF - 10),
      new THREE.Vector3(ARENA_HALF + 10, 0, ARENA_HALF + 10),
    ), { type: 'ground' }));
  }

  _buildBoundary() {
    const h = 14;
    const t = 2;
    const s = ARENA_HALF;
    this._addBox(0, 0, -s - t / 2, s * 2 + t * 2, h, t, PALETTE.boundary);
    this._addBox(0, 0, s + t / 2, s * 2 + t * 2, h, t, PALETTE.boundary);
    this._addBox(-s - t / 2, 0, 0, t, h, s * 2 + t * 2, PALETTE.boundary);
    this._addBox(s + t / 2, 0, 0, t, h, s * 2 + t * 2, PALETTE.boundary);
  }

  _buildCover() {
    COVER_LAYOUT.forEach((c, i) => {
      const color = i % 2 === 0 ? PALETTE.cover : PALETTE.coverAlt;
      this._addBox(c.x, 0, c.z, c.w, c.h, c.d, color);
      // Punktsymmetrische Kopie auf der gegenüberliegenden Hälfte.
      this._addBox(-c.x, 0, -c.z, c.w, c.h, c.d, color);
    });
  }
}
