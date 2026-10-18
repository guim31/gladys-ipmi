// -----------------------------------------------------------------------------
// An in-memory BMC behind a fake ipmitool: the `run` seam of the client
// (src/ipmi/runner.js) answers from the outputs captured on the OpenIPMI
// simulator (test/fixtures/ipmitool/) or the Dell-shaped ones, and records
// every call, so the tests can check what was sent — and that the password
// never is on the command line.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const USERNAME = 'gladys';
export const PASSWORD = 'test-bmc-password';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/ipmitool/${name}`, import.meta.url), 'utf8');

const SESSION_FAILED = 'Error: Unable to establish IPMI v2 / RMCP+ session\n';

export class FakeBmc {
  /**
   * @param {object} [options]
   * @param {'sim'|'dell'} [options.shape] which fixtures to serve
   */
  constructor({ shape = 'sim' } = {}) {
    this.shape = shape;
    this.on = true;
    this.sdr =
      shape === 'dell' ? fixture('dell-shaped/sdr-elist.txt') : fixture('sdr-elist-ok.txt');
    this.dcmi = shape === 'dell' ? fixture('dell-shaped/dcmi-power-reading.txt') : null;
    this.fru = shape === 'dell' ? fixture('dell-shaped/fru-print-0.txt') : null;
    this.mc = shape === 'dell' ? fixture('dell-shaped/mc-info.txt') : null;
    /** SEL lines, oldest first, in the format of `sel elist`. */
    this.sel = shape === 'dell' ? fixture('dell-shaped/sel-elist.txt').trim().split('\n') : [];
    this.selAddedAt = shape === 'dell' ? '10/18/2026 06:03:11' : null;
    this.password = PASSWORD;
    this.username = USERNAME;
    this.reachable = true;
    // The privilege of the account: USER refuses the power commands.
    this.privilege = 'ADMINISTRATOR';
    /** @type {Array<{ args: string[], env: string }>} */
    this.calls = [];
    this.powerActions = [];
  }

  setSensors(text) {
    this.sdr = text;
  }

  addSelEntry(line, at) {
    this.sel.push(line);
    this.selAddedAt = at;
  }

  chassisStatus() {
    return fixture(this.on ? 'chassis-status-on.txt' : 'chassis-status-off.txt');
  }

  /** What ipmitool would answer to `args`. */
  handle(args, { password }) {
    this.calls.push({ args, password });
    const verbose = args.includes('-v');
    if (!this.reachable) {
      return fail(verbose ? fixture('error-unreachable.stderr.txt') : SESSION_FAILED);
    }
    const user = args.includes('-U') ? args[args.indexOf('-U') + 1] : '';
    if (user !== this.username) {
      return fail(verbose ? fixture('error-user.stderr.txt') : SESSION_FAILED);
    }
    if (password !== this.password) {
      return fail(verbose ? fixture('error-password.stderr.txt') : SESSION_FAILED);
    }
    const command = commandOf(args);
    const text = command.join(' ');
    if (text === 'chassis status') {
      return ok(this.chassisStatus());
    }
    if (text.startsWith('sdr dump ')) {
      return ok(`Dumping Sensor Data Repository to '${command[2]}'\n`);
    }
    if (text === 'sdr elist') {
      return ok(this.on ? this.sdr : this.sdr.replace(/\d+ degrees C/g, 'No Reading'));
    }
    if (text === 'dcmi power reading') {
      return this.dcmi ? ok(this.dcmi) : fail(fixture('dcmi-unsupported.stderr.txt'));
    }
    if (text === 'fru print 0') {
      return this.fru ? ok(this.fru) : fail('', fixture('fru-none.txt'));
    }
    if (text === 'mc info') {
      return this.mc ? ok(this.mc) : fail('Get Device ID command failed\n');
    }
    if (text === 'sel info') {
      return ok(
        `SEL Information\nEntries          : ${this.sel.length}\n` +
          `Last Add Time    : ${this.selAddedAt ?? 'Not Available'}\n`,
      );
    }
    if (text.startsWith('sel elist last ')) {
      const count = Number(command[3]);
      return ok(`${this.sel.slice(-count).join('\n')}\n`);
    }
    const power = text.match(/^chassis power (on|soft|reset|cycle|off)$/);
    if (power) {
      const level = args[args.indexOf('-L') + 1];
      if (this.privilege === 'USER' || level === 'USER') {
        return fail(fixture('error-privilege.stderr.txt'));
      }
      this.powerActions.push(power[1]);
      if (power[1] === 'on') {
        this.on = true;
      } else if (power[1] === 'soft' || power[1] === 'off') {
        this.on = false;
      }
      return ok(`Chassis Power Control: ${power[1]}\n`);
    }
    return fail(`Invalid command: ${text}\n`);
  }
}

const ok = (stdout) => ({ code: 0, stdout, stderr: '', timedOut: false, missing: false });
const fail = (stderr, stdout = '') => ({
  code: 1,
  stdout,
  stderr,
  timedOut: false,
  missing: false,
});

/** The ipmitool command after the global options. */
export function commandOf(args) {
  const withValue = new Set(['-I', '-H', '-p', '-U', '-L', '-N', '-R', '-S', '-C']);
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    index += withValue.has(args[index]) ? 2 : 1;
  }
  return args.slice(index);
}

/**
 * The `run` seam for several BMCs, by host.
 * @param {Record<string, FakeBmc>} bmcs
 */
export function createIpmiNetwork(bmcs) {
  return {
    bmcs,
    run: async (args, options) => {
      const host = args[args.indexOf('-H') + 1];
      const bmc = bmcs[host];
      if (!bmc) {
        return fail(args.includes('-v') ? fixture('error-unreachable.stderr.txt') : SESSION_FAILED);
      }
      return bmc.handle(args, options);
    },
  };
}
