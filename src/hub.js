// -----------------------------------------------------------------------------
// The IPMI hub: one record per configured BMC, read on a timer of the
// container (the interval chosen in the configuration); the states of the
// servers the user added published to Gladys when they change, the scene
// events fired on transitions (src/alerts.js), the power commands, and the
// views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events fire for every server, added to Gladys or not.
//
// The 300 states per minute of Gladys: only the devices added are published,
// only what changed, the values that move at every read at most once a
// minute. Every value is sent again after 6 hours unchanged, before the core
// marks it outdated (48 hours).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import {
  FEATURE_KEYS,
  buildDevice,
  deviceIds,
  featureKeys,
  featureValues,
  parseDeviceId,
} from './devices.js';
import { ERROR_KINDS, IpmiClient } from './ipmi/client.js';
import { parseServer } from './ipmi/model.js';
import { addressOf } from './config.js';
import { createIssueLog } from './logs.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  HEALTH_TEXT,
  REPORT_TEXT,
  formatReading,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'ipmi-hub' });

export const WIDGET_KEY = 'servers';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SENSOR: 'sensor_out_of_range',
  SEL: 'new_sel_entry',
  ON: 'server_powered_on',
  OFF: 'server_powered_off',
});

// Power commands (scene action options, widget buttons): permanent once published.
export const COMMANDS = Object.freeze({
  ON: 'on',
  SHUTDOWN: 'shutdown',
  FORCE_RESTART: 'force_restart',
  POWER_CYCLE: 'power_cycle',
});

// What each command sends: `chassis power <action>`. Never `off`, the hard
// power cut: a shutdown is the soft one (ACPI, the operating system shuts
// down cleanly).
export const IPMI_ACTIONS = Object.freeze({
  [COMMANDS.ON]: 'on',
  [COMMANDS.SHUTDOWN]: 'soft',
  [COMMANDS.FORCE_RESTART]: 'reset',
  [COMMANDS.POWER_CYCLE]: 'cycle',
});

// The severity filter of the sensor trigger (manifest options).
export const LEVELS = Object.freeze({ Warning: 'warning', Critical: 'critical' });

export const HUB_TIMINGS = {
  // A BMC that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 20_000,
  // The SEL is checked at most this often (one `sel info`, the entries when it changed).
  selEveryMs: 60_000,
  // The values that move at every read (watts, temperatures, fans): at most this often.
  noisyEveryMs: 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // A scene action reads the BMC again when the last read is older.
  freshMs: 15_000,
  // After a power command, the server is read again this soon.
  afterCommandMs: 15_000,
};

// Scene events per server and per read, at most.
export const MAX_SENSOR_EVENTS = 5;
export const MAX_SEL_EVENTS = 3;

const signature = (bmc, config) =>
  JSON.stringify([bmc.host, bmc.port, bmc.username, bmc.password, config.iface]);

export class IpmiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.run] ipmitool seam (src/ipmi/runner.js)
   * @param {string} [options.cacheDir] where the SDR caches go (/tmp)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, run, cacheDir, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.run = run;
    this.cacheDir = cacheDir;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} BMC records, by slot */
    this.records = new Map();
    this.watcher = new Watcher();
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load());
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const structureChanged =
      this.config?.language !== config.language ||
      this.config?.allowPowerControl !== config.allowPowerControl;
    this.config = config;
    const wanted = new Map(config.bmcs.map((bmc) => [bmc.slot, bmc]));
    let forgotten = false;
    for (const [slot, record] of this.records) {
      const bmc = wanted.get(slot);
      if (!bmc || record.signature !== signature(bmc, config)) {
        this.dropRecord(record);
        this.records.delete(slot);
        // Another address may be another server: what was seen of the old
        // one must not fire for the new one (recorded again, silently).
        if (bmc && (bmc.host !== record.bmc.host || bmc.port !== record.bmc.port)) {
          forgotten = this.watcher.forget(String(slot)) || forgotten;
        }
      }
    }
    const kept = new Set([...wanted.keys(), ...config.invalidSlots]);
    if (this.watcher.forgetOthers(kept) || forgotten) {
      this.store.save(this.watcher.saved);
    }
    for (const bmc of config.bmcs) {
      const record = this.records.get(bmc.slot);
      if (record) {
        record.bmc = bmc; // a new name only
      } else {
        this.records.set(bmc.slot, this.newRecord(bmc, config));
      }
    }
    if (structureChanged) {
      this.discovered = null;
      // The health text follows the language.
      this.published.clear();
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  newRecord(bmc, config) {
    return {
      bmc,
      signature: signature(bmc, config),
      client: new IpmiClient({
        slot: bmc.slot,
        host: bmc.host,
        port: bmc.port,
        username: bmc.username,
        password: bmc.password,
        iface: config.iface,
        run: this.run,
        cacheDir: this.cacheDir,
        now: this.now,
      }),
      /** @type {object|null} parsed server (src/ipmi/model.js) */
      server: null,
      dcmi: false,
      readAt: 0,
      selReadAt: 0,
      error: null,
      failures: 0,
      polling: null,
      retryTimer: null,
      commandTimer: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
    clearTimeout(record.commandTimer);
    record.client.close().catch(() => {});
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
      clearTimeout(record.commandTimer);
    }
    await Promise.all([...this.records.values()].map((record) => record.client.close()));
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Names and identities ------------------------------------------------------

  /** The name of a server: configured, its product name, or the address. */
  serverName(record) {
    return record.bmc.name ?? record.server?.product ?? addressOf(record.bmc);
  }

  /** A BMC in the logs. */
  label(record) {
    return `BMC ${record.bmc.slot} (${record.bmc.name ?? addressOf(record.bmc)})`;
  }

  deviceId(slot) {
    return deviceIds(this.gladys, slot).device;
  }

  /** The device of a slot, when the user added it. */
  createdDevice(slot) {
    const id = this.deviceId(slot);
    return (this.gladys.devices ?? []).find((device) => device.external_id === id) ?? null;
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const devices = [];
    for (const record of [...this.records.values()].sort((a, b) => a.bmc.slot - b.bmc.slot)) {
      if (record.server) {
        devices.push(
          buildDevice(this.gladys, {
            slot: record.bmc.slot,
            server: record.server,
            name: this.serverName(record),
            control: this.config.allowPowerControl,
            language: this.config.language,
          }),
        );
      }
    }
    return devices;
  }

  /** Publish the Discovery list when it changed. */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the BMCs again, publish the list. */
  async rediscover() {
    for (const record of this.records.values()) {
      record.client.forgetInfo();
    }
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const found = this.find(device.external_id);
    if (!found) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishRecordStates(found.record, { force: true });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted a device: forget what was sent for it. */
  onDeviceDeleted(device) {
    const id = device?.external_id;
    if (typeof id !== 'string') {
      return;
    }
    this.transports.delete(id);
    for (const map of [this.published, this.publishedAt]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${id}:`)) {
          map.delete(key);
        }
      }
    }
  }

  // --- Reading the BMCs ---------------------------------------------------

  async pollAll({ publish = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record)));
    await this.afterChanges(changes.some(Boolean), { publish });
  }

  /** Gladys asks for a refresh (onPoll): read that BMC now. */
  async pollDevice(device) {
    const found = this.find(device.external_id);
    if (found) {
      await this.afterChanges(await this.poll(found.record));
    }
  }

  /** Read again the BMCs whose last read is older than `freshMs`. */
  async refreshIfStale(records = [...this.records.values()]) {
    const stale = records.filter((record) => this.now() - record.readAt >= this.timings.freshMs);
    if (stale.length > 0) {
      const changes = await Promise.all(stale.map((record) => this.poll(record)));
      await this.afterChanges(changes.some(Boolean));
    }
  }

  /**
   * Read one BMC and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    let raw;
    try {
      raw = await record.client.read();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
    const changed = await this.applySuccess(record, raw);
    if (!record.dropped && this.now() - record.selReadAt >= this.timings.selEveryMs) {
      await this.readSel(record);
    }
    return changed;
  }

  async applySuccess(record, raw) {
    if (record.dropped) {
      return false;
    }
    const { slot } = record.bmc;
    const key = String(slot);
    const server = parseServer(raw);
    const previous = record.server;
    let widgetChanged = record.error !== null || record.readAt === 0;
    if (record.error) {
      logger.info(`${this.label(record)} answers again`);
    } else if (record.readAt === 0) {
      logger.info(
        `${this.label(record)}: ${server.model ?? 'server'}, ${server.sensorCount} sensor(s)` +
          `${raw.dcmiWatts !== null ? ', DCMI power reading' : ''}`,
      );
    }
    const saved = JSON.stringify(this.watcher.saved);
    record.server = server;
    record.dcmi = raw.dcmiWatts !== null;
    record.failures = 0;
    record.error = null;
    record.readAt = this.now();
    if (
      previous &&
      (previous.on !== server.on ||
        previous.health !== server.health ||
        previous.alerts.length !== server.alerts.length)
    ) {
      widgetChanged = true;
    }

    const name = this.serverName(record);
    const id = this.deviceId(slot);
    const seen = this.watcher.observe(key, server);
    // A feature once seen stays: a server off reports no processor
    // temperature, and its device must not change at every power cycle.
    server.known = this.watcher.rememberFeatures(
      key,
      featureKeys(server),
      server.fans?.unit ?? null,
    );
    if (seen.poweredOn || seen.poweredOff) {
      logger.debug(`${name}: ${server.on ? 'on' : 'off'}`);
      await this.fireEvent(seen.poweredOn ? TRIGGERS.ON : TRIGGERS.OFF, {
        server: id,
        server_name: name,
      });
    }
    for (const sensor of seen.worse.slice(0, MAX_SENSOR_EVENTS)) {
      const alert = server.alerts.find((item) => item.number === sensor.number) ?? sensor;
      logger.debug(`${name}: ${sensor.name} ${sensor.severity}`);
      await this.fireEvent(TRIGGERS.SENSOR, {
        server: id,
        server_name: name,
        sensor: sensor.name,
        reading: formatReading(alert, this.config.language) || '?',
        level: LEVELS[sensor.severity],
        status: pick(HEALTH_TEXT[sensor.severity], this.config.language),
      });
    }
    this.saveIfChanged(saved);
    await this.publishRecordStates(record);
    return widgetChanged;
  }

  /** The new SEL entries, announced once each. */
  async readSel(record) {
    record.selReadAt = this.now();
    const { slot } = record.bmc;
    let entries;
    try {
      entries = await record.client.readSel();
      this.issues.ok(`sel:${slot}`, `${this.label(record)}: SEL readable again`);
    } catch (err) {
      this.issues.fail(
        `sel:${slot}`,
        'warn',
        `${this.label(record)}: cannot read the SEL: ${err.message}`,
      );
      return;
    }
    if (entries === null) {
      return; // unchanged since the last read
    }
    const saved = JSON.stringify(this.watcher.saved);
    const fresh = this.watcher.newEntries(String(slot), entries);
    // The oldest first, the way they happened.
    for (const item of fresh.slice(0, MAX_SEL_EVENTS).reverse()) {
      logger.debug(`${this.serverName(record)}: SEL entry ${item.key}`);
      await this.fireEvent(TRIGGERS.SEL, {
        server: this.deviceId(slot),
        server_name: this.serverName(record),
        message: item.message.slice(0, 500) || '?',
        created: item.created ?? '',
      });
    }
    this.saveIfChanged(saved);
  }

  /** Write /data only when the watcher changed (an SD card wears). */
  saveIfChanged(before) {
    if (JSON.stringify(this.watcher.saved) !== before) {
      this.store.save(this.watcher.saved);
    }
  }

  applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message}`);
    }
    if (err.kind === ERROR_KINDS.UNREACHABLE) {
      record.failures += 1;
      if (record.failures === 1) {
        this.scheduleRetry(record);
      }
    } else {
      record.failures = 0;
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Power commands ----------------------------------------------------------

  /**
   * Send a power command to a server: on, soft shutdown, forced restart,
   * power cycle. Never a hard power off. Throws a message in the configured
   * language when it cannot be sent.
   * @returns {Promise<string|null>} the ipmitool action sent, null when nothing was needed
   */
  async command(record, command) {
    const language = this.config.language;
    if (!this.config.allowPowerControl) {
      throw new Error(pick(ACTION_TEXT.controlDisabled, language));
    }
    const action = IPMI_ACTIONS[command];
    if (!action) {
      throw new Error(pick(ACTION_TEXT.unknownCommand, language));
    }
    // The power state of now, not of the last read: a toggle is never blind.
    let on;
    try {
      on = await record.client.powerState();
    } catch (err) {
      logger.warn(`${this.label(record)}: ${err.message}`);
      throw new Error(pick(ERROR_TEXT[err.kind] ?? ACTION_TEXT.failed, language), { cause: err });
    }
    if (
      (command === COMMANDS.ON && on === true) ||
      (command === COMMANDS.SHUTDOWN && on === false)
    ) {
      return null; // already in the asked state
    }
    if ((command === COMMANDS.FORCE_RESTART || command === COMMANDS.POWER_CYCLE) && on === false) {
      throw new Error(pick(ACTION_TEXT.serverOff, language));
    }
    try {
      await record.client.power(action);
    } catch (err) {
      logger.warn(`${this.label(record)}: chassis power ${action}: ${err.message}`);
      const text = err.kind === ERROR_KINDS.PRIVILEGE ? ACTION_TEXT.privilege : ACTION_TEXT.failed;
      throw new Error(pick(text, language), { cause: err });
    }
    logger.info(`${this.serverName(record)}: chassis power ${action} sent`);
    this.scheduleAfterCommand(record);
    return action;
  }

  scheduleAfterCommand(record) {
    clearTimeout(record.commandTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.commandTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .catch((err) => logger.debug(`Read after a command failed: ${err.message}`));
    }, this.timings.afterCommandMs);
    record.commandTimer.unref?.();
  }

  /** The power switch of a device (onSetValue): 1 on, 0 soft shutdown. */
  async setValue(device, feature, value) {
    const found = this.find(device?.external_id);
    if (!found) {
      throw new Error(pick(ACTION_TEXT.unknownServer, this.config?.language));
    }
    if (!feature?.external_id?.endsWith(`:${FEATURE_KEYS.POWER}`)) {
      throw new Error(pick(ACTION_TEXT.unknownCommand, this.config.language));
    }
    await this.command(found.record, Number(value) === 1 ? COMMANDS.ON : COMMANDS.SHUTDOWN);
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The states of the server of a BMC, when the user added it.
   * @param {object} record
   * @param {object} [options]
   * @param {boolean} [options.force] send even unchanged values (a device just added)
   */
  async publishRecordStates(record, { force = false } = {}) {
    if (record.error || !record.server || !this.createdDevice(record.bmc.slot)) {
      return; // the transport badge says it
    }
    const values = featureValues(this.gladys, {
      slot: record.bmc.slot,
      server: record.server,
      language: this.config.language,
    });
    await this.sendStates(values, { force });
  }

  /** Keep what must be sent now: changed, and not too soon for the noisy values. */
  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const due = [];
    for (const { externalId, value, text, noisy } of values) {
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      const at = this.publishedAt.get(externalId);
      if (!force) {
        if (last === value && at !== undefined && now - at < this.timings.heartbeatMs) {
          continue;
        }
        if (last !== value && noisy && at !== undefined && now - at < this.timings.noisyEveryMs) {
          continue;
        }
      }
      due.push({ externalId, value, text });
    }
    if (due.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(
        due.map(({ externalId, value, text }) =>
          text
            ? { device_feature_external_id: externalId, text: value }
            : { device_feature_external_id: externalId, state: value },
        ),
      );
      for (const { externalId, value } of due) {
        this.published.set(externalId, value);
        this.publishedAt.set(externalId, now);
      }
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', 'warn', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" with their BMC. */
  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      const device = this.createdDevice(record.bmc.slot);
      if (record.readAt === 0 || !device) {
        continue;
      }
      const transport =
        record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'Transports accepted again');
    } catch (err) {
      this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every BMC answers. */
  connectionStatus() {
    if (!this.config) {
      return { connected: false, message: CONNECTION_TEXT.noBmc };
    }
    const { bmcs, invalidSlots } = this.config;
    if (bmcs.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noBmc,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noBmc)) {
      const parts = failing.map((record) =>
        labelled(
          record.bmc.name ?? addressOf(record.bmc),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one BMC of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) --------------------------------------------

  /**
   * The BMC record of a device external id.
   * @returns {{ record: object }|null}
   */
  find(externalId) {
    const slot = parseDeviceId(this.gladys, externalId);
    const record = slot === null ? null : this.records.get(slot);
    return record ? { record } : null;
  }

  /** Every BMC, in slot order. */
  sortedRecords() {
    return [...this.records.values()].sort((a, b) => a.bmc.slot - b.bmc.slot);
  }

  /** What the widget and the scene actions show of a server. */
  view(record) {
    return {
      name: this.serverName(record),
      online: record.error === null && record.server !== null && record.readAt > 0,
      error: record.error,
      server: record.server,
      control: this.config.allowPowerControl,
    };
  }

  /** "Test the connection": read every BMC now, one line each. */
  async testConnection() {
    for (const record of this.records.values()) {
      record.client.forgetInfo();
    }
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = this.sortedRecords().map((record) => {
        const name = record.bmc.name ?? addressOf(record.bmc);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { server } = record;
        return labelled(
          name,
          [
            text.ok,
            server.model,
            text.sensors(server.sensorCount),
            record.dcmi ? text.dcmi : null,
            text.control(this.config.allowPowerControl),
          ]
            .filter(Boolean)
            .join(', '),
          language,
        );
      });
      if (this.config?.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      message[language] = lines.join('\n').slice(0, 1000);
    }
    return message;
  }

  /** Throws the reason no BMC can answer a scene action, if any. */
  assertReadable() {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noBmc, this.config?.language));
    }
  }
}
