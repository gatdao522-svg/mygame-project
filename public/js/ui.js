// ===== HUD / UI management =====
import { TEAM_INFO, WEAPONS, BUY_MENU } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.killfeed = $('killfeed');
    this.minimapCtx = $('minimap').getContext('2d');
    this.mmStatic = null;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this.money = 0;
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
    $('ammo').textContent = a.mag === Infinity || a.mag < 0 ? '—' : a.mag;
    $('reserve').textContent = a.reserve === Infinity || a.reserve < 0 ? '—' : a.reserve;
  }
  setMoney(m) {
    this.money = m;
    $('money').textContent = `$${m}`;
    if (this._buyOpen) this._refreshBuyAfford();
  }
  setReloading(on) { $('reload-hint').classList.toggle('hidden', !on); }
  setRes(r) {
    if (!r) return;
    $('res-wood').textContent = r.wood;
    $('res-stone').textContent = r.stone;
  }
  showResHud(on) { $('res-hud').classList.toggle('hidden', !on); }
  setProtected(on) { $('protect-hint').classList.toggle('hidden', !on); }
  setCrosshairGap(spreadPx, hide) {
    const ch = $('crosshair');
    ch.style.display = hide ? 'none' : '';
    ch.style.setProperty('--gap', `${Math.round(4 + spreadPx)}px`);
  }
  setScope(on) { $('scope').classList.toggle('hidden', !on); }

  // ---- round HUD ----
  setRoundTimer(msLeft, warn) {
    const el = $('round-timer');
    if (msLeft == null) { el.textContent = '—:—'; el.classList.remove('warn'); return; }
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('warn', !!warn);
  }
  setRoundScore(t, ct, roundNo, phase, mode = 'comp') {
    $('score-t').textContent = t;
    $('score-ct').textContent = ct;
    $('round-label').textContent = phase === 'warmup' ? 'РАЗМИНКА'
      : mode === 'dm' ? 'DEATHMATCH'
        : (roundNo ? `${mode === 'zombie' ? '🧟 ' : ''}РАУНД ${roundNo}` : '');
  }
  setTeamLabels(mode) {
    const tH = $('sb-t-table').closest('.sb-team').querySelector('h3');
    const ctH = $('sb-ct-table').closest('.sb-team').querySelector('h3');
    if (mode === 'zombie') { tH.textContent = '🧟 Зомби'; ctH.textContent = '🛡 Выжившие'; }
    else { tH.textContent = 'Боевики (T)'; ctH.textContent = 'Спецназ (CT)'; }
  }
  banner(text, sub = '', ms = 2600) {
    const el = $('banner');
    $('banner-title').textContent = text;
    $('banner-sub').textContent = sub;
    el.classList.remove('hidden');
    clearTimeout(this._bT);
    if (ms > 0) this._bT = setTimeout(() => el.classList.add('hidden'), ms);
  }
  hideBanner() { $('banner').classList.add('hidden'); clearTimeout(this._bT); }

  hitmarker(headshot) {
    const hm = $('hitmarker');
    hm.classList.remove('show', 'hs');
    void hm.offsetWidth;
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

  // ---- buy menu ----
  initBuyMenu(onBuy) {
    const wrap = $('buy-items');
    wrap.innerHTML = '';
    for (const [label, items] of Object.entries(BUY_MENU)) {
      const h = document.createElement('div');
      h.className = 'buy-section';
      h.textContent = label;
      wrap.appendChild(h);
      for (const wid of items) {
        const w = WEAPONS[wid];
        const btn = document.createElement('button');
        btn.className = 'buy-item';
        btn.dataset.weapon = wid;
        btn.dataset.price = w.price;
        btn.innerHTML = `<span class="bi-name">${w.name}</span><span class="bi-price">$${w.price}</span>`;
        btn.addEventListener('click', () => onBuy(wid));
        wrap.appendChild(btn);
      }
    }
  }
  showBuyMenu(on) {
    this._buyOpen = on;
    $('buy-menu').classList.toggle('hidden', !on);
    if (on) this._refreshBuyAfford();
  }
  isBuyOpen() { return !!this._buyOpen; }
  _refreshBuyAfford() {
    for (const btn of document.querySelectorAll('.buy-item')) {
      btn.classList.toggle('cant', this.money < +btn.dataset.price && !this._buyFree);
    }
  }
  setBuyFree(free) { this._buyFree = free; if (this._buyOpen) this._refreshBuyAfford(); }

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
    el.innerHTML = name === null
      ? `<i class="srv">${esc(text)}</i>`
      : `<b class="${team}">${esc(name)}:</b> ${esc(text)}`;
    log.appendChild(el);
    setTimeout(() => el.remove(), 9000);
    while (log.children.length > 8) log.firstChild.remove();
  }

  centerMsg(text, ms = 2200) {
    const el = $('center-msg');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._cmT);
    this._cmT = setTimeout(() => el.classList.add('hidden'), ms);
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
  showDeath(killerName, waitRound) {
    $('death-by').textContent = killerName ? `Тебя убил ${killerName}` : '';
    $('respawn-note').textContent = waitRound ? 'Ждём следующий раунд…' : 'Возрождение…';
    $('death').classList.remove('hidden');
  }
  hideDeath() { $('death').classList.add('hidden'); }

  // ---- minimap ----
  initMinimap(mapData) {
    const [W, D] = mapData.size;
    const c = document.createElement('canvas');
    c.width = 180; c.height = 150;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(20,24,30,.9)';
    ctx.fillRect(0, 0, 180, 150);
    const sx = 180 / W, sz = 150 / D;
    const ox = W / 2, oz = D / 2;
    const drawBox = (cx, cz, w, d) => {
      ctx.fillRect((cx - w / 2 + ox) * sx, (cz - d / 2 + oz) * sz, Math.max(1, w * sx), Math.max(1, d * sz));
    };
    ctx.fillStyle = 'rgba(205,185,140,.8)';
    for (const [cx, cz, w, d] of mapData.walls) drawBox(cx, cz, w, d);
    ctx.fillStyle = 'rgba(150,150,160,.7)';
    for (const [cx, cz, w, d] of mapData.lows) drawBox(cx, cz, w, d);
    ctx.fillStyle = 'rgba(140,105,60,.85)';
    for (const [cx, cz, size] of mapData.crates) drawBox(cx, cz, size, size);
    ctx.font = 'bold 11px Arial'; ctx.fillStyle = 'rgba(255,120,80,.9)';
    for (const [letter, x, z] of mapData.sites || []) {
      ctx.fillText(letter, (x + ox) * sx - 3, (z + oz) * sz + 4);
    }
    this.mmStatic = c;
    this.mmScale = { sx, sz, ox, oz };
  }

  drawMinimap(me, remotes, myTeam) {
    if (!this.mmStatic) return;
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, 180, 150);
    ctx.drawImage(this.mmStatic, 0, 0);
    const { sx, sz, ox, oz } = this.mmScale;
    const px = (me.x + ox) * sx, pz = (me.z + oz) * sz;
    for (const a of remotes.values()) {
      if (!a.alive || a.team !== myTeam) continue;
      ctx.fillStyle = a.team === 't' ? '#e8a33d' : '#5ba2e8';
      ctx.beginPath();
      ctx.arc((a.group.position.x + ox) * sx, (a.group.position.z + oz) * sz, 3, 0, 7);
      ctx.fill();
    }
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
