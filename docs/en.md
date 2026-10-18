# IPMI (iDRAC, iLO, Supermicro)

Rack and tower servers have a management controller (BMC) that keeps
watching them, even when they are off: Dell iDRAC, HP iLO, Supermicro,
ASRock Rack, Lenovo IMM, Fujitsu iRMC… Nearly all of them speak **IPMI over
LAN**, the protocol of the older and entry-level ones that homelabs love
(Dell R710, R720, HP DL380 G7, Supermicro X9, X10). This integration reads
it: one device per server with its power state, health, power draw,
temperatures and fans. Scenes can react when a sensor goes out of range, a
new entry appears in the system event log (SEL), or a server is powered on
or off, and a dashboard widget sums your servers up. Power control (on,
soft shutdown) is available, **off by default**. Everything stays on your
local network.

For a recent controller (iDRAC 8 and 9, iLO 4 to 6), the
[Redfish integration](https://github.com/guim31/gladys-redfish) gives the
same device with a richer API; this one is for the controllers that only
speak IPMI, or for those who prefer it.

**Developed without the hardware: feedback welcome.** Tested against the
OpenIPMI BMC simulator (`ipmi_sim`, Docker) with the real `ipmitool`:
sessions, sensors and thresholds, power state, event log, power commands,
wrong password, missing privilege, unreachable BMC. The names of the vendor
sensors come from their documentation. Tell us how it goes on your server
in [the issues](https://github.com/guim31/gladys-ipmi/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A server whose BMC has **IPMI over LAN** enabled: Dell iDRAC 6 to 9, HP
  iLO 2 to 5, Supermicro, ASRock Rack, Lenovo IMM, Fujitsu iRMC, most
  others.
- The BMC reachable from the Gladys machine on UDP port 623.
- An IPMI account on the BMC. The **User** privilege is enough to read;
  power control needs **Operator** (or Administrator).
- Up to three BMCs per installation of the integration.

## Getting started

### 1. Prepare the BMC

- **Enable IPMI over LAN**: off by default on many BMCs. On an iDRAC:
  _iDRAC Settings → Network → IPMI Settings → Enable IPMI Over LAN_. On an
  iLO: _Administration → Access Settings → IPMI/DCMI over LAN_. Supermicro
  and ASRock Rack have it on.
- Create a dedicated account if you can, with the User privilege unless you
  want power control. Its password must hold 20 characters at most (16 for
  IPMI 1.5).
- If `ipmitool` is at hand, check from another machine:
  `ipmitool -I lanplus -H <address> -U <user> -P <password> chassis status`.

### 2. Configure the integration

In the **Configuration** tab of the integration:

- **BMC address**: `192.168.1.30` or `idrac.lan`, with `:port` when it is
  not 623 (`idrac.lan:6230`). An IPv6 address works too.
- **User name** and **Password** of the IPMI account.
- **Name** (optional): shown in the device name, the widget and the
  messages. By default, the product name the BMC gives (`PowerEdge R720`),
  otherwise its address.
- Up to two more BMCs in the next sections.
- **IPMI interface**: IPMI 2.0 (`lanplus`, encrypted), the default, for
  every BMC since about 2008. IPMI 1.5 (`lan`) only for an older BMC that
  refuses IPMI 2.0.
- **Refresh interval**: 30 seconds to 5 minutes (1 minute by default).
- **Allow power control**: see [Power control](#power-control). Off by
  default.
- **Language of the names**: language of the feature names (set when the
  server is added), of the health texts and of the scene results.

Then click **Test the connection**: one line per BMC, with the server
found, the number of sensors and whether it offers the DCMI power reading.

### 3. Add the server

The server appears in the **Discover** tab of the integration: add it. Only
the servers added receive values; the widget and the scene triggers work for
every server, added or not.

## The device

One device per BMC. Only the features the BMC reports are proposed:

| Feature               | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Power                 | On or off. Always read-only (see Power control)                     |
| Health                | OK, Warning or Critical: chassis faults and sensors out of range    |
| Power draw            | Watts drawn by the server (DCMI power reading, or a Watts sensor)   |
| Intake temperature    | Air entering the server, in °C                                      |
| Processor temperature | The hottest processor, in °C                                        |
| Highest temperature   | The hottest of all the temperature sensors, in °C                   |
| Fans (rpm) / Fans (%) | The mean speed of the fans, in the unit of the BMC                  |
| Sensors out of range  | How many sensors are past a threshold or in a failed state; 0 is OK |

The device also shows the serial number and the BMC firmware in its
parameters. When the BMC does not answer, the device shows the
"unreachable" badge and the status under the integration name says why.

A sensor is **out of range** when the BMC says it crossed one of its
thresholds (non-critical: Warning; critical or non-recoverable: Critical),
or when a discrete sensor reports a failure ("Failure detected", "AC lost",
"Redundancy Lost"…). The thresholds are the ones of the BMC: the integration
adds none.

## Dashboard

The **Servers (IPMI)** widget has two modes:

- **without a server chosen**: one line per server, on or off, health and
  power draw, in orange or red when something is wrong;
- **with a server chosen**: its power draw, intake and highest
  temperatures as tiles, then its power, health, fans and the sensors out of
  range. When power control is allowed, the **Shut down** button (server on)
  or **Power on** (server off) appears, asking for a confirmation.

**Refresh** reads the BMCs again.

## Scenes

### Triggers

- **Sensor out of range**: a sensor crosses a threshold or reports a
  failure, or goes from Warning to Critical. It can be limited to one
  server and to one severity (Warning or Critical). Variables: server,
  sensor, reading, severity. At most five per server and per read; a sensor that swings around its threshold is announced again only after 30 minutes, unless it gets worse.
- **New system event log entry**: a new entry in the SEL of a server (a
  threshold crossed, a power supply lost, a memory error, the chassis
  opened…). Checked at every read, at most once a minute; at most three per
  read. Variables: server, message, date.
- **Server powered on** and **Server powered off**: whatever the cause
  (button, BMC, power cut). Variable: server.

Each trigger can be limited to one server. The first read after the
installation only records the states: nothing is announced for a sensor or
an entry that was already there.

### Actions

- **State of a server**: reads a server and gives the next actions its
  name, whether the BMC answers, power, health, power draw, temperatures,
  fan speed, the sensors out of range, and a summary ready to send ("r720:
  on, health OK, 172 W, intake 23 °C…").
- **Power command**: power on, soft shutdown (ACPI), forced restart (reset)
  or power cycle of a server. Needs **Allow power control**.

### Scene ideas

- When a **Sensor out of range** of severity Critical fires, send its
  sensor and reading on Telegram.
- At 1 a.m., if nobody is home, **Power command** "Soft shutdown (ACPI)" on
  the lab server; at 7 a.m., "Power on".
- When a **New system event log entry** appears on the NAS server, notify
  with its message.

## Power control

Off by default. Once **Allow power control** is ticked, the widget shows the
**Shut down** button (server on) or **Power on** (server off), each asking
for a confirmation, and the **Power command** scene action is accepted.

**The Power feature stays read-only**, even with power control allowed: a
voice assistant ("turn everything off") must never shut a server down.

- **Power on** sends `chassis power on`.
- **Shut down** sends a **soft shutdown** (`chassis power soft`: the BMC
  presses the power button briefly, the operating system shuts down
  cleanly, provided it handles ACPI). **Never a hard power off**.
- The forced restart (`chassis power reset`) and the power cycle
  (`chassis power cycle`, off then on) are only in the **Power command**
  scene action, chosen explicitly, and refused on a server that is off.

The power state is read again just before each command: nothing is sent
when the server is already in the asked state. The server is read again
15 seconds after the command, then at the usual interval.

## Troubleshooting

- **"does not answer"**: check the address, that IPMI over LAN is enabled
  on the BMC, and that UDP port 623 is reachable from the Gladys machine
  (another VLAN, a firewall?). A BMC behind NAT needs its port forwarded.
- **"user name or password refused"**: check the account in the web
  interface of the BMC, and that it is enabled for IPMI. Some BMCs lock an
  account after a few failures.
- **"the account lacks the privilege"**: give the account the User
  privilege at least (Operator for power control) on the LAN channel.
- **Nothing with IPMI 2.0 on an old BMC**: try the **IPMI interface**
  "IPMI 1.5 (lan)".
- **A missing feature**: the BMC does not report it (no inlet sensor, no
  DCMI and no Watts sensor, processor sensors only readable when the server
  is on).
- **A command refused**: the account lacks the Operator privilege.

## Limits

- Developed without the hardware: tested against the OpenIPMI simulator,
  and the vendor sensor names come from documentation, not yet from real
  servers.
- Sensor names are free text chosen by each vendor: the intake and processor
  temperatures are found by their IPMI entity, then by their name. A server
  that names them otherwise shows them in the highest temperature only.
- The SEL is read by its last 20 entries when it changed; walking a long SEL
  takes a few seconds on some BMCs.
- No graceful restart: IPMI has none. Use a soft shutdown, then power on.
- IPMI 2.0 sends the password hashed, never in clear, but the protocol is
  old: keep the BMCs on a network of their own.

## Credits

The integration drives [ipmitool](https://github.com/ipmitool/ipmitool)
(BSD 3-Clause), installed in its image. The tests replay outputs captured
from the [OpenIPMI](https://github.com/cminyard/openipmi) simulator
(LGPL/GPL, used for testing only, not shipped). IPMI is a specification of
Intel, HP, NEC and Dell. This integration is not affiliated with Dell, HP,
HPE, Supermicro, ASRock Rack, Lenovo, Fujitsu or Intel.
