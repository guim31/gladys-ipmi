// -----------------------------------------------------------------------------
// Parsers of the text ipmitool prints (version 1.8.19, the Alpine package of
// the image). Pure functions, frozen by the tests on outputs captured from
// the OpenIPMI simulator (test/fixtures/ipmitool/) and on vendor-shaped
// outputs written in the same format.
//
// ipmitool prints harmless noise on stderr ("Unable to Get Channel Cipher
// Suites", "Get HPM.x Capabilities request failed"): only the error patterns
// below are taken into account.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  AUTH: 'auth',
  PRIVILEGE: 'privilege',
  NO_TOOL: 'no_tool',
  FAILED: 'failed',
});

/** `Key : value` lines (chassis status, sel info, fru print, mc info). */
function keyValues(text) {
  const values = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const match = line.match(/^\s*([^:]+?)\s+:\s?(.*)$/);
    if (match && !values.has(match[1])) {
      values.set(match[1], match[2].trim());
    }
  }
  return values;
}

/**
 * `ipmitool chassis status`.
 * @returns {{ on: boolean|null, faults: string[] }}
 */
export function parseChassisStatus(text) {
  const values = keyValues(text);
  const power = values.get('System Power');
  const faults = [];
  const flag = (key, name) => {
    if (values.get(key) === 'true') {
      faults.push(name);
    }
  };
  flag('Power Overload', 'power_overload');
  flag('Main Power Fault', 'main_power_fault');
  flag('Power Control Fault', 'power_control_fault');
  flag('Drive Fault', 'drive_fault');
  flag('Cooling/Fan Fault', 'cooling_fault');
  return { on: power === 'on' ? true : power === 'off' ? false : null, faults };
}

// Threshold states of `sdr elist`: the lower/upper non-critical, critical and
// non-recoverable thresholds crossed (`sdr list` prints the short nc/cr/nr).
const SEVERITY_OF_STATUS = {
  ok: 'OK',
  lnc: 'Warning',
  unc: 'Warning',
  nc: 'Warning',
  lcr: 'Critical',
  ucr: 'Critical',
  cr: 'Critical',
  lnr: 'Critical',
  unr: 'Critical',
  nr: 'Critical',
};

// The reading of a discrete sensor (power supply, drive, redundancy) is a
// list of asserted states. A few of them mean a failure.
const DISCRETE_CRITICAL = /failure detected|non-recoverable|transition to critical/i;
const DISCRETE_WARNING =
  /predictive failure|ac lost|out-of-range|redundancy lost|redundancy degraded|fault|transition to non-critical/i;

const UNITS = [
  ['degrees C', 'celsius'],
  ['RPM', 'rpm'],
  ['Watts', 'watts'],
  ['Volts', 'volts'],
  ['Amps', 'amps'],
  ['percent', 'percent'],
  ['%', 'percent'],
];

/**
 * One line of `ipmitool sdr elist`: `name | id | status | entity | reading`.
 * @returns {{ name, number, status, entity, instance, value, unit, text, severity }|null}
 */
export function parseSdrLine(line) {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length < 5 || !parts[0] || !/^[0-9a-f]+h$/i.test(parts[1])) {
    return null;
  }
  const [name, id, status, entity, ...rest] = parts;
  const reading = rest.join(' | ');
  const [entityId, instance] = entity.split('.').map(Number);
  let value = null;
  let unit = null;
  const numeric = reading.match(/^(-?\d+(?:\.\d+)?)\s+(.+)$/);
  if (numeric) {
    const known = UNITS.find(([suffix]) => numeric[2] === suffix);
    if (known) {
      value = Number(numeric[1]);
      unit = known[1];
    }
  }
  let severity = null;
  if (status !== 'ns') {
    if (value !== null) {
      severity = SEVERITY_OF_STATUS[status] ?? null;
    } else if (DISCRETE_CRITICAL.test(reading)) {
      severity = 'Critical';
    } else if (DISCRETE_WARNING.test(reading)) {
      severity = 'Warning';
    } else {
      severity = SEVERITY_OF_STATUS[status] ?? null;
    }
  }
  return {
    name,
    number: parseInt(id, 16),
    status,
    entity: Number.isFinite(entityId) ? entityId : null,
    instance: Number.isFinite(instance) ? instance : null,
    value,
    unit,
    // "No Reading", "Disabled", or the discrete states.
    text: value === null ? reading : null,
    severity,
  };
}

/** `ipmitool sdr elist`: every sensor with a usable line. */
export function parseSdrList(text) {
  return String(text ?? '')
    .split('\n')
    .map(parseSdrLine)
    .filter(Boolean);
}

/**
 * `ipmitool dcmi power reading`: the instantaneous power, null when absent
 * or when the BMC says power measurement is off.
 */
export function parseDcmiPower(text) {
  const body = String(text ?? '');
  if (/Power reading state is:\s*deactivated/i.test(body)) {
    return null;
  }
  const match = body.match(/Instantaneous power reading:\s*(\d+(?:\.\d+)?)\s*Watts/i);
  return match ? Number(match[1]) : null;
}

/**
 * `ipmitool sel info`.
 * @returns {{ entries: number|null, lastAdd: string|null }}
 */
export function parseSelInfo(text) {
  const values = keyValues(text);
  const entries = Number(values.get('Entries'));
  const lastAdd = values.get('Last Add Time');
  return {
    entries: Number.isFinite(entries) ? entries : null,
    lastAdd: lastAdd && !/not available/i.test(lastAdd) ? lastAdd : null,
  };
}

// `10/18/2026 | 07:22:15`: the date format of ipmitool (MM/DD/YYYY).
const SEL_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * `ipmitool sel elist`: the entries, newest first, with a stable key. The
 * record id alone is not: a cleared SEL numbers its entries from 1 again.
 * @returns {Array<{ key: string, id: string, message: string, created: string|null, asserted: boolean|null }>}
 */
export function parseSelList(text) {
  const entries = [];
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 5 || !/^[0-9a-f]+$/i.test(parts[0])) {
      continue;
    }
    const [id, date, time, ...rest] = parts;
    const day = date.match(SEL_DATE);
    const created =
      day && /^\d{2}:\d{2}:\d{2}$/.test(time) ? `${day[3]}-${day[1]}-${day[2]} ${time}` : null;
    const direction = rest.find((part) => /^(Asserted|Deasserted)$/.test(part));
    entries.push({
      key: `${id}|${date}|${time}`,
      id,
      message: rest
        .filter((part) => part && part !== direction)
        .join(', ')
        .replace(/\s+/g, ' '),
      created,
      asserted: direction ? direction === 'Asserted' : null,
    });
  }
  return entries.reverse();
}

/**
 * `ipmitool fru print 0`: who made the server, its name and serial number.
 * @returns {{ manufacturer: string|null, product: string|null, serial: string|null }}
 */
export function parseFru(text) {
  const values = keyValues(text);
  const first = (...keys) => {
    for (const key of keys) {
      const value = values.get(key);
      if (value && !/^(not specified|to be filled.*|0+|n\/a)$/i.test(value)) {
        return value;
      }
    }
    return null;
  };
  return {
    manufacturer: first('Product Manufacturer', 'Board Mfg'),
    product: first('Product Name', 'Board Product'),
    serial: first('Product Serial', 'Chassis Serial', 'Board Serial'),
  };
}

/** `ipmitool mc info`: the manufacturer and firmware of the BMC. */
export function parseMcInfo(text) {
  const values = keyValues(text);
  const name = values.get('Manufacturer Name');
  return {
    manufacturer: name && !/^unknown/i.test(name) ? name : null,
    firmware: values.get('Firmware Revision') || null,
  };
}

/**
 * The kind of a failure, from what ipmitool printed. The generic "Unable to
 * establish IPMI v2 / RMCP+ session" says nothing: a verbose run (-v) tells
 * a wrong password from a BMC that does not answer (src/ipmi/client.js).
 * @returns {string|null} an ERROR_KINDS value, null when undecided
 */
export function classifyError(output) {
  const text = String(output ?? '');
  if (
    /RAKP 2 HMAC is invalid|unauthorized name|Invalid user name|Activate Session command failed|Invalid password|Password is too long|RAKP \d message indicates an error : (?!.*role)/i.test(
      text,
    )
  ) {
    return ERROR_KINDS.AUTH;
  }
  if (/Insufficient privilege level|invalid role|privilege level exceeds|\(d4\)/i.test(text)) {
    return ERROR_KINDS.PRIVILEGE;
  }
  if (
    /Get Auth Capabilities error|No response|Address lookup .* failed|Could not open socket|insufficient resources for session|Timeout|timed out/i.test(
      text,
    )
  ) {
    return ERROR_KINDS.UNREACHABLE;
  }
  return null;
}

/** Whether the output says the session could not be opened at all. */
export const isSessionFailure = (output) =>
  /Unable to establish (IPMI v2 \/ RMCP\+|IPMI v1\.5 \/ RMCP|LAN) session/i.test(
    String(output ?? ''),
  );
