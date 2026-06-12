// ===== Procedural WebAudio sound engine (no asset files) =====
let ctx = null, master = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function noiseBuffer(dur) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(g, t0, peak, dur) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

// vol: 0..1 (distance attenuated by caller)
export function playGunshot(weapon, vol = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const p = {
    ak47:   { dur: 0.22, freq: 900, boom: 110, peak: 0.9 },
    pistol: { dur: 0.14, freq: 1400, boom: 160, peak: 0.7 },
    awp:    { dur: 0.5, freq: 500, boom: 65, peak: 1.2 },
    knife:  { dur: 0.06, freq: 2500, boom: 0, peak: 0.18 },
  }[weapon] || { dur: 0.2, freq: 1000, boom: 120, peak: 0.8 };

  // crack (filtered noise)
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(p.dur);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(p.freq * 4, t);
  f.frequency.exponentialRampToValueAtTime(p.freq * 0.4, t + p.dur);
  const g = ctx.createGain(); env(g, t, p.peak * vol, p.dur);
  src.connect(f).connect(g).connect(master); src.start(t);

  // boom (sine thump)
  if (p.boom) {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(p.boom, t);
    o.frequency.exponentialRampToValueAtTime(p.boom * 0.4, t + p.dur * 0.8);
    const og = ctx.createGain(); env(og, t, p.peak * 0.8 * vol, p.dur * 0.9);
    o.connect(og).connect(master); o.start(t); o.stop(t + p.dur);
  }
}

function click(t, freq, vol, dur = 0.03) {
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
  const g = ctx.createGain(); env(g, t, vol, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}

export function playReload(weapon) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const total = { ak47: 2.4, pistol: 1.8, awp: 3.2 }[weapon] || 2;
  click(t + 0.15, 700, 0.25, 0.04);          // mag out
  click(t + 0.25, 350, 0.2, 0.05);
  click(t + total * 0.55, 900, 0.3, 0.04);   // mag in
  click(t + total * 0.6, 500, 0.25, 0.05);
  click(t + total * 0.85, 1200, 0.35, 0.03); // bolt
  click(t + total * 0.9, 800, 0.3, 0.04);
}

export function playDryFire() { if (ctx) click(ctx.currentTime, 1100, 0.2, 0.025); }
export function playHitmarker(headshot) {
  if (!ctx) return;
  const t = ctx.currentTime;
  click(t, headshot ? 2200 : 1500, 0.35, 0.03);
  if (headshot) click(t + 0.05, 2800, 0.3, 0.04);
}
export function playDamaged() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
  const g = ctx.createGain(); env(g, t, 0.4, 0.18);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
}
export function playFootstep(vol = 0.12) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.05);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + Math.random() * 200;
  const g = ctx.createGain(); env(g, t, vol, 0.05);
  src.connect(f).connect(g).connect(master); src.start(t);
}
export function playKillDing() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [880, 1320].forEach((fr, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
    const g = ctx.createGain(); env(g, t + i * 0.07, 0.25, 0.12);
    o.connect(g).connect(master); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.15);
  });
}
