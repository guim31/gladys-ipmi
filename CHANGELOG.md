# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per server, read over IPMI with `ipmitool` (IPMI 2.0 `lanplus`,
  or IPMI 1.5 `lan`): power, health (chassis faults and sensors out of their
  thresholds), power draw (DCMI or a Watts sensor), intake, processor and
  highest temperatures, mean fan speed, sensors out of range. Up to three BMCs
  (Dell iDRAC, HP iLO, Supermicro, ASRock Rack…).
- Power control, off by default, from the widget buttons and the scene action
  only: power on and soft shutdown (ACPI), never a hard power off; forced
  restart and power cycle from the scene action. The power feature stays
  read-only, out of reach of voice assistants.
- Dashboard widget "Servers (IPMI)": one row per server, or one server in
  detail with its tiles, the sensors out of range and its power button.
- Scene triggers: sensor out of range (with a severity filter), new system
  event log (SEL) entry, server powered on, server powered off.
- Scene actions: state of a server (figures and a ready-made summary), power
  command (on, soft shutdown, forced restart, power cycle).
- "Test the connection" action, and the reason of a failure in the status of
  the integration (does not answer, password refused, missing privilege).
- English, French, German and Spanish, documentation included.
