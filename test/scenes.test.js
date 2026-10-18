// -----------------------------------------------------------------------------
// The scene actions: the state of a server (figures and a summary in the
// configured language, an unreachable BMC as an answer), the power command
// and its guards.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeBmc, HOST_1, baseConfig, createWorld, deviceId } from './helpers/world.js';

test('state of a server: every figure, and a ready-made summary', async (t) => {
  const bmc = new FakeBmc({ shape: 'dell' });
  bmc.setSensors(
    readFileSync(
      new URL('./fixtures/ipmitool/dell-shaped/sdr-elist-psu-failed.txt', import.meta.url),
      'utf8',
    ),
  );
  const world = await createWorld({
    bmcs: { [HOST_1]: bmc },
    config: baseConfig({ language: 'fr', bmc_1_name: 'r720' }),
  });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_server_status', { server: deviceId(world.gladys) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    name: 'r720',
    online: true,
    summary:
      'r720 : allumé, santé Critique, 172 W, entrée 43 °C, processeur 52 °C, ventilateurs ' +
      '3\u202f720 tr/min, 3 capteur(s) hors seuil (Status Presence detected, Failure detected, ' +
      'Power Supply AC lost, Inlet Temp 43 °C, PS Redundancy Redundancy Lost)',
    power_on: true,
    health: 'Critique',
    power_watts: 172,
    intake_temperature: 43,
    cpu_temperature: 52,
    max_temperature: 52,
    fan_speed: 3720,
    sensors_out_of_range: 3,
    alerts:
      'Status Presence detected, Failure detected, Power Supply AC lost, Inlet Temp 43 °C, ' +
      'PS Redundancy Redundancy Lost',
  });
});

test('state of a server: an unreachable BMC is an answer, an unknown server an error', async (t) => {
  const bmc = new FakeBmc();
  bmc.reachable = false;
  const world = await createWorld({ bmcs: { [HOST_1]: bmc } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_server_status', { server: deviceId(world.gladys) });
  assert.deepEqual(ack.data.outputs, {
    name: HOST_1,
    online: false,
    summary: `${HOST_1}: does not answer`,
  });
  const unknown = await world.fake.sceneAction('get_server_status', { server: 'other' });
  assert.equal(unknown.success, false);
});

test('power command: refused while control is off, sent when allowed', async (t) => {
  const bmc = new FakeBmc();
  const off = await createWorld({ bmcs: { [HOST_1]: bmc } });
  const refused = await off.fake.sceneAction('power_command', {
    server: deviceId(off.gladys),
    command: 'force_restart',
  });
  await off.app.stop();
  assert.equal(refused.success, false);
  assert.match(refused.error, /Allow power control|Autoriser/);
  assert.deepEqual(bmc.powerActions, []);

  const world = await createWorld({
    bmcs: { [HOST_1]: bmc },
    config: baseConfig({ allow_power_control: true }),
  });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('power_command', {
    server: deviceId(world.gladys),
    command: 'force_restart',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { ipmi_action: 'reset' });
  const none = await world.fake.sceneAction('power_command', {
    server: deviceId(world.gladys),
    command: 'on',
  });
  assert.deepEqual(none.data.outputs, { ipmi_action: '' }, 'already on: nothing sent');
  const bad = await world.fake.sceneAction('power_command', {
    server: deviceId(world.gladys),
    command: 'off',
  });
  assert.equal(bad.success, false);
  assert.deepEqual(bmc.powerActions, ['reset']);
});
