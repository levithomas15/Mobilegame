// Der lokale Spieler: verbindet Eingabe, Actor-Physik, Kamera und Waffenmodell.

import * as THREE from 'three';
import {
  TEAM_PLAYER, EYE_HEIGHT, FOV, LOOK_PITCH_LIMIT,
} from './config.js';
import { Actor } from './actor.js';
import { planPlacement } from './building.js';

// Sitz des Waffenmodells vor der Kamera. Der Abstand ist entscheidend: bei 78°
// Blickwinkel bläht sich alles perspektivisch auf, was der Kamera zu nah kommt,
// und läuft dann als Balken aus der Bildecke. Das Modell steht deshalb ein
// gutes Stück vor der Kamera statt direkt davor.
const HIP_POS = new THREE.Vector3(0.145, -0.16, -0.52);
const ADS_POS = new THREE.Vector3(0, -0.078, -0.44);

const DEG = Math.PI / 180;
// Hochformat: `PerspectiveCamera.fov` ist der *senkrechte* Winkel. Bei einem
// hohen, schmalen Bild würde ein fester senkrechter Wert die waagerechte Sicht
// auf einen Sehschlitz zusammenziehen. Deshalb wird im Hochformat andersherum
// gerechnet — aus einem waagerechten Zielwinkel — und nach oben begrenzt,
// damit es nicht zur Fischaugenoptik wird.
// Mit dem Bedienfeld liegt das Seitenverhältnis hochkant bei etwa 0,75 statt
// 0,46. Ein waagerechtes Ziel von 64° ergibt dort rund 80° senkrecht — also
// praktisch derselbe senkrechte Winkel wie im Querformat (78°). Waagerecht
// sieht man im Querformat entsprechend mehr, weil das Bild breiter ist; das ist
// das übliche Verhalten und keine Bevorzugung einer Lage. Die Obergrenze greift
// nur noch bei extrem hohen Geräten.
const PORTRAIT_H_FOV = 64;
const PORTRAIT_V_FOV_MAX = 92;

/** Grund-Blickwinkel (senkrecht, in Grad) für ein Seitenverhältnis. */
export function baseFov(aspect) {
  if (aspect >= 1) return FOV; // Querformat bleibt unverändert
  const vertical = (2 * Math.atan(Math.tan((PORTRAIT_H_FOV / 2) * DEG) / aspect)) / DEG;
  return Math.min(vertical, PORTRAIT_V_FOV_MAX);
}

export class Player extends Actor {
  constructor(camera) {
    super(TEAM_PLAYER);
    this.camera = camera;
    this.prevPosition = new THREE.Vector3();
    this.ads = false;
    this.sprinting = false;
    this.moving = false;
    this.bobPhase = 0;
    this.viewRecoil = 0;

    this.viewModel = buildViewModel();
    camera.add(this.viewModel);
  }

  /** Blickdelta anwenden — pro Bild, nicht pro Simulationsschritt. */
  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT);
  }

  /** Ein Simulationsschritt. `game` löst Schüsse und Bauen aus. */
  update(dt, input, game) {
    this.prevPosition.copy(this.position);
    if (!this.alive) return;

    this.tickTimers(dt);

    const weaponSlot = input.takeWeaponRequest();
    if (weaponSlot !== null) this.loadout.select(weaponSlot);

    if (input.consume('toggleBuild')) this.buildMode = !this.buildMode;
    if (input.consume('reload')) this.loadout.startReload();

    // Bewegungsrichtung aus Joystick/Tasten in Weltkoordinaten drehen.
    // vorwärts = (sin yaw, cos yaw), rechts = vorwärts x oben = (-cos yaw, sin yaw)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = input.move.y * sin - input.move.x * cos;
    const wishZ = input.move.y * cos + input.move.x * sin;

    this.moving = Math.hypot(input.move.x, input.move.y) > 0.15;
    this.ads = input.isDown('ads') && !this.buildMode;
    this.sprinting = input.sprinting && this.moving && !this.ads;

    this.step(dt, game.colliders, {
      wishX, wishZ,
      jump: input.isDown('jump'),
      sprinting: this.sprinting,
      ads: this.ads,
    });

    // Bauen: Wand und Rampe haben eigene Buttons, deshalb kein Modus-Zwang.
    if (input.isDown('wall')) game.tryBuild(this, 'wall');
    if (input.isDown('ramp')) game.tryBuild(this, 'ramp');

    const def = this.loadout.def;
    const wantsFire = def.auto ? input.isDown('fire') : input.consume('fire');
    if (wantsFire && !this.buildMode) game.shoot(this);

    this.bobPhase += dt * (this.sprinting ? 13 : 9) * (this.moving && this.grounded ? 1 : 0);
    this.viewRecoil = Math.max(0, this.viewRecoil - dt * 6);
  }

  /** Wohin käme das nächste Bauteil? Für die Vorschau. */
  currentPlan(type) {
    return planPlacement(type, this.position, this.flatForward);
  }

  /**
   * Kamera pro Bild setzen. `alpha` interpoliert zwischen den letzten beiden
   * Simulationsschritten, damit die Sicht auch bei 120 Hz glatt bleibt.
   */
  updateCamera(camera, alpha, dt) {
    const x = THREE.MathUtils.lerp(this.prevPosition.x, this.position.x, alpha);
    const y = THREE.MathUtils.lerp(this.prevPosition.y, this.position.y, alpha);
    const z = THREE.MathUtils.lerp(this.prevPosition.z, this.position.z, alpha);

    const bob = this.moving && this.grounded ? Math.sin(this.bobPhase) * (this.ads ? 0.012 : 0.045) : 0;
    camera.position.set(x, y + EYE_HEIGHT + bob, z);

    const roll = this.moving && this.grounded ? Math.cos(this.bobPhase * 0.5) * (this.ads ? 0.002 : 0.012) : 0;
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw + Math.PI; // Kamera blickt entlang -Z
    camera.rotation.x = -this.pitch;
    camera.rotation.z = roll;

    const base = baseFov(camera.aspect);
    const targetFov = this.ads ? base * this.loadout.def.adsZoom : base;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 14, dt);
      camera.updateProjectionMatrix();
    }

    // Waffenmodell zwischen Hüfte und Kimme bewegen.
    const target = this.ads ? ADS_POS : HIP_POS;
    this.viewModel.position.lerp(target, Math.min(1, dt * 16));
    this.viewModel.position.z += this.viewRecoil * 0.06;
    this.viewModel.rotation.x = this.viewRecoil * 0.5 + (this.sprinting ? 0.35 : 0);
    this.viewModel.rotation.z = this.sprinting ? 0.28 : 0;
    this.viewModel.visible = !this.buildMode;
  }

  kick(amount) { this.viewRecoil = Math.min(1, this.viewRecoil + amount); }
}

/** Schlichtes Low-Poly-Gewehr, an der Kamera befestigt. */
function buildViewModel() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.06, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x5d6874, flatShading: true }),
  );
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, 0.026, 0.13),
    new THREE.MeshLambertMaterial({ color: 0x3d4650, flatShading: true }),
  );
  barrel.position.set(0, 0.006, -0.16);
  const magazine = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.085, 0.045),
    new THREE.MeshLambertMaterial({ color: 0x3d4650, flatShading: true }),
  );
  magazine.position.set(0, -0.062, -0.015);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.082, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x6b7682, flatShading: true }),
  );
  grip.position.set(0, -0.055, 0.062);
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.024, 0.03),
    new THREE.MeshLambertMaterial({ color: 0x262c33, flatShading: true }),
  );
  sight.position.set(0, 0.042, -0.05);

  group.add(body, barrel, magazine, grip, sight);
  group.position.copy(HIP_POS);
  group.renderOrder = 3;
  // Nie von Weltgeometrie verdeckt: das Modell steckt bewusst nah an der Kamera.
  group.traverse((o) => { if (o.material) o.material.depthTest = true; });
  return group;
}
