// ===== Socket.IO client wrapper =====
export class Network {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.id = null;
    this.handlers = {};
  }
  on(event, fn) { this.handlers[event] = fn; this.socket.on(event, fn); }
  join(name, team) { this.socket.emit('join', { name, team }); }
  sendState(s) { this.socket.emit('state', s); }
  sendShoot(p) { this.socket.emit('shoot', p); }
  sendHit(p) { this.socket.emit('hit', p); }
  sendChat(text) { this.socket.emit('chat', text); }
}
