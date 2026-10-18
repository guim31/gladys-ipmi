// -----------------------------------------------------------------------------
// What the scene triggers compare with, server by server: the last power
// state, the severity of every sensor, the SEL entries already seen.
// Transitions only: a server that boots with a sensor already out of range is
// recorded, not announced, the first time it is read (after an install, or a
// lost /data).
//
// `saved` is the JSON written under /data by src/store.js. Servers are keyed
// by their configuration slot.
// -----------------------------------------------------------------------------

import { healthRank } from './ipmi/model.js';

// SEL entries remembered per server: more than any read returns.
export const MAX_SEEN_ENTRIES = 200;

// A sensor that swings around a threshold (slow fans near their lower limit)
// is announced again only after this long, unless it gets worse.
export const SENSOR_COOLDOWN_MS = 30 * 60_000;

/** The key of a sensor: two sensors may share a name ("Temp" on a Dell). */
export const sensorKey = (sensor) => `${sensor.number}|${sensor.name}`;

export class Watcher {
  constructor(saved = {}) {
    const servers =
      saved && typeof saved.servers === 'object' && saved.servers ? saved.servers : {};
    /** @type {Record<string, { on?: boolean|null, sensors?: Record<string, string>, sel?: string[], features?: string[], fanUnit?: string|null }>} */
    this.servers = structuredClone(servers);
  }

  get saved() {
    return { servers: this.servers };
  }

  entry(key) {
    this.servers[key] ??= {};
    return this.servers[key];
  }

  /**
   * Record the power state and the sensor severities of a server.
   * @param {string} key
   * @param {{ on: boolean|null, sensors: Array<{ name: string, number: number, severity: string|null }> }} state
   * @param {number} [now] for the cooldown of the sensor announcements
   * @returns {{ poweredOn: boolean, poweredOff: boolean, worse: Array<object> }}
   *   `worse`: the sensors now Warning or Critical that were better before
   */
  observe(key, { on, sensors }, now = Date.now()) {
    const entry = this.entry(key);
    const result = { poweredOn: false, poweredOff: false, worse: [] };
    if (on !== null) {
      const previous = entry.on ?? null;
      result.poweredOn = previous === false && on === true;
      result.poweredOff = previous === true && on === false;
      entry.on = on;
    }
    const known = entry.sensors;
    const next = {};
    for (const sensor of sensors) {
      if (sensor.severity === null) {
        // No reading (a server off): keep what was known.
        if (known?.[sensorKey(sensor)]) {
          next[sensorKey(sensor)] = known[sensorKey(sensor)];
        }
        continue;
      }
      next[sensorKey(sensor)] = sensor.severity;
      if (!known || sensor.severity === 'OK') {
        continue;
      }
      // A sensor not seen before, on a server already known: it was fine.
      const previous = known[sensorKey(sensor)] ?? 'OK';
      if (healthRank(sensor.severity) > healthRank(previous)) {
        entry.fired ??= {};
        const last = entry.fired[sensorKey(sensor)];
        const quiet =
          last &&
          now - last.at < SENSOR_COOLDOWN_MS &&
          healthRank(last.severity) >= healthRank(sensor.severity);
        if (!quiet) {
          entry.fired[sensorKey(sensor)] = { severity: sensor.severity, at: now };
          result.worse.push(sensor);
        }
      }
    }
    entry.sensors = next;
    if (entry.fired) {
      for (const [name, last] of Object.entries(entry.fired)) {
        if (now - last.at >= SENSOR_COOLDOWN_MS) {
          delete entry.fired[name];
        }
      }
    }
    return result;
  }

  /**
   * The SEL entries not seen before, newest first. The first read of a
   * server records them all silently.
   * @param {Array<{ key: string }>} entries newest first
   */
  newEntries(key, entries) {
    const entry = this.entry(key);
    const seen = entry.sel;
    const keys = entries.map((item) => item.key);
    if (!Array.isArray(seen)) {
      entry.sel = keys.slice(0, MAX_SEEN_ENTRIES);
      return [];
    }
    const known = new Set(seen);
    const fresh = entries.filter((item) => !known.has(item.key));
    entry.sel = [...new Set([...keys, ...seen])].slice(0, MAX_SEEN_ENTRIES);
    return fresh;
  }

  /**
   * The features a server ever had, and the fan unit first seen: the device
   * keeps them when a reading goes missing (server off).
   * @returns {{ keys: Set<string>, fanUnit: string|null }}
   */
  rememberFeatures(key, keys, fanUnit) {
    const entry = this.entry(key);
    const known = new Set([...(entry.features ?? []), ...keys]);
    entry.features = [...known].sort();
    entry.fanUnit ??= fanUnit;
    return { keys: known, fanUnit: entry.fanUnit ?? null };
  }

  /** Forget a server (another BMC at this slot). */
  forget(key) {
    if (key in this.servers) {
      delete this.servers[key];
      return true;
    }
    return false;
  }

  /** Forget the servers of the slots no longer configured. */
  forgetOthers(kept) {
    let changed = false;
    for (const key of Object.keys(this.servers)) {
      if (!kept.has(Number(key))) {
        delete this.servers[key];
        changed = true;
      }
    }
    return changed;
  }
}
