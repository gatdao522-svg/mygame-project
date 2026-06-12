// ===== HUD / UI management =====
import { TEAM_INFO, WEAPONS } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.killfeed = $('killfeed');
    this.minimapCtx = $('minimap').getContext('2d');
    this.mmStatic = null;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
  }

  // ---- HUD basics ----
  setHP(hp) {
    $('hp').textContent = Math.max(0, Math.round(hp));
    $('hp-fill').style.width = `${Math.max(0, hp)}%`;
    $('hp-fill').style.background = hp > 50
      ? 'linear-gradient(90deg,#3df53d,#aef53d)'
      : hp > 25 ? 'linear-gradient(90deg,#f5c43d,#f5e13d)' : 'linear-gradient(90deg,#f53d3d,#f5773d)';
  }
  setWeapon(name, ammo) {
    $('weapon-name').textContent = name;
    this.setAmmo(ammo);
  }
  setAmmo(a) {
    $('ammo').textContent = a.mag === Infinity ? '—' : a.mag;
    $('reserve').textContent = a.reserve === Infinity ? '—' : a.reserve;
  }
  setReloading(on) { $('reload-hint').classList.toggle('hidden', !on); }
  setCrosshairGap(spreadPx, hide) {
    const ch = $('crosshair');
    ch.style.display = hide ? 'none' : '';
    ch.style.setProperty('--gap', `${Math.round(4 + spreadPx)}px`);
  }
  setScope(on) { $('scope').classList.toggle('hidden', !on); }

  hitmarker(headshot) {
    const hm = $('hitmarker');
    hm.classList.remove('show', 'hs');
    void hm.offsetWidth; // restart animation
    if (headshot) hm.classList.add('hs');
    hm.classList.add('show');
  }

  damageFlash(dirAngle) {
    const v = $('dmg-vignette');
    v.style.transition = 'none'; v.style.opacity = '1';
    requestAnimationFrame(() => { v.style.transition = 'opacity .5s'; v.style.opacity = '0'; });
    if (dirAngle != null) {
      const d = $('dmg-dir');
      d.style.transform = `rotate(${dirAngle}rad)`;
      d.style.opacity = '1';
      clearTimeout(this._dmgT);
      this._dmgT = setTimeout(() => { d.style.opacity = '0'; }, 600);
    }
  }

  // ---- killfeed / chat / messages ----
  addKill(k) {
    const el = document.createElement('div');
    el.className = 'kf';
    const wn = (WEAPONS[k.weapon] || {}).name || k.weapon;
    el.innerHTML = `<b class="${k.killerTeam}">${esc(k.killerName)}</b><span class="wpn">${wn}</span>` +
      `${k.headshot ? '<span class="hs">☠</span>' : ''} <b class="${k.victimTeam}">${esc(k.victimName)}</b>`;
    this.killfeed.appendChild(el);
    setTimeout(() => el.remove(), 6000);
    while (this.killfeed.children.length > 6) this.killfeed.firstChild.remove();
  }

  addChat(name, team, text) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'chat-line';
    el.innerHTML = `<b class="${team}">${esc(name)}:</b> ${esc(text)}`;
    log.appendChild(el);
    setTimeout(() => el.remove(), 9000);
    while (log.children.length > 6) log.firstChild.remove();
  }

  centerMsg(text, ms = 2200) {
    const el = $('center-msg');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._cmT);
    this._cmT = setTimeout(() => el.classList.add('hidden'), ms);
  }

  setTeamScores(t, ct) {
    $('score-t').textContent = t;
    $('score-ct').textContent = ct;
  }

  // ---- scoreboard ----
  updateScoreboard(players, myId) {
    for (const team of ['t', 'ct']) {
      const tbody = $(`sb-${team}-table`).querySelector('tbody');
      tbody.innerHTML = '';
      players.filter((p) => p.team === team)
        .sort((a, b) => b.kills - a.kills)
        .forEach((p) => {
          const tr = document.createElement('tr');
          if (p.id === myId) tr.className = 'me';
          tr.innerHTML = `<td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td>`;
          tbody.appendChild(tr);
        });
    }
  }
  showScoreboard(on) { $('scoreboard').classList.toggle('hidden', !on); }

  // ---- death ----
  showDeath(killerName, seconds) {
    $('death-by').textContent = killerName ? `Тебя убил ${killerName}` : '';
    $('death').classList.remove('hidden');
    const timerEl = $('respawn-timer');
    let left = seconds;
    timerEl.textContent = left.toFixed(0);
    clearInterval(this._deathI);
    this._deathI = setInterval(() => {
      left -= 1;
      timerEl.textContent = Math.max(0, left).toFixed(0);
      if (left <= 0) clearInterval(this._deathI);
    }, 1000);
  }
  hideDeath() { $('death').classList.add('hidden'); clearInterval(this._deathI); }

  // ---- minimap ----
  initMinimap(mapData) {
    const c = document.createElement('canvas');
    c.width = 180; c.height = 150;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(20,24,30,.9)';
    ctx.fillRect(0, 0, 180, 150);
    const sx = 180 / 100, sz = 150 / 80;
    ctx.fillStyle = 'rgba(205,185,140,.8)';
    const drawBox = (cx, cz, w, d) => {
      ctx.fillRect((cx - w / 2 + 50) * sx, (cz - d / 2 + 40) * sz, w * sx, d * sz);
    };
    for (const [cx, cz, w, d] of mapData.walls) drawBox(cx, cz, w, d);
    ctx.fillStyle = 'rgba(150,150,160,.7)';
    for (const [cx, cz, w, d] of mapData.lows) drawBox(cx, cz, w, d);
    ctx.fillStyle = 'rgba(140,105,60,.85)';
    for (const [cx, cz, size] of mapData.crates) drawBox(cx, cz, size, size);
    ctx.font = 'bold 11px Arial'; ctx.fillStyle = 'rgba(255,120,80,.9)';
    ctx.fillText('B', (-30 + 50) * sx - 3, (-25 + 40) * sz + 4);
    ctx.fillText('A', (30 + 50) * sx - 3, (25 + 40) * sz + 4);
    this.mmStatic = c;
    this.mmScale = { sx, sz };
  }

  drawMinimap(me, remotes, myTeam) {
    if (!this.mmStatic) return;
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, 180, 150);
    ctx.drawImage(this.mmStatic, 0, 0);
    const { sx, sz } = this.mmScale;
    const px = (me.x + 50) * sx, pz = (me.z + 40) * sz;
    // teammates
    for (const a of remotes.values()) {
      if (!a.alive || a.team !== myTeam) continue;
      ctx.fillStyle = a.team === 't' ? '#e8a33d' : '#5ba2e8';
      ctx.beginPath();
      ctx.arc((a.group.position.x + 50) * sx, (a.group.position.z + 40) * sz, 3, 0, 7);
      ctx.fill();
    }
    // self with view direction
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(me.yaw + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  tickFPS(dt) {
    this.fpsAcc += dt; this.fpsN++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS`;
      this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
