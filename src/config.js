// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three BMCs (iDRAC, iLO, Supermicro, ASRock Rack…), each in its own
// slot. The slot number is the device identity: a new address for the same
// server keeps the device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// IPMI 2.0 (RMCP+, encrypted) or IPMI 1.5 (older BMCs only).
export const INTERFACES = ['lanplus', 'lan'];

// Refresh intervals offered in the configuration, in seconds. A BMC is a
// small chip shared with the fans and the console: no faster than 30 s.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_PORT = 623;

export const DEFAULT_CONFIG = {
  bmc_1_host: '',
  bmc_1_username: '',
  bmc_1_password: '',
  bmc_1_name: '',
  bmc_2_host: '',
  bmc_2_username: '',
  bmc_2_password: '',
  bmc_2_name: '',
  bmc_3_host: '',
  bmc_3_username: '',
  bmc_3_password: '',
  bmc_3_name: '',
  interface: 'lanplus',
  poll_interval: '60',
  allow_power_control: false,
  language: 'fr',
};

export const MAX_NAME_LENGTH = 40;

const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Parse the address typed by the user: a host name or IPv4 (`192.0.2.10`,
 * `idrac.lan`), with an optional port (`192.0.2.10:6230`), an IPv6 address,
 * bracketed with a port (`[2001:db8::1]:623`), or the URL of the BMC web
 * page copied from the browser (its host is kept, IPMI has its own port).
 * Anything else is refused: the host goes to the ipmitool command line.
 * @param {unknown} raw
 * @returns {{ host: string, port: number }|null}
 */
export function parseBmcHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw.trim();
  if (!text || /\s/.test(text)) {
    return null;
  }
  const url = text.match(/^https?:\/\/([^/?#]+)/i);
  if (url) {
    if (url[1].includes('@')) {
      return null; // credentials would end up in the logs
    }
    text = url[1].replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  }
  let host = text;
  let port = DEFAULT_PORT;
  const bracketed = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  const withPort = text.match(/^([^:]+):(\d{1,5})$/);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] ? Number(bracketed[2]) : DEFAULT_PORT;
  } else if (withPort) {
    host = withPort[1];
    port = Number(withPort[2]);
  }
  if (port < 1 || port > 65535) {
    return null;
  }
  if (host.includes(':')) {
    return IPV6.test(host) ? { host, port } : null;
  }
  return HOST_NAME.test(host) ? { host, port } : null;
}

/** The address shown to the user. */
export const addressOf = (bmc) =>
  bmc.port === DEFAULT_PORT
    ? bmc.host
    : `${bmc.host.includes(':') ? `[${bmc.host}]` : bmc.host}:${bmc.port}`;

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const flag = (key) => source[key] === true || source[key] === 'true';
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const bmcs = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`bmc_${slot}_host`);
    if (!typed) {
      continue;
    }
    const address = parseBmcHost(typed);
    // A control character would break the ipmitool arguments.
    const username = text(`bmc_${slot}_username`);
    if (!address || /\p{Cc}/u.test(username)) {
      invalid.push(slot);
      continue;
    }
    // A pasted password often carries a trailing new line; spaces inside are kept.
    const password =
      typeof source[`bmc_${slot}_password`] === 'string'
        ? source[`bmc_${slot}_password`].replace(/^[\r\n]+|[\r\n]+$/g, '')
        : '';
    bmcs.push({
      slot,
      ...address,
      username,
      password,
      name: text(`bmc_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    bmcs,
    invalidSlots: invalid,
    iface: pick('interface', INTERFACES),
    allowPowerControl: flag('allow_power_control'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
