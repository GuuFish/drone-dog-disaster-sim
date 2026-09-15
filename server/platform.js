import crypto from 'node:crypto';
import { pathfind, surfaceHeight, distance, routeLength, WORLD, BASE } from '../terrain.js';
import { cap } from './store.js';

export const TYPES = { person: '疑似被困人员', fire: '森林火情', gas: '气体泄漏', collapse: '建筑坍塌' };
export const REGION = (x, z) => z > 1400 ? '南部河谷' : x > 1100 && z < -300 ? '东部城区' : x < -600 && z > -200 ? '西部工业区' : x < 0 || z < 0 ? '西北山地林区' : '中部平原';
export const uid = () => crypto.randomUUID();

const SLOTS = [[-190, -150], [190, -150], [-190, 150], [190, 150]];
const OFFLINE_MS = 10000;
const DOG_MAX_DISTANCE = 6000;

export function emptyState() {
  return {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    devices: [], events: [], tasks: [], logs: [],
    counters: { telemetry: 0, discovered: 0, commands: 0 },
  };
}

export class Platform {
  constructor(store, { sessionId = uid() } = {}) {
    this.store = store;
    this.sessionId = sessionId;
    this.state = store.read() || emptyState();
    this.state.devices.forEach((d) => { d.online = false; });
    this.commands = new Map();          // deviceId -> queued task.command envelopes
    this.listeners = new Set();         // SSE subscribers
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, data) { for (const fn of this.listeners) { try { fn(kind, data); } catch {} } }
  persist() { this.state.updatedAt = new Date().toISOString(); this.store.write(this.state); this.emit('state', this.snapshot()); }

  snapshot() {
    const now = Date.now();
    return {
      ...this.state,
      devices: this.state.devices.map((d) => ({ ...d, online: now - new Date(d.lastSeen || 0).getTime() < OFFLINE_MS })),
    };
  }

  log(text) {
    this.state.logs.unshift({ id: uid(), text, time: new Date().toISOString() });
    cap(this.state.logs, 200);
  }

  envelope(type, deviceId, payload, correlationId) {
    return {
      schemaVersion: '1.0', messageId: uid(), sessionId: this.sessionId, type,
      timestamp: new Date().toISOString(), source: 'platform',
      deviceId: deviceId || null, correlationId: correlationId || null, payload,
    };
  }

  // ---------- messages coming from the simulator ----------
  handle(message) {
    const { type, deviceId, payload = {} } = message || {};
    switch (type) {
      case 'device.register': return this.register(deviceId, payload);
      case 'device.telemetry': return this.telemetry(deviceId, payload);
      case 'event.discovered': return this.discovered(deviceId, payload);
      case 'task.ack': return this.ack(deviceId, payload);
      case 'task.progress': return this.progress(deviceId, payload);
      case 'task.result': return this.result(deviceId, payload);
      case 'device.offline': return this.offline(deviceId, payload);
      default: return { error: `unknown message type: ${type}` };
    }
  }

  register(deviceId, p) {
    if (!deviceId) return { error: 'deviceId is required' };
    let d = this.state.devices.find((x) => x.id === deviceId);
    if (!d) {
      const slot = SLOTS[this.state.devices.length % SLOTS.length];
      d = { id: deviceId, name: p.name || deviceId, type: p.deviceType === 'dog' ? 'dog' : 'uav', x: BASE.x + slot[0], z: BASE.z + slot[1], y: surfaceHeight(BASE.x, BASE.z), cruise: p.cruise || 100, maxDistance: p.deviceType === 'dog' ? (p.maxDistance || DOG_MAX_DISTANCE) : undefined, battery: p.battery ?? 100, status: 'IDLE', taskId: null, lastSeen: new Date().toISOString() };
      this.state.devices.push(d);
      this.log(`${d.name} 已注册接入`);
    } else {
      d.name = p.name || d.name; d.cruise = p.cruise || d.cruise; if (d.type === 'dog' && p.maxDistance) d.maxDistance = p.maxDistance; d.lastSeen = new Date().toISOString();
    }
    this.persist();
    return { accepted: true, device: d };
  }

  telemetry(deviceId, p) {
    const d = this.state.devices.find((x) => x.id === deviceId);
    if (!d) return { error: 'unknown device' };
    if (p.position) { d.x = p.position.x; d.z = p.position.z; d.y = p.position.y ?? d.y; }
    if (typeof p.battery === 'number') d.battery = p.battery;
    if (p.state) d.status = p.state;
    d.taskId = p.taskId ?? d.taskId;
    d.lastSeen = new Date().toISOString();
    d.online = true;
    this.state.counters.telemetry++;
    this.emit('telemetry', { deviceId, position: { x: d.x, y: d.y, z: d.z }, battery: d.battery, state: d.status });
    return { accepted: true };
  }

  discovered(deviceId, p) {
    if (!p.eventId) return { error: 'eventId is required' };
    let e = this.state.events.find((x) => x.id === p.eventId);
    if (!e) {
      e = { id: p.eventId, kind: p.eventType || 'person', x: p.position?.x ?? 0, z: p.position?.z ?? 0, severity: p.severity || '中', status: '待复核', created: new Date().toISOString(), discoveredBy: deviceId, result: null };
      this.state.events.push(e);
      this.state.counters.discovered++;
      this.log(`${TYPES[e.kind] || e.kind} · ${REGION(e.x, e.z)} 由设备上报发现`);
    }
    this.persist();
    return { accepted: true, event: e };
  }

  ack(deviceId, p) {
    const t = this.state.tasks.find((x) => x.id === p.taskId);
    if (!t) return { error: 'unknown task' };
    t.status = p.accepted ? '执行中' : '已取消';
    t.ack = { accepted: !!p.accepted, reason: p.reason || null, at: new Date().toISOString() };
    this.log(`${t.deviceName} ${p.accepted ? '已接收任务' : '拒绝任务' + (p.reason ? '：' + p.reason : '')}`);
    this.persist();
    return { accepted: true };
  }

  progress(deviceId, p) {
    const t = this.state.tasks.find((x) => x.id === p.taskId);
    if (!t) return { error: 'unknown task' };
    if (typeof p.progress === 'number') t.progress = Math.max(0, Math.min(100, p.progress));
    if (p.phase) t.phase = p.phase;
    if (p.position) t.position = p.position;
    this.emit('task.progress', { taskId: t.id, progress: t.progress, phase: t.phase });
    return { accepted: true };
  }

  result(deviceId, p) {
    const t = this.state.tasks.find((x) => x.id === p.taskId);
    if (!t) return { error: 'unknown task' };
    const e = this.state.events.find((x) => x.id === t.eventId);
    t.status = p.outcome === 'SUCCEEDED' ? '已完成' : p.outcome === 'CANCELLED' ? '已取消' : '失败';
    t.finished = new Date().toISOString();
    t.progress = 100;
    t.outcome = p.outcome;
    if (e) {
      if (p.outcome === 'SUCCEEDED') { e.status = t.phase === '空中侦察' ? '待复核' : '已确认'; e.result = p.observations || null; }
      else if (p.outcome === 'CANCELLED') { e.status = t.phase === '空中侦察' ? '待侦察' : '待复核'; }
    }
    this.log(`${t.deviceName} ${t.phase}${p.outcome === 'SUCCEEDED' ? '完成' : '结束'}`);
    this.persist();
    return { accepted: true };
  }

  offline(deviceId, p) {
    const d = this.state.devices.find((x) => x.id === deviceId);
    if (!d) return { error: 'unknown device' };
    d.online = false; d.status = 'OFFLINE'; d.lastSeen = new Date(Date.now() - OFFLINE_MS * 2).toISOString();
    this.log(`${d.name} 已离线${p.reason ? '（' + p.reason + '）' : ''}`);
    this.persist();
    return { accepted: true };
  }

  // ---------- operator actions ----------
  createEvent(kind, x, z, severity = '高') {
    if (!TYPES[kind]) return { error: 'unknown event kind' };
    if (Math.abs(x) > WORLD.width / 2 || Math.abs(z) > WORLD.depth / 2) return { error: 'position outside the region' };
    const e = { id: uid(), kind, x, z, severity, status: '待侦察', created: new Date().toISOString(), discoveredBy: null, result: null };
    this.state.events.push(e);
    this.log(`操作员注入 ${TYPES[kind]} · 距中心 ${(distance(BASE, e) / 1000).toFixed(2)} km`);
    this.persist();
    return { event: e };
  }

  dispatch(eventId) {
    const e = this.state.events.find((x) => x.id === eventId);
    if (!e) return { error: 'event not found' };
    if (!['待侦察', '待复核'].includes(e.status)) return { error: '当前事件已在执行或已完成' };
    const type = e.status === '待侦察' ? 'uav' : 'dog';
    const busy = (id) => this.state.tasks.some((t) => t.deviceId === id && t.status === '执行中');
    const candidates = this.state.devices
      .filter((d) => d.type === type && d.online !== false && d.battery > 15 && !busy(d.id))
      .sort((a, b) => distance(a, e) - distance(b, e));
    if (!candidates.length) return { error: `没有可用的${type === 'uav' ? '无人机' : '机器狗'}（需在线、空闲且电量 > 15%）` };

    let device, route;
    let reachable = false;
    for (const c of candidates) {
      const r = type === 'dog' ? pathfind(c, e) : [{ x: e.x, z: e.z }];
      if (r) { reachable = true; if (type === 'dog' && routeLength(c, r) > (c.maxDistance || DOG_MAX_DISTANCE)) continue; device = c; route = r; break; }
    }
    if (!device) return { error: reachable && type === 'dog' ? '没有机器狗在设定作业距离内，无法执行地面复核' : '没有可通行的地面复核点，保留空中侦察结果' };

    const speed = type === 'uav' ? WORLD.uavSpeed : WORLD.dogSpeed;
    const totalDistance = routeLength(device, route);
    const task = {
      id: uid(), eventId: e.id, deviceId: device.id, deviceName: device.name,
      phase: type === 'uav' ? '空中侦察' : '地面复核', status: '待确认',
      route, totalDistance, progress: 0, started: new Date().toISOString(), finished: null,
    };
    this.state.tasks.unshift(task);
    e.status = type === 'uav' ? '侦察中' : '复核中';
    const command = this.envelope('task.command', device.id, {
      commandId: uid(), taskId: task.id, eventId: e.id,
      action: type === 'uav' ? 'INSPECT' : 'REVIEW', target: { x: e.x, z: e.z },
      route, speed, expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }, task.id);
    if (!this.commands.has(device.id)) this.commands.set(device.id, []);
    this.commands.get(device.id).push(command);
    this.state.counters.commands++;
    this.log(`${device.name} 下发${task.phase}任务 · 路径 ${(totalDistance / 1000).toFixed(2)} km · 预计 ${Math.ceil((totalDistance / speed + 20) / 60)} 分钟`);
    this.persist();
    return { task, command };
  }

  cancelTask(taskId) {
    const t = this.state.tasks.find((x) => x.id === taskId);
    if (!t) return { error: 'task not found' };
    if (t.status === '执行中' || t.status === '待确认') {
      t.status = '已取消';
      const e = this.state.events.find((x) => x.id === t.eventId);
      if (e) e.status = t.phase === '空中侦察' ? '待侦察' : '待复核';
      const command = this.envelope('task.command', t.deviceId, { commandId: uid(), taskId: t.id, eventId: t.eventId, action: 'CANCEL' }, t.id);
      if (!this.commands.has(t.deviceId)) this.commands.set(t.deviceId, []);
      this.commands.get(t.deviceId).push(command);
      this.log(`${t.deviceName} 的任务已取消`);
    }
    this.persist();
    return { task: t };
  }

  closeEvent(eventId) {
    const e = this.state.events.find((x) => x.id === eventId);
    if (!e) return { error: 'event not found' };
    if (e.status !== '已确认') return { error: '仅可关闭已确认的事件' };
    e.status = '已关闭';
    this.log('操作员确认现场处置，事件关闭');
    this.persist();
    return { event: e };
  }

  deleteEvent(eventId) {
    const e = this.state.events.find((x) => x.id === eventId);
    if (!e) return { error: 'event not found' };
    this.state.tasks.filter((t) => t.eventId === eventId && t.status === '执行中').forEach((t) => this.cancelTask(t.id));
    this.state.events = this.state.events.filter((x) => x.id !== eventId);
    this.log('操作员删除事件');
    this.persist();
    return { ok: true };
  }

  removeDevice(deviceId) {
    const d = this.state.devices.find((x) => x.id === deviceId);
    if (!d) return { error: 'device not found' };
    this.state.tasks.filter((t) => t.deviceId === deviceId && t.status === '执行中').forEach((t) => this.cancelTask(t.id));
    this.state.devices = this.state.devices.filter((x) => x.id !== deviceId);
    this.log(`${d.name} 已移除`);
    this.persist();
    return { ok: true };
  }

  takeCommands(deviceId) {
    const list = this.commands.get(deviceId) || [];
    this.commands.set(deviceId, []);
    return list;
  }

  // Full-text-ish search; swap for Elasticsearch by implementing the same signature.
  search(q) {
    const text = String(q || '').trim().toLowerCase();
    if (!text) return { total: 0, hits: [] };
    const hits = this.state.events.filter((e) =>
      [e.id, e.kind, TYPES[e.kind], e.status, REGION(e.x, e.z), e.severity, e.result].filter(Boolean).join(' ').toLowerCase().includes(text));
    return { total: hits.length, hits };
  }

  stats() {
    const byStatus = {};
    for (const e of this.state.events) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const byKind = {};
    for (const e of this.state.events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    return {
      devices: this.state.devices.length,
      online: this.snapshot().devices.filter((d) => d.online).length,
      events: this.state.events.length,
      eventsByStatus: byStatus,
      eventsByKind: byKind,
      tasks: this.state.tasks.length,
      tasksRunning: this.state.tasks.filter((t) => t.status === '执行中').length,
      telemetry: this.state.counters.telemetry,
      commands: this.state.counters.commands,
    };
  }

  reset() {
    this.state = emptyState();
    this.commands.clear();
    this.persist();
    this.log('平台状态已重置');
    return { ok: true };
  }
}
