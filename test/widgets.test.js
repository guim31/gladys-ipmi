// -----------------------------------------------------------------------------
// The `servers` widget: the overview of every server, one server in detail,
// an unreachable BMC, the power buttons (only when allowed, each with a
// confirmation), the budget of the core.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { FakeBmc, HOST_1, HOST_2, baseConfig, createWorld, deviceId } from './helpers/world.js';

const get = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
  assert.ok(content.components.length <= 8, 'budget: 8 components');
  assert.ok(content.components.filter((c) => c.type === 'text').length <= 2, 'budget: 2 texts');
  return content;
};

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

test('the overview: one row per server, the problems in colour', async (t) => {
  const down = new FakeBmc();
  down.reachable = false;
  const world = await createWorld({
    bmcs: { [HOST_1]: new FakeBmc({ shape: 'dell' }), [HOST_2]: down },
    config: baseConfig({ bmc_2_host: HOST_2, bmc_2_name: 'Backup' }),
  });
  t.after(() => world.app.stop());
  const content = await get(world, {}, 'fr');
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['PowerEdge R720', 'Allumé · OK · 172 W', 'success'],
      ['Backup', 'ne répond pas', 'danger'],
    ],
  );
  assert.deepEqual(buttons(content), ['refresh']);
});

test('one server: tiles, rows, the sensors out of range, no power button while control is off', async (t) => {
  const bmc = new FakeBmc();
  bmc.setSensors(
    readFileSync(new URL('./fixtures/ipmitool/sdr-elist-alert.txt', import.meta.url), 'utf8'),
  );
  const world = await createWorld({ bmcs: { [HOST_1]: bmc } });
  t.after(() => world.app.stop());
  const content = await get(world, { server: deviceId(world.gladys) });
  assert.deepEqual(
    content.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value, c.color]),
    [
      ['Power draw', 192, 'neutral'],
      ['Intake', 42, 'danger'],
      ['Highest', 92, 'danger'],
    ],
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ['Power', 'On'],
      ['Health', 'Critical'],
      ['Fans', '2,610 rpm · 1 failing'],
      ['Out of range', 'CPU1 Temp 92 °C, Inlet Temp 42 °C, Fan1…'],
    ],
  );
  assert.deepEqual(buttons(content), ['refresh']);
});

test('power control on: shut down when on, power on when off, confirmed, never forced', async (t) => {
  const bmc = new FakeBmc();
  const world = await createWorld({
    bmcs: { [HOST_1]: bmc },
    config: baseConfig({ allow_power_control: true }),
  });
  t.after(() => world.app.stop());
  const settings = { server: deviceId(world.gladys) };
  let content = await get(world, settings);
  assert.deepEqual(buttons(content), ['refresh', 'shutdown']);
  assert.ok(
    content.components
      .filter((c) => c.type === 'button' && c.action.key !== 'refresh')
      .every((c) => c.action.confirm === true),
  );
  const ack = await world.fake.widgetAction(WIDGET_KEY, 'shutdown', {}, { settings });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'Clean shutdown requested.');
  assert.deepEqual(bmc.powerActions, ['soft']);

  await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { settings });
  content = await get(world, settings);
  assert.deepEqual(buttons(content), ['refresh', 'power_on']);
  await world.fake.widgetAction(WIDGET_KEY, 'power_on', {}, { settings });
  assert.deepEqual(bmc.powerActions, ['soft', 'on']);
});

test('an unreachable BMC, a server gone, no BMC at all', async (t) => {
  const bmc = new FakeBmc();
  const world = await createWorld({ bmcs: { [HOST_1]: bmc } });
  t.after(() => world.app.stop());
  bmc.password = 'changed';
  await world.hub.pollAll();
  const content = await get(world, { server: deviceId(world.gladys) });
  assert.equal(content.components[1].text, `${HOST_1}: user name or password refused`);
  const gone = await get(world, { server: deviceId(world.gladys, 3) });
  assert.match(gone.components[0].text, /no longer in the configuration/);
  await world.fake.configUpdated({ language: 'en' });
  const empty = await get(world);
  assert.match(empty.components[0].text, /Add a BMC/);
});
