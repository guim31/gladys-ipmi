// -----------------------------------------------------------------------------
// The ipmitool parsers and the figures of a server, on the outputs captured
// from the OpenIPMI simulator and on the Dell-shaped ones (hand-written in
// the same format, see test/fixtures/ipmitool/dell-shaped/README.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ERROR_KINDS,
  classifyError,
  isSessionFailure,
  parseChassisStatus,
  parseDcmiPower,
  parseFru,
  parseMcInfo,
  parseSdrList,
  parseSelInfo,
  parseSelList,
} from '../src/ipmi/parse.js';
import { parseServer } from '../src/ipmi/model.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/ipmitool/${name}`, import.meta.url), 'utf8');

test('chassis status: power state and faults', () => {
  assert.deepEqual(parseChassisStatus(fixture('chassis-status-on.txt')), { on: true, faults: [] });
  assert.deepEqual(parseChassisStatus(fixture('chassis-status-off.txt')), {
    on: false,
    faults: [],
  });
  const faulty = fixture('chassis-status-on.txt')
    .replace('Main Power Fault     : false', 'Main Power Fault     : true')
    .replace('Cooling/Fan Fault    : false', 'Cooling/Fan Fault    : true');
  assert.deepEqual(parseChassisStatus(faulty).faults, ['main_power_fault', 'cooling_fault']);
  assert.equal(parseChassisStatus('garbage').on, null);
});

test('sdr elist: readings, units, entities and threshold states', () => {
  const sensors = parseSdrList(fixture('sdr-elist-ok.txt'));
  assert.equal(sensors.length, 9);
  assert.deepEqual(sensors[0], {
    name: 'Inlet Temp',
    number: 1,
    status: 'ok',
    entity: 55,
    instance: 1,
    value: 22,
    unit: 'celsius',
    text: null,
    severity: 'OK',
  });
  assert.deepEqual(
    sensors.map((s) => [s.name, s.value, s.unit]),
    [
      ['Inlet Temp', 22, 'celsius'],
      ['CPU1 Temp', 45, 'celsius'],
      ['CPU2 Temp', 48, 'celsius'],
      ['Exhaust Temp', 35, 'celsius'],
      ['Fan1 RPM', 4200, 'rpm'],
      ['Fan2 RPM', 4320, 'rpm'],
      ['Pwr Consumption', 192, 'watts'],
      ['Voltage 12V', 12, 'volts'],
      ['PS1 Status', null, null],
    ],
  );
  const alert = parseSdrList(fixture('sdr-elist-alert.txt'));
  assert.deepEqual(
    alert.map((s) => [s.name, s.severity]),
    [
      ['Inlet Temp', 'Warning'],
      ['CPU1 Temp', 'Critical'],
      ['CPU2 Temp', 'OK'],
      ['Exhaust Temp', 'OK'],
      ['Fan1 RPM', 'Warning'],
      ['Fan2 RPM', 'OK'],
      ['Pwr Consumption', 'OK'],
      ['Voltage 12V', 'OK'],
      // Discrete: "Power Supply AC lost" is a failure state.
      ['PS1 Status', 'Warning'],
    ],
  );
});

test('sdr elist: a sensor without reading has no severity, discrete failures do', () => {
  const dell = parseSdrList(fixture('dell-shaped/sdr-elist.txt'));
  const fan6 = dell.find((s) => s.name === 'Fan6 RPM');
  assert.equal(fan6.severity, null);
  assert.equal(fan6.text, 'Disabled');
  assert.ok(dell.every((s) => s.severity !== 'Warning' && s.severity !== 'Critical'));
  const failed = parseSdrList(fixture('dell-shaped/sdr-elist-psu-failed.txt'));
  assert.deepEqual(
    failed
      .filter((s) => s.severity !== 'OK' && s.severity !== null)
      .map((s) => [s.name, s.severity]),
    [
      ['Inlet Temp', 'Warning'],
      ['Status', 'Critical'],
      ['PS Redundancy', 'Warning'],
    ],
  );
  // The empty reading of a discrete sensor is kept, not a crash.
  assert.equal(dell.find((s) => s.name === 'Intrusion').text, '');
});

test('dcmi power reading: the instantaneous power, nothing when deactivated', () => {
  assert.equal(parseDcmiPower(fixture('dell-shaped/dcmi-power-reading.txt')), 172);
  assert.equal(
    parseDcmiPower(
      fixture('dell-shaped/dcmi-power-reading.txt').replace('activated', 'deactivated'),
    ),
    null,
  );
  assert.equal(parseDcmiPower(fixture('dcmi-unsupported.stderr.txt')), null);
});

test('sel info and sel elist: entries, newest first, with a key that survives a clear', () => {
  assert.deepEqual(parseSelInfo(fixture('sel-info-6.txt')), {
    entries: 5,
    lastAdd: 'S+ 70/010 11:47:44',
  });
  assert.deepEqual(parseSelInfo('Entries          : 0\nLast Add Time    : Not Available\n'), {
    entries: 0,
    lastAdd: null,
  });
  const sim = parseSelList(fixture('sel-elist.txt'));
  assert.equal(sim.length, 5);
  assert.deepEqual(sim[0], {
    key: '5|Pre-Init|0000820064',
    id: '5',
    message: 'Fan Fan1 RPM, Lower Non-critical going low, Reading 900 < Threshold 1200 RPM',
    created: null,
    asserted: true,
  });
  const dell = parseSelList(fixture('dell-shaped/sel-elist.txt'));
  assert.deepEqual(dell[0], {
    key: '4|10/18/2026|06:03:11',
    id: '4',
    message:
      'Temperature Inlet Temp, Upper Non-critical going high, Reading 43 > Threshold 42 degrees C',
    created: '2026-10-18 06:03:11',
    asserted: true,
  });
  assert.equal(dell[3].message, 'Event Logging Disabled SEL, Log area reset/cleared');
});

test('fru print and mc info: maker, product, serial, firmware', () => {
  assert.deepEqual(parseFru(fixture('dell-shaped/fru-print-0.txt')), {
    manufacturer: 'DELL',
    product: 'PowerEdge R720',
    serial: 'TESTSN1',
  });
  assert.deepEqual(parseFru(fixture('fru-none.txt')), {
    manufacturer: null,
    product: null,
    serial: null,
  });
  assert.deepEqual(parseMcInfo(fixture('dell-shaped/mc-info.txt')), {
    manufacturer: 'DELL Inc',
    firmware: '2.65',
  });
});

test('errors: the verbose output tells a wrong password from a BMC that does not answer', () => {
  assert.equal(classifyError(fixture('error-password.stderr.txt')), ERROR_KINDS.AUTH);
  assert.equal(classifyError(fixture('error-user.stderr.txt')), ERROR_KINDS.AUTH);
  assert.equal(classifyError(fixture('error-lan-password.stderr.txt')), ERROR_KINDS.AUTH);
  assert.equal(classifyError(fixture('error-unreachable.stderr.txt')), ERROR_KINDS.UNREACHABLE);
  assert.equal(classifyError(fixture('error-privilege.stderr.txt')), ERROR_KINDS.PRIVILEGE);
  // Without -v, ipmitool only says it failed.
  const generic = 'Error: Unable to establish IPMI v2 / RMCP+ session\n';
  assert.equal(classifyError(generic), null);
  assert.equal(isSessionFailure(generic), true);
  assert.equal(isSessionFailure(fixture('error-lan-password.stderr.txt')), true);
  // The usual noise is no error.
  assert.equal(classifyError('Unable to Get Channel Cipher Suites\n'), null);
});

test('a server: health, power, temperatures and fans from the simulator', () => {
  const server = parseServer({
    chassis: parseChassisStatus(fixture('chassis-status-on.txt')),
    sensors: parseSdrList(fixture('sdr-elist-ok.txt')),
    dcmiWatts: null,
    fru: null,
    mc: null,
  });
  assert.equal(server.on, true);
  assert.equal(server.health, 'OK');
  assert.equal(server.watts, 192, 'the Watts sensor when there is no DCMI');
  assert.equal(server.intake, 22);
  assert.equal(server.cpu, 48);
  assert.equal(server.hottest, 48);
  assert.deepEqual(server.fans, { speed: 4260, unit: 'rpm', count: 2, failed: 0 });
  assert.deepEqual(server.alerts, []);
  assert.equal(server.model, null);

  const alert = parseServer({
    chassis: parseChassisStatus(fixture('chassis-status-on.txt')),
    sensors: parseSdrList(fixture('sdr-elist-alert.txt')),
    dcmiWatts: null,
  });
  assert.equal(alert.health, 'Critical');
  assert.deepEqual(
    alert.alerts.map((a) => [a.name, a.severity]),
    [
      ['CPU1 Temp', 'Critical'],
      ['Inlet Temp', 'Warning'],
      ['Fan1 RPM', 'Warning'],
      ['PS1 Status', 'Warning'],
    ],
  );
  assert.equal(alert.fans.failed, 1);
});

test('a Dell-shaped server: processors named "Temp", DCMI first, FRU names', () => {
  const raw = {
    chassis: parseChassisStatus(fixture('chassis-status-on.txt')),
    sensors: parseSdrList(fixture('dell-shaped/sdr-elist.txt')),
    dcmiWatts: 172,
    fru: parseFru(fixture('dell-shaped/fru-print-0.txt')),
    mc: parseMcInfo(fixture('dell-shaped/mc-info.txt')),
  };
  const server = parseServer(raw);
  assert.equal(server.intake, 23);
  assert.equal(server.cpu, 52, 'entity 3 is a processor, whatever its name');
  assert.equal(server.hottest, 52);
  assert.equal(server.watts, 172);
  assert.equal(parseServer({ ...raw, dcmiWatts: null }).watts, 168);
  assert.deepEqual(server.fans, { speed: 3720, unit: 'rpm', count: 5, failed: 0 });
  assert.equal(server.model, 'DELL PowerEdge R720');
  assert.equal(server.product, 'PowerEdge R720');
  assert.equal(server.serial, 'TESTSN1');
  assert.equal(server.health, 'OK');
  const failed = parseServer({
    ...raw,
    sensors: parseSdrList(fixture('dell-shaped/sdr-elist-psu-failed.txt')),
  });
  assert.equal(failed.health, 'Critical');
});

test('chassis faults weigh on the health, a server without readings has none', () => {
  const sensors = parseSdrList(fixture('sdr-elist-ok.txt'));
  const health = (faults) => parseServer({ chassis: { on: true, faults }, sensors }).health;
  assert.equal(health(['cooling_fault']), 'Warning');
  assert.equal(health(['drive_fault', 'power_overload']), 'Critical');
  assert.equal(parseServer({ chassis: { on: false, faults: [] }, sensors: [] }).health, null);
});

test('Supermicro-style names: input power summed, margins ignored', () => {
  const sensors = parseSdrList(
    [
      'CPU1 Temp        | 01h | ok  |  3.1 | 41 degrees C',
      'CPU1 Margin Temp | 02h | ok  |  3.1 | 60 degrees C',
      'System Temp      | 11h | ok  |  7.1 | 30 degrees C',
      'Peripheral Temp  | 12h | ok  |  7.1 | 35 degrees C',
      'FAN1             | 41h | ok  | 29.1 | 1400 RPM',
      'PS1 Input Power  | 61h | ok  | 10.1 | 120 Watts',
      'PS2 Input Power  | 62h | ok  | 10.2 | 110 Watts',
    ].join('\n'),
  );
  const server = parseServer({ chassis: { on: true, faults: [] }, sensors });
  assert.equal(server.watts, 230);
  assert.equal(server.cpu, 41);
  assert.equal(server.hottest, 41, 'a margin is not a temperature');
  assert.equal(server.intake, null, 'no inlet sensor: no guess');
});
