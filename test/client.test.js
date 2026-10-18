// -----------------------------------------------------------------------------
// The ipmitool client: what it sends (never the password on the command
// line, USER for reads, OPERATOR for power, the SDR cache), one command at a
// time, the error kinds, and the optional DCMI and SEL reads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, IpmiClient, SEL_TAIL } from '../src/ipmi/client.js';
import { FakeBmc, PASSWORD, USERNAME, commandOf, createIpmiNetwork } from './helpers/fakeIpmi.js';

const HOST = '192.0.2.30';

function clientFor(bmc, options = {}) {
  const network = createIpmiNetwork({ [HOST]: bmc });
  let time = Date.UTC(2026, 9, 18);
  const clock = { now: () => time, advance: (ms) => (time += ms) };
  const client = new IpmiClient({
    slot: 1,
    host: HOST,
    port: 623,
    username: USERNAME,
    password: PASSWORD,
    iface: 'lanplus',
    run: network.run,
    cacheDir: '/tmp',
    now: clock.now,
    ...options,
  });
  return { client, clock };
}

const commands = (bmc) => bmc.calls.map((call) => commandOf(call.args).join(' '));
const option = (args, name) => args[args.indexOf(name) + 1];

test('the password goes through the environment, never the command line', async () => {
  const bmc = new FakeBmc();
  const { client } = clientFor(bmc);
  await client.read();
  assert.ok(bmc.calls.length > 0);
  for (const { args, password } of bmc.calls) {
    assert.ok(!args.join(' ').includes(PASSWORD), `password in ${args.join(' ')}`);
    assert.ok(args.includes('-E'), '-E: read IPMI_PASSWORD');
    assert.equal(password, PASSWORD);
    assert.equal(option(args, '-I'), 'lanplus');
    assert.equal(option(args, '-H'), HOST);
    assert.equal(option(args, '-p'), '623');
    assert.equal(option(args, '-U'), USERNAME);
    assert.equal(option(args, '-L'), 'USER', 'reads need the User privilege only');
  }
});

test('a read: chassis, hourly SDR dump and FRU, sensors from the cache, DCMI tried', async () => {
  const bmc = new FakeBmc({ shape: 'dell' });
  const { client, clock } = clientFor(bmc);
  const raw = await client.read();
  assert.deepEqual(commands(bmc), [
    'chassis status',
    'sdr dump /tmp/gladys-ipmi-sdr-1.cache',
    'fru print 0',
    'mc info',
    'sdr elist',
    'dcmi power reading',
  ]);
  const elist = bmc.calls.find(
    (call) => commandOf(call.args)[0] === 'sdr' && commandOf(call.args)[1] === 'elist',
  );
  assert.equal(option(elist.args, '-S'), '/tmp/gladys-ipmi-sdr-1.cache');
  assert.equal(raw.chassis.on, true);
  assert.equal(raw.dcmiWatts, 172);
  assert.equal(raw.fru.product, 'PowerEdge R720');
  assert.equal(raw.sensors.length, 24);

  bmc.calls.length = 0;
  clock.advance(60_000);
  await client.read();
  assert.deepEqual(commands(bmc), ['chassis status', 'sdr elist', 'dcmi power reading']);

  bmc.calls.length = 0;
  clock.advance(3600_000);
  await client.read();
  assert.ok(commands(bmc).includes('sdr dump /tmp/gladys-ipmi-sdr-1.cache'), 'dumped again');
});

test('a BMC without DCMI is not asked again before the next hourly refresh', async () => {
  const bmc = new FakeBmc();
  const { client, clock } = clientFor(bmc);
  assert.equal((await client.read()).dcmiWatts, null);
  bmc.calls.length = 0;
  clock.advance(60_000);
  await client.read();
  assert.deepEqual(commands(bmc), ['chassis status', 'sdr elist']);
});

test('one command at a time per BMC', async () => {
  const bmc = new FakeBmc();
  let running = 0;
  let most = 0;
  const run = async (args, options) => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return bmc.handle(args, options);
  };
  const { client } = clientFor(bmc, { run });
  await Promise.all([client.read(), client.readSel(), client.read()]);
  assert.equal(most, 1);
});

test('errors: wrong password, unknown user, unreachable BMC, missing ipmitool', async () => {
  const wrong = new FakeBmc();
  wrong.password = 'another';
  await assert.rejects(clientFor(wrong).client.read(), { kind: ERROR_KINDS.AUTH });
  // The verbose run that told it is a plain chassis status.
  assert.ok(wrong.calls.at(-1).args.includes('-v'));

  const user = new FakeBmc();
  user.username = 'admin';
  await assert.rejects(clientFor(user).client.read(), { kind: ERROR_KINDS.AUTH });

  const down = new FakeBmc();
  down.reachable = false;
  await assert.rejects(clientFor(down).client.read(), { kind: ERROR_KINDS.UNREACHABLE });

  const missing = async () => ({
    code: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    missing: true,
  });
  await assert.rejects(clientFor(new FakeBmc(), { run: missing }).client.read(), {
    kind: ERROR_KINDS.NO_TOOL,
  });

  const slow = async () => ({ code: null, stdout: '', stderr: '', timedOut: true, missing: false });
  await assert.rejects(clientFor(new FakeBmc(), { run: slow }).client.read(), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
});

test('the SEL: read when it changed only, the newest entries', async () => {
  const bmc = new FakeBmc({ shape: 'dell' });
  const { client } = clientFor(bmc);
  const first = await client.readSel();
  assert.equal(first.length, 4);
  assert.ok(commands(bmc).includes(`sel elist last ${SEL_TAIL}`));
  bmc.calls.length = 0;
  assert.equal(await client.readSel(), null, 'unchanged: one sel info only');
  assert.deepEqual(commands(bmc), ['sel info']);
  bmc.addSelEntry(
    '   5 | 10/18/2026 | 09:00:00 | Fan Fan1 RPM | Lower Critical going low  | Asserted',
    '10/18/2026 09:00:00',
  );
  const next = await client.readSel();
  assert.equal(next[0].id, '5');
  const empty = new FakeBmc();
  assert.deepEqual(await clientFor(empty).client.readSel(), []);
});

test('power: OPERATOR privilege, never a hard power off', async () => {
  const bmc = new FakeBmc();
  const { client } = clientFor(bmc);
  await client.power('soft');
  const call = bmc.calls.at(-1);
  assert.deepEqual(commandOf(call.args), ['chassis', 'power', 'soft']);
  assert.equal(option(call.args, '-L'), 'OPERATOR');
  assert.deepEqual(bmc.powerActions, ['soft']);
  await assert.rejects(client.power('off'));
  assert.deepEqual(bmc.powerActions, ['soft'], '"off" never reaches ipmitool');

  const readOnly = new FakeBmc();
  readOnly.privilege = 'USER';
  await assert.rejects(clientFor(readOnly).client.power('on'), { kind: ERROR_KINDS.PRIVILEGE });
});

test('IPMI 1.5, another port, no user name', async () => {
  const bmc = new FakeBmc();
  bmc.username = '';
  const { client } = clientFor(bmc, { iface: 'lan', port: 6230, username: '' });
  await client.read();
  const { args } = bmc.calls[0];
  assert.equal(option(args, '-I'), 'lan');
  assert.equal(option(args, '-p'), '6230');
  assert.ok(!args.includes('-U'));
});
