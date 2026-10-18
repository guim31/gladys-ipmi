// -----------------------------------------------------------------------------
// IPMI client of one BMC, over ipmitool (src/ipmi/runner.js): one command at
// a time (a BMC is a small chip with few sessions), reads at the USER
// privilege level (a read-only account is enough), power commands at the
// OPERATOR level.
//
// A read is three commands: `chassis status`, `sdr elist` and, when the BMC
// supports DCMI, `dcmi power reading`. The sensor descriptions (SDR) are
// dumped once an hour into a cache file under /tmp (a tmpfs in the Gladys
// sandbox) and given to ipmitool with -S: without it, every read would fetch
// the whole repository again, hundreds of requests on a big server.
// -----------------------------------------------------------------------------

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
} from './parse.js';
import { runIpmitool } from './runner.js';

export { ERROR_KINDS };

export const CLIENT_TIMINGS = {
  // The SDR cache, the FRU and the DCMI support are read again this often.
  infoEveryMs: 3600_000,
  callTimeoutMs: 30_000,
  sensorsTimeoutMs: 60_000,
  // Walking a long SEL takes one request per entry.
  selTimeoutMs: 120_000,
};

// SEL entries read when the log changed: the newest ones.
export const SEL_TAIL = 20;

// Power actions of `ipmitool chassis power` the integration may send. Never
// `off` (a hard power cut).
export const POWER_ACTIONS = Object.freeze(['on', 'soft', 'reset', 'cycle']);

// Lines of ipmitool's stderr that are not errors.
const NOISE =
  /Unable to Get Channel Cipher Suites|Get HPM\.x Capabilities|Loading IANA PEN|Running Get VSO|Discovered IPMB|Invalid completion code received: Insufficient privilege level|^\s*$/;

export class IpmiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** The first meaningful line ipmitool printed, for the logs. */
function reason(result) {
  const lines = `${result.stderr}\n${result.stdout}`.split('\n').map((line) => line.trim());
  return (lines.find((line) => !NOISE.test(line)) ?? 'ipmitool failed').slice(0, 200);
}

export class IpmiClient {
  /**
   * @param {object} options
   * @param {number} options.slot configuration slot (names the cache file)
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.username
   * @param {string} options.password
   * @param {'lanplus'|'lan'} options.iface
   * @param {Function} [options.run] seam: runIpmitool
   * @param {string} [options.cacheDir]
   * @param {object} [options.timings]
   * @param {() => number} [options.now]
   */
  constructor({ slot, host, port, username, password, iface, run, cacheDir, timings, now }) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.iface = iface;
    this.run = run ?? runIpmitool;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.cacheFile = join(cacheDir ?? tmpdir(), `gladys-ipmi-sdr-${slot}.cache`);
    this.cacheReady = false;
    this.infoAt = 0;
    this.fru = null;
    this.mc = null;
    /** DCMI power reading: undefined not tried yet, false unsupported. */
    this.dcmi = undefined;
    this.selStamp = null;
    this.chain = Promise.resolve();
    this.closed = false;
  }

  args(privilege, { verbose = false, cache = false } = {}) {
    return [
      ...(verbose ? ['-v'] : []),
      '-I',
      this.iface,
      '-H',
      this.host,
      '-p',
      String(this.port),
      ...(this.username ? ['-U', this.username] : []),
      '-E',
      '-L',
      privilege,
      '-N',
      '3',
      '-R',
      '2',
      ...(cache && this.cacheReady ? ['-S', this.cacheFile] : []),
    ];
  }

  /** One ipmitool command, after the previous one: one session at a time. */
  call(command, options = {}) {
    const next = this.chain.then(() => this.exec(command, options));
    this.chain = next.catch(() => {});
    return next;
  }

  async exec(command, { privilege = 'USER', cache = false, timeoutMs } = {}) {
    const result = await this.run([...this.args(privilege, { cache }), ...command], {
      password: this.password,
      timeoutMs: timeoutMs ?? this.timings.callTimeoutMs,
    });
    if (result.code === 0 && !result.timedOut) {
      return result.stdout;
    }
    throw await this.failure(result);
  }

  async failure(result) {
    if (result.missing) {
      return new IpmiError(ERROR_KINDS.NO_TOOL, 'ipmitool is not installed');
    }
    if (result.timedOut) {
      return new IpmiError(ERROR_KINDS.UNREACHABLE, 'ipmitool timed out');
    }
    const output = `${result.stderr}\n${result.stdout}`;
    let kind = classifyError(output);
    if (kind === null && isSessionFailure(output)) {
      // ipmitool only says why in verbose mode: ask again, once.
      const verbose = await this.run(
        [...this.args('USER', { verbose: true }), 'chassis', 'status'],
        {
          password: this.password,
          timeoutMs: this.timings.callTimeoutMs,
        },
      );
      kind = classifyError(`${verbose.stderr}\n${verbose.stdout}`) ?? ERROR_KINDS.UNREACHABLE;
    }
    return new IpmiError(kind ?? ERROR_KINDS.FAILED, reason(result));
  }

  /** Refresh the SDR cache, the FRU and the DCMI support (hourly). */
  async refreshInfo() {
    this.infoAt = this.now();
    try {
      await this.call(['sdr', 'dump', this.cacheFile], { timeoutMs: this.timings.selTimeoutMs });
      this.cacheReady = true;
    } catch (err) {
      if (err.kind === ERROR_KINDS.UNREACHABLE) {
        throw err;
      }
      // Without cache, `sdr elist` reads the repository each time: slower, same result.
      this.cacheReady = false;
    }
    try {
      this.fru = parseFru(await this.call(['fru', 'print', '0']));
    } catch {
      this.fru = null;
    }
    try {
      this.mc = parseMcInfo(await this.call(['mc', 'info']));
    } catch {
      this.mc = null;
    }
    this.dcmi = undefined;
  }

  /** Forget the hourly information: read it again at the next read. */
  forgetInfo() {
    this.infoAt = 0;
  }

  /**
   * Read the BMC: power state and chassis faults, every sensor, the DCMI power.
   * @returns {Promise<{ chassis: object, sensors: object[], dcmiWatts: number|null, fru: object|null, mc: object|null }>}
   */
  async read() {
    const chassis = parseChassisStatus(await this.call(['chassis', 'status']));
    if (this.infoAt === 0 || this.now() - this.infoAt >= this.timings.infoEveryMs) {
      await this.refreshInfo();
    }
    let sdr;
    try {
      sdr = await this.call(['sdr', 'elist'], {
        cache: true,
        timeoutMs: this.timings.sensorsTimeoutMs,
      });
    } catch (err) {
      if (!this.cacheReady || err.kind !== ERROR_KINDS.FAILED) {
        throw err;
      }
      // A stale or broken cache file: read without, dump again next hour.
      this.cacheReady = false;
      sdr = await this.call(['sdr', 'elist'], { timeoutMs: this.timings.sensorsTimeoutMs });
    }
    let dcmiWatts = null;
    if (this.dcmi !== false) {
      try {
        dcmiWatts = parseDcmiPower(await this.call(['dcmi', 'power', 'reading']));
        this.dcmi = dcmiWatts !== null;
      } catch (err) {
        if (err.kind === ERROR_KINDS.UNREACHABLE) {
          throw err;
        }
        this.dcmi = false;
      }
    }
    return { chassis, sensors: parseSdrList(sdr), dcmiWatts, fru: this.fru, mc: this.mc };
  }

  /**
   * The newest SEL entries, or null when the log did not change since the
   * last call (`sel info` is one request, `sel elist` one per entry).
   */
  async readSel() {
    const info = parseSelInfo(await this.call(['sel', 'info']));
    const stamp = `${info.entries}|${info.lastAdd}`;
    if (stamp === this.selStamp) {
      return null;
    }
    const entries =
      info.entries === 0
        ? []
        : parseSelList(
            await this.call(['sel', 'elist', 'last', String(SEL_TAIL)], {
              cache: true,
              timeoutMs: this.timings.selTimeoutMs,
            }),
          );
    this.selStamp = stamp;
    return entries;
  }

  /** The power state now: one `chassis status`. */
  async powerState() {
    return parseChassisStatus(await this.call(['chassis', 'status'])).on;
  }

  /** `chassis power <action>`, at the OPERATOR level. */
  async power(action) {
    if (!POWER_ACTIONS.includes(action)) {
      throw new IpmiError(ERROR_KINDS.FAILED, `refused power action ${action}`);
    }
    await this.call(['chassis', 'power', action], { privilege: 'OPERATOR' });
  }

  /** Remove the cache file (the configuration changed, or the integration stops). */
  async close() {
    this.closed = true;
    await this.chain;
    await rm(this.cacheFile, { force: true }).catch(() => {});
  }
}
