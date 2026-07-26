// HUD: schreibt Spielzustand in die DOM-Overlays. Enthält bewusst keine
// Spiellogik — nur Darstellung.

import { MAX_HEALTH } from './config.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {
      scorePlayer: root.querySelector('#score-player'),
      scoreBot: root.querySelector('#score-bot'),
      healthValue: root.querySelector('#health-value'),
      healthFill: root.querySelector('#health-fill'),
      enemyValue: root.querySelector('#enemy-health-value'),
      enemyFill: root.querySelector('#enemy-health-fill'),
      weaponName: root.querySelector('#weapon-name'),
      ammoCount: root.querySelector('#ammo-count'),
      ammoMag: root.querySelector('#ammo-mag'),
      ammoMax: root.querySelector('#ammo-max'),
      reloadHint: root.querySelector('#reload-hint'),
      hitmarker: root.querySelector('#hitmarker'),
      banner: root.querySelector('#banner'),
      damageFlash: root.querySelector('#damage-flash'),
      perf: root.querySelector('#perf'),
      slots: [...root.querySelectorAll('#hotbar .slot')],
      crossT: root.querySelector('.ch-t'),
      crossB: root.querySelector('.ch-b'),
      crossL: root.querySelector('.ch-l'),
      crossR: root.querySelector('.ch-r'),
    };

    this._lastHealth = MAX_HEALTH;
    this._flashTimer = 0;
    this._markerTimer = 0;
  }

  setScore(player, bot) {
    this.el.scorePlayer.textContent = String(player);
    this.el.scoreBot.textContent = String(bot);
  }

  update(player, bot, spread, dt) {
    const hp = Math.max(0, Math.round(player.health));
    this.el.healthValue.textContent = String(hp);
    this.el.healthFill.style.width = `${(hp / MAX_HEALTH) * 100}%`;

    const ehp = Math.max(0, Math.round(bot.health));
    this.el.enemyValue.textContent = String(ehp);
    this.el.enemyFill.style.width = `${(ehp / MAX_HEALTH) * 100}%`;

    if (hp < this._lastHealth) this.damageFlash();
    this._lastHealth = hp;

    const slot = player.loadout.current;
    this.el.weaponName.textContent = slot.def.name;
    this.el.ammoMag.textContent = String(slot.ammo);
    this.el.ammoMax.textContent = String(slot.def.mag);
    this.el.ammoCount.classList.toggle('empty', slot.ammo === 0);
    this.el.reloadHint.classList.toggle('hidden', !player.loadout.reloading);

    this.el.slots.forEach((el, i) => el.classList.toggle('active', i === player.loadout.index));

    // Fadenkreuz öffnet sich mit der tatsächlichen Streuung.
    const px = Math.min(34, 4 + spread * 340);
    this.el.crossT.style.transform = `translateY(${-px}px)`;
    this.el.crossB.style.transform = `translateY(${px}px)`;
    this.el.crossL.style.transform = `translateX(${-px}px)`;
    this.el.crossR.style.transform = `translateX(${px}px)`;

    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) this.el.damageFlash.style.opacity = '0';
    }
  }

  hitMarker(kill = false) {
    const el = this.el.hitmarker;
    el.classList.remove('show');
    el.classList.toggle('kill', kill);
    void el.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
    el.classList.add('show');
  }

  damageFlash() {
    this.el.damageFlash.style.opacity = '0.85';
    this._flashTimer = 0.18;
  }

  banner(text, sub = '', kind = '') {
    this.el.banner.className = kind;
    this.el.banner.innerHTML = sub
      ? `${escapeHtml(text)}<span class="sub">${escapeHtml(sub)}</span>`
      : escapeHtml(text);
    this.el.banner.classList.remove('hidden');
  }

  hideBanner() { this.el.banner.classList.add('hidden'); }

  perf(fps, pieces) {
    this.el.perf.textContent = `${fps.toFixed(0)} FPS · ${pieces} Teile`;
  }

  reset() {
    this._lastHealth = MAX_HEALTH;
    this.el.damageFlash.style.opacity = '0';
    this.hideBanner();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
