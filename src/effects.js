// Leuchtspur, Einschläge und Mündungsfeuer. Alles aus festen Pools, damit im
// Gefecht keine Allokationen anfallen und der Garbage Collector ruhig bleibt.

import * as THREE from 'three';

const TRACER_POOL = 28;
const IMPACT_POOL = 24;
const TRACER_LIFE = 0.055;
const IMPACT_LIFE = 0.35;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.impacts = [];

    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xfff0b0, transparent: true, opacity: 0.85, depthWrite: false,
    });
    for (let i = 0; i < TRACER_POOL; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(),
      ]);
      const line = new THREE.Line(geo, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }

    const impactGeo = new THREE.PlaneGeometry(0.32, 0.32);
    for (let i = 0; i < IMPACT_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 1,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(impactGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.impacts.push({ mesh, life: 0 });
    }

    this.muzzle = new THREE.PointLight(0xffcc77, 0, 9);
    scene.add(this.muzzle);
    this.muzzleLife = 0;
  }

  tracer(from, to, color = 0xfff0b0) {
    const slot = this.tracers.find((t) => t.life <= 0) || this.tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.material.color.setHex(color);
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.life = TRACER_LIFE;
  }

  impact(point, normal, color = 0xffd27a) {
    const slot = this.impacts.find((i) => i.life <= 0) || this.impacts[0];
    slot.mesh.position.copy(point).addScaledVector(normal, 0.02);
    slot.mesh.lookAt(point.clone().add(normal));
    slot.mesh.material.color.setHex(color);
    slot.mesh.material.opacity = 1;
    slot.mesh.scale.setScalar(1);
    slot.mesh.visible = true;
    slot.life = IMPACT_LIFE;
  }

  muzzleFlash(position) {
    this.muzzle.position.copy(position);
    this.muzzle.intensity = 4.5;
    this.muzzleLife = 0.05;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; continue; }
      t.line.material.opacity = 0.85 * (t.life / TRACER_LIFE);
    }

    for (const i of this.impacts) {
      if (i.life <= 0) continue;
      i.life -= dt;
      if (i.life <= 0) { i.mesh.visible = false; continue; }
      const k = i.life / IMPACT_LIFE;
      i.mesh.material.opacity = k;
      i.mesh.scale.setScalar(1 + (1 - k) * 1.6);
    }

    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      if (this.muzzleLife <= 0) this.muzzle.intensity = 0;
    }
  }

  clear() {
    for (const t of this.tracers) { t.life = 0; t.line.visible = false; }
    for (const i of this.impacts) { i.life = 0; i.mesh.visible = false; }
    this.muzzle.intensity = 0;
    this.muzzleLife = 0;
  }
}
