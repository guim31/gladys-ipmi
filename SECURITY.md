# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the BMC passwords are `secret` fields of the Gladys
  configuration. The integration reads them from Gladys at startup and keeps
  them in memory. It hands each one to `ipmitool` through the `IPMI_PASSWORD`
  environment variable of the child process (`-E`), never on its command line
  (visible to `ps`), and never writes them to `/data` nor to the logs. IPMI 2.0
  (`lanplus`) authenticates with RAKP: the password does not travel in clear.
  IPMI 1.5 (`lan`), offered for older BMCs, is weaker: keep the BMCs on a
  network of their own.
- **Command line**: the BMC address is checked (host name, IPv4 or IPv6, port)
  before it reaches `ipmitool`, and `ipmitool` is started without a shell.
- **Power control**: off by default. When allowed, the integration only sends
  `chassis power on`, `chassis power soft` (ACPI), and `chassis power reset`
  or `chassis power cycle` from the explicit scene action. Never
  `chassis power off`. Reads need the User privilege only; commands use the
  Operator level.
- **Stored in `/data`**: `ipmi-state.json`, what the scene triggers compare
  with (last power state and sensor severities of each server, the keys of the
  SEL entries already seen). No secret.
- **Stored in `/tmp`** (a tmpfs in the Gladys sandbox): the sensor data
  record cache `ipmitool` dumps for each BMC (sensor names and thresholds). No
  secret; removed when the integration stops.
- **Network**: IPMI over LAN (UDP 623, or the configured port) to the
  configured BMCs only, on the local network. Nothing goes to the Internet.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
`ipmitool`, and the BMCs and their firmware.
