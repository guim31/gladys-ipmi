// -----------------------------------------------------------------------------
// The one place that starts ipmitool. The password never appears on the
// command line (visible in `ps`): it goes through the IPMI_PASSWORD variable
// of the child process only (`-E`). Every call has a hard time limit.
// The tests replace this function (test/helpers/fakeIpmi.js).
// -----------------------------------------------------------------------------

import { execFile } from 'node:child_process';

export const IPMITOOL = process.env.IPMITOOL_PATH || 'ipmitool';

/**
 * @param {string[]} args the ipmitool arguments, password excluded
 * @param {object} options
 * @param {string} [options.password] sent as IPMI_PASSWORD (with -E in args)
 * @param {number} options.timeoutMs killed past this
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, timedOut: boolean, missing: boolean }>}
 */
export function runIpmitool(args, { password = '', timeoutMs }) {
  return new Promise((resolve) => {
    execFile(
      IPMITOOL,
      args,
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
        // A minimal environment: nothing of the integration leaks to the child.
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: '/tmp',
          // The zone of Gladys (set by its supervisor): the SEL dates in local time.
          ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
          IPMI_PASSWORD: password,
        },
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(err?.killed),
          missing: err?.code === 'ENOENT',
        });
      },
    );
  });
}
