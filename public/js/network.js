// ===== Socket.IO client wrapper =====
export class Network {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.id = null;
    this.handlers = {};
  }
  on(event, fn) { this.handlers[event] = fn; this.socket.on(event, fn); }
  join(name, team, skin) { this.socket.emit('join', { name, team, skin }); }
  sendState(s) { this.socket.emit('state', s); }
  sendShoot(p) { this.socket.emit('shoot', p); }
  sendReload() { this.socket.emit('reload'); }
  sendBuy(weapon) { this.socket.emit('buy', { weapon }); }
  sendSkin(skin) { this.socket.emit('skin', { skin }); }
  sendChat(text) { this.socket.emit('chat', text); }
  sendHarvest(id) { this.socket.emit('harvest', { id }); }
  sendPlaceBlock(x, z, horiz) { this.socket.emit('place-block', { x, z, horiz }); }
  sendDamageBlock(id) { this.socket.emit('damage-block', { id }); }
}
