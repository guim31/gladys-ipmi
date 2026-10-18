// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and fake BMCs: discovery, states
// (changes only, everything again when a device is added), the scene
// triggers on transitions, the power commands and their safety, the BMC
// that does not answer, the timer of the container, the quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  FakeBmc,
  HOST_1,
  HOST_2,
  PASSWORD,
  baseConfig,
  createClock,
  createDevices,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/ipmitool/${name}`, import.meta.url), 'utf8');

async function oneServer(t, { config = baseConfig(), shape = 'sim', ...rest } = {}) {
  const clock = createClock();
  const bmc = new FakeBmc({ shape });
  const world = await createWorld({ clock, bmcs: { [HOST_1]: bmc }, config, ...rest });
  t.after(() => world.app.stop());
  return { ...world, bmc };
}

const eventsOf = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

const lastState = (world, externalId) =>
  world.fake.states.filter((s) => s.device_feature_external_id === externalId).at(-1);

test('discovery: one device per BMC, should_poll false, connected', async (t) => {
  const bmc2 = new FakeBmc({ shape: 'dell' });
  const world = await createWorld({
    bmcs: { [HOST_1]: new FakeBmc(), [HOST_2]: bmc2 },
    config: baseConfig({
      bmc_2_host: `${HOST_2}:623`,
      bmc_2_username: 'gladys',
      bmc_2_password: PASSWORD,
      bmc_2_name: 'Rack',
    }),
  });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name, d.model, d.should_poll]),
    [
      [deviceId(world.gladys, 1), HOST_1, 'IPMI', false],
      [deviceId(world.gladys, 2), 'Rack', 'DELL PowerEdge R720', false],
    ],
  );
  assert.deepEqual(devices[1].params, [
    { name: 'Serial number', value: 'TESTSN1' },
    { name: 'BMC firmware', value: '2.65' },
  ]);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('states: nothing before the device is added, everything when it is, then changes only', async (t) => {
  const world = await oneServer(t);
  assert.equal(world.fake.states.length, 0, 'no device added yet');
  await createDevices(world);
  const sent = world.fake.states.map((s) => s.device_feature_external_id);
  assert.deepEqual(new Set(sent).size, 8, 'every feature');
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.POWER)).state, 1);
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.HEALTH)).text, 'OK');
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.POWER_DRAW)).state, 192);
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.FANS)).state, 4260);
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.ALERTS)).state, 0);
  assert.ok(world.fake.widgetRefreshes.length > 0, 'the widget is refreshed on creation');

  const before = world.fake.states.length;
  world.clock.advance(60_000);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');

  world.bmc.setSensors(fixture('sdr-elist-alert.txt'));
  world.clock.advance(60_000);
  await world.hub.pollAll();
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.HEALTH)).text, 'Critical');
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.ALERTS)).state, 4);
  assert.equal(lastState(world, featureId(world.gladys, FEATURE_KEYS.INTAKE)).state, 42);
});

test('a moving value is sent at most once a minute, an unchanged one again after 6 hours', async (t) => {
  const world = await oneServer(t);
  await createDevices(world);
  const intake = featureId(world.gladys, FEATURE_KEYS.INTAKE);
  const count = () =>
    world.fake.states.filter((s) => s.device_feature_external_id === intake).length;
  const first = count();
  world.bmc.setSensors(fixture('sdr-elist-ok.txt').replace('22 degrees C', '23 degrees C'));
  world.clock.advance(30_000);
  await world.hub.pollAll();
  assert.equal(count(), first, 'too soon');
  world.clock.advance(30_000);
  await world.hub.pollAll();
  assert.equal(count(), first + 1);
  world.clock.advance(6 * 3600_000);
  await world.hub.pollAll();
  assert.equal(count(), first + 2, 'heartbeat');
});

test('sensor trigger: transitions only, with the severity filter and the reading', async (t) => {
  const world = await oneServer(t, { config: baseConfig({ language: 'fr' }) });
  assert.equal(eventsOf(world, TRIGGERS.SENSOR).length, 0);
  world.bmc.setSensors(fixture('sdr-elist-alert.txt'));
  await world.hub.pollAll();
  const events = eventsOf(world, TRIGGERS.SENSOR).map((e) => e.data);
  assert.deepEqual(
    events.map((d) => [d.sensor, d.level, d.status, d.reading]),
    [
      ['Inlet Temp', 'warning', 'Avertissement', '42 °C'],
      ['CPU1 Temp', 'critical', 'Critique', '92 °C'],
      ['Fan1 RPM', 'warning', 'Avertissement', '900 RPM'],
      ['PS1 Status', 'warning', 'Avertissement', 'Presence detected, Power Supply AC lost'],
    ],
  );
  assert.equal(events[0].server, deviceId(world.gladys));
  assert.equal(events[0].server_name, HOST_1);
  // Still out of range: no new event. Worse: one.
  await world.hub.pollAll();
  assert.equal(eventsOf(world, TRIGGERS.SENSOR).length, 4);
  world.bmc.setSensors(
    fixture('sdr-elist-alert.txt').replace('| unc | 55.1 | 42', '| ucr | 55.1 | 46'),
  );
  await world.hub.pollAll();
  assert.deepEqual(eventsOf(world, TRIGGERS.SENSOR).at(-1).data.level, 'critical');
  assert.equal(eventsOf(world, TRIGGERS.SENSOR).length, 5);
});

test('a server first seen with sensors out of range is recorded, not announced', async (t) => {
  const clock = createClock();
  const bmc = new FakeBmc();
  bmc.setSensors(fixture('sdr-elist-alert.txt'));
  const world = await createWorld({ clock, bmcs: { [HOST_1]: bmc } });
  t.after(() => world.app.stop());
  assert.equal(eventsOf(world, TRIGGERS.SENSOR).length, 0);
});

test('power triggers: off then on, from what the BMC reports', async (t) => {
  const world = await oneServer(t);
  world.bmc.on = false;
  await world.hub.pollAll();
  world.bmc.on = true;
  await world.hub.pollAll();
  assert.deepEqual(
    world.fake.sceneEvents
      .filter((e) => e.key === TRIGGERS.ON || e.key === TRIGGERS.OFF)
      .map((e) => [e.key, e.data.server_name]),
    [
      [TRIGGERS.OFF, HOST_1],
      [TRIGGERS.ON, HOST_1],
    ],
  );
});

test('a server off keeps its features: no reading is no change of structure', async (t) => {
  const world = await oneServer(t);
  const before = world.fake.discoveredDevices[0].features.map((f) => f.external_id);
  world.bmc.on = false;
  await world.hub.pollAll();
  assert.deepEqual(
    world.fake.discoveredDevices[0].features.map((f) => f.external_id),
    before,
  );
});

test('SEL trigger: the entries added after the first read, oldest first, once each', async (t) => {
  const world = await oneServer(t, { shape: 'dell' });
  assert.equal(eventsOf(world, TRIGGERS.SEL).length, 0, 'the existing log is recorded');
  world.bmc.addSelEntry(
    '   5 | 10/18/2026 | 10:00:01 | Power Supply Status | Failure detected | Asserted',
    '10/18/2026 10:00:01',
  );
  world.bmc.addSelEntry(
    '   6 | 10/18/2026 | 10:00:02 | Memory ECC | Correctable ECC | Asserted',
    '10/18/2026 10:00:02',
  );
  world.clock.advance(60_000);
  await world.hub.pollAll();
  assert.deepEqual(
    eventsOf(world, TRIGGERS.SEL).map((e) => [e.data.message, e.data.created]),
    [
      ['Power Supply Status, Failure detected', '2026-10-18 10:00:01'],
      ['Memory ECC, Correctable ECC', '2026-10-18 10:00:02'],
    ],
  );
  world.clock.advance(60_000);
  await world.hub.pollAll();
  assert.equal(eventsOf(world, TRIGGERS.SEL).length, 2);
});

test('the SEL seen survives a restart: nothing announced twice', async (t) => {
  const clock = createClock();
  const bmc = new FakeBmc({ shape: 'dell' });
  const first = await createWorld({ clock, bmcs: { [HOST_1]: bmc } });
  bmc.addSelEntry('   5 | 10/18/2026 | 10:00:01 | Fan Fan2 RPM | Lower Critical | Asserted', 'x');
  clock.advance(60_000);
  await first.hub.pollAll();
  assert.equal(eventsOf(first, TRIGGERS.SEL).length, 1);
  await first.app.stop();
  const second = await createWorld({ clock, bmcs: { [HOST_1]: bmc }, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(eventsOf(second, TRIGGERS.SEL).length, 0);
});

test('power control is off by default: the switch is read-only and commands refused', async (t) => {
  const world = await oneServer(t);
  await createDevices(world);
  const power = world.fake.discoveredDevices[0].features.find((f) =>
    f.external_id.endsWith(':power'),
  );
  assert.equal(power.read_only, true);
  const device = world.gladys.devices[0];
  await assert.rejects(world.hub.setValue(device, power, 0), /Allow power control/);
  assert.deepEqual(world.bmc.powerActions, []);
});

test('the switch: 0 is a soft shutdown, 1 powers on, nothing sent when already there', async (t) => {
  const world = await oneServer(t, { config: baseConfig({ allow_power_control: true }) });
  await createDevices(world);
  const device = world.gladys.devices[0];
  const power = device.features.find((f) => f.external_id.endsWith(':power'));
  assert.equal(power.read_only, false);
  await world.hub.setValue(device, power, 1);
  assert.deepEqual(world.bmc.powerActions, [], 'already on');
  await world.hub.setValue(device, power, 0);
  assert.deepEqual(world.bmc.powerActions, ['soft']);
  await world.hub.setValue(device, power, 1);
  assert.deepEqual(world.bmc.powerActions, ['soft', 'on']);
});

test('forced commands: refused on a server off, a read-only account explained', async (t) => {
  const world = await oneServer(t, { config: baseConfig({ allow_power_control: true }) });
  world.bmc.on = false;
  const record = world.hub.records.get(1);
  await assert.rejects(world.hub.command(record, 'force_restart'), /server is off/);
  await assert.rejects(world.hub.command(record, 'power_cycle'), /server is off/);
  world.bmc.on = true;
  assert.equal(await world.hub.command(record, 'power_cycle'), 'cycle');
  world.bmc.privilege = 'USER';
  await assert.rejects(world.hub.command(record, 'force_restart'), /Operator privilege/);
});

test('a BMC that stops answering: unreachable badge, status message, back again', async (t) => {
  const world = await oneServer(t);
  await createDevices(world);
  world.bmc.reachable = false;
  await world.hub.pollAll();
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceId(world.gladys),
    transport: 'unreachable',
  });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  world.bmc.reachable = true;
  await world.hub.pollAll();
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a wrong password and an address not understood are said in the status', async (t) => {
  const world = await oneServer(t, {
    config: baseConfig({ bmc_1_password: 'nope', bmc_2_host: 'not an address' }),
  });
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  assert.match(world.fake.connectionStatus.message.en, /Address not understood/);
});

test('the container reads the BMCs on its own timer, without onPoll', async (t) => {
  const world = await oneServer(t, {
    timers: true,
    config: baseConfig({ poll_interval: '30' }),
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  world.hub.schedulePoll();
  const calls = world.bmc.calls.length;
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  await world.hub.records.get(1).polling;
  assert.ok(world.bmc.calls.length > calls, 'read again by the timer');
});

test('the configuration changes: another address forgets the old server', async (t) => {
  const clock = createClock();
  const world = await createWorld({
    clock,
    bmcs: { [HOST_1]: new FakeBmc(), [HOST_2]: new FakeBmc({ shape: 'dell' }) },
  });
  t.after(() => world.app.stop());
  await world.fake.configUpdated(baseConfig({ bmc_1_host: HOST_2 }));
  assert.equal(world.fake.discoveredDevices[0].model, 'DELL PowerEdge R720');
  assert.equal(eventsOf(world, TRIGGERS.SEL).length, 0, 'the new log is recorded silently');
});

test('the logs: a normal cycle writes nothing at info, the password never', async (t) => {
  const world = await oneServer(t);
  await createDevices(world);
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error', 'warn', 'info']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  for (let read = 0; read < 4; read += 1) {
    world.clock.advance(60_000);
    world.bmc.setSensors(read % 2 ? fixture('sdr-elist-alert.txt') : fixture('sdr-elist-ok.txt'));
    world.bmc.on = read !== 2;
    await world.hub.pollAll();
  }
  assert.deepEqual(lines, []);
  // A failure that repeats: one line, one when it heals.
  world.bmc.password = 'changed';
  for (let read = 0; read < 3; read += 1) {
    await world.hub.pollAll();
  }
  world.bmc.password = PASSWORD;
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.ok(lines.every((line) => !line.includes(PASSWORD)));
});
