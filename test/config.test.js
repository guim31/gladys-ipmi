// -----------------------------------------------------------------------------
// The configuration: addresses typed by the user (and the ones refused, since
// the host goes to the ipmitool command line), defaults, slots.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, addressOf, normalizeConfig, parseBmcHost } from '../src/config.js';

test('addresses: IPv4, host names, ports, IPv6, a pasted URL', () => {
  assert.deepEqual(parseBmcHost(' 192.0.2.10 '), { host: '192.0.2.10', port: 623 });
  assert.deepEqual(parseBmcHost('idrac.lan'), { host: 'idrac.lan', port: 623 });
  assert.deepEqual(parseBmcHost('idrac.lan:6230'), { host: 'idrac.lan', port: 6230 });
  assert.deepEqual(parseBmcHost('2001:db8::1'), { host: '2001:db8::1', port: 623 });
  assert.deepEqual(parseBmcHost('[2001:db8::1]:6230'), { host: '2001:db8::1', port: 6230 });
  // The address of the web page: its host, IPMI keeps its own port.
  assert.deepEqual(parseBmcHost('https://192.0.2.10:443/restgui/start.html'), {
    host: '192.0.2.10',
    port: 623,
  });
  assert.equal(addressOf({ host: 'idrac.lan', port: 623 }), 'idrac.lan');
  assert.equal(addressOf({ host: '2001:db8::1', port: 6230 }), '[2001:db8::1]:6230');
});

test('addresses refused: options, spaces, credentials, bad ports', () => {
  for (const bad of [
    '',
    '-H',
    '--help',
    'idrac lan',
    'idrac.lan;reboot',
    'https://root:calvin@192.0.2.10',
    'idrac.lan:0',
    'idrac.lan:70000',
    'ftp://idrac.lan',
    '[::1',
    42,
  ]) {
    assert.equal(parseBmcHost(bad), null, String(bad));
  }
});

test('normalization: slots, invalid ones, defaults', () => {
  const config = normalizeConfig({
    bmc_1_host: '192.0.2.10',
    bmc_1_username: ' admin ',
    bmc_1_password: 'secret\n',
    bmc_2_host: 'not valid',
    bmc_3_host: '192.0.2.12',
    bmc_3_username: 'bad\u0000name',
    interface: 'lan',
    poll_interval: '120',
    allow_power_control: 'true',
  });
  assert.deepEqual(config.bmcs, [
    {
      slot: 1,
      host: '192.0.2.10',
      port: 623,
      username: 'admin',
      password: 'secret',
      name: null,
    },
  ]);
  assert.deepEqual(config.invalidSlots, [2, 3]);
  assert.equal(config.iface, 'lan');
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.allowPowerControl, true);
  assert.equal(config.language, 'fr');

  const defaults = normalizeConfig({ interface: 'ssh', poll_interval: '5', language: 'it' });
  assert.equal(defaults.iface, DEFAULT_CONFIG.interface);
  assert.equal(defaults.pollIntervalMs, 60_000);
  assert.equal(defaults.allowPowerControl, false);
  assert.equal(defaults.language, 'fr');
  assert.deepEqual(normalizeConfig(null).bmcs, []);
});
