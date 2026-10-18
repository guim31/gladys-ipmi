# IPMI (iDRAC, iLO, Supermicro) for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration that follows
rack and tower servers through their management controller (BMC) and
**IPMI over LAN**: Dell iDRAC 6 to 9, HP iLO 2 to 5, Supermicro, ASRock
Rack, Lenovo IMM, Fujitsu iRMC — the older and entry-level servers of many
homelabs. It complements
[gladys-redfish](https://github.com/guim31/gladys-redfish) (recent BMCs,
Redfish API) with the same device, feature names and widget.

**Developed without the hardware: feedback welcome** in
[the issues](https://github.com/guim31/gladys-ipmi/issues). It was tested
against the OpenIPMI BMC simulator with the real `ipmitool`, not yet on a
real iDRAC, iLO or Supermicro.

## Features

- **One device per server**: power (on/off), health (OK, Warning,
  Critical: chassis faults and sensors out of their thresholds), power draw
  (W, DCMI or a Watts sensor), intake, processor and highest temperatures,
  mean fan speed (rpm or %), number of sensors out of range. Only what the
  BMC reports.
- **Power control, off by default**: once allowed, the power feature becomes
  a switch (on, **soft** shutdown through ACPI — never a hard power off), and
  a scene action can also force a restart or a power cycle.
- **Dashboard widget** "Servers (IPMI)": one line per server, or one server
  in detail with its sensors out of range and its power button (confirmed).
- **Scene triggers**: sensor out of range (filter by severity), new system
  event log (SEL) entry, server powered on, server powered off.
- **Scene actions**: state of a server (figures and a ready-made summary),
  power command (on, soft shutdown, forced restart, power cycle).
- Up to three BMCs; IPMI 2.0 (`lanplus`) or 1.5 (`lan`); reads with the User
  privilege, commands with Operator.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- A BMC with IPMI over LAN enabled, reachable on UDP port 623 from the Gladys
  machine, and an IPMI account on it (User privilege, Operator for power
  control).

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-ipmi`. Fill in the BMC address, user name
and password in the **Configuration** tab, click **Test the connection**,
then add the server from the **Discover** tab.

The full documentation: [English](docs/en.md), [français](docs/fr.md),
[Deutsch](docs/de.md), [español](docs/es.md).

## How it works

The image ships [ipmitool](https://github.com/ipmitool/ipmitool) (Alpine
package). Each BMC is read on its own timer (30 s to 5 min, 1 min by
default), one command at a time: `chassis status`, `sdr elist` and, when the
BMC supports it, `dcmi power reading`. The sensor data records are dumped
once an hour into a cache under `/tmp` and given back with `-S`, so a read
only fetches the readings. The SEL is checked with `sel info`, and its last
entries read only when it changed. The password goes to `ipmitool` through
its environment (`-E`), never its command line. Only the changes are sent to
Gladys, the moving values at most once a minute.

## Checked, and what was not

Checked against the OpenIPMI simulator (`ipmi_sim`, Alpine package
`openipmi-lanserv`) with nine sensors (temperatures with thresholds, fans,
power in Watts, voltage, a power supply), in a container locked like the
Gladys sandbox, with the real `ipmitool` of the image: IPMI 2.0 and 1.5
sessions, readings and threshold crossings, SEL entries, `chassis power`
commands, wrong password, unknown user, missing privilege, unreachable BMC.
The outputs captured there are the test fixtures. The Dell-shaped fixtures
(processor sensors named `Temp`, DCMI, FRU, dated SEL) are written by hand in
the same format. Not yet checked on a real iDRAC, iLO or Supermicro.

## Limitations

- Sensor names differ by vendor: intake and processor temperatures are found
  by their IPMI entity, then by name.
- No graceful restart: IPMI has none (soft shutdown, then power on).
- One server per BMC (no blade chassis with several nodes behind one BMC).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory BMC (`test/helpers/fakeIpmi.js`) answering with the
`ipmitool` outputs of `test/fixtures/ipmitool/`. See [`CLAUDE.md`](CLAUDE.md)
for the project rules.

## Credits

- [ipmitool](https://github.com/ipmitool/ipmitool) (BSD 3-Clause), the IPMI
  client the integration drives.
- [OpenIPMI](https://github.com/cminyard/openipmi) and its `ipmi_sim` BMC
  simulator: the integration was tested against it, and the fixtures were
  captured from it (not shipped).
- The architecture, feature names and widget follow
  [gladys-redfish](https://github.com/guim31/gladys-redfish).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Dell, HP, HPE,
Supermicro, ASRock Rack, Lenovo, Fujitsu or Intel. iDRAC, iLO and the other
names are trademarks of their owners.

## License

Apache-2.0
