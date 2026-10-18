// -----------------------------------------------------------------------------
// From what the client read (src/ipmi/client.js) to the few figures the
// integration shows: power state, health, power drawn, intake, processor and
// highest temperatures, fans, and the sensors out of their thresholds.
//
// Sensor names are free text, chosen by each vendor ("Inlet Temp" on a Dell,
// "System Temp" and "CPU1 Temp" on a Supermicro, "01-Inlet Ambient" on an HP):
// the IPMI entity id comes first when it says something (3 processor,
// 55 and 64 air inlet, 29 fan), the name otherwise. Frozen by the tests.
// -----------------------------------------------------------------------------

const HEALTH_ORDER = { OK: 0, Warning: 1, Critical: 2 };

export const healthRank = (health) => HEALTH_ORDER[health] ?? -1;

/** The worst of several healths, null when none is known. */
export function worstHealth(values) {
  let worst = null;
  for (const value of values) {
    if (value in HEALTH_ORDER && (worst === null || HEALTH_ORDER[value] > HEALTH_ORDER[worst])) {
      worst = value;
    }
  }
  return worst;
}

// Chassis faults: the power ones stop the server, the others warn.
const FAULT_HEALTH = {
  power_overload: 'Critical',
  main_power_fault: 'Critical',
  power_control_fault: 'Critical',
  drive_fault: 'Warning',
  cooling_fault: 'Warning',
};

const ENTITY = { PROCESSOR: 3, FAN: 29, AIR_INLET: [55, 64] };

const INTAKE = /inlet|intake|ambient|ambiant|\bamb\b|front panel/i;
const PROCESSOR = /\bcpu|proc/i;
// Not the air: a sensor named like a margin or a delta to a limit.
const NOT_A_TEMPERATURE = /margin|delta|dts|tcontrol|\bdiff/i;
const TOTAL_POWER = /consum|total|system|input power|pwr/i;

const isIntake = (sensor) => ENTITY.AIR_INLET.includes(sensor.entity) || INTAKE.test(sensor.name);
const isProcessor = (sensor) =>
  !isIntake(sensor) && (sensor.entity === ENTITY.PROCESSOR || PROCESSOR.test(sensor.name));

const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** The power drawn: DCMI first, a Watts sensor otherwise. */
function powerDraw(dcmiWatts, sensors) {
  if (dcmiWatts !== null && dcmiWatts !== undefined) {
    return dcmiWatts;
  }
  const watts = sensors.filter((sensor) => sensor.unit === 'watts' && sensor.value !== null);
  if (watts.length === 0) {
    return null;
  }
  const total = watts.find((sensor) => /consum|total|system/i.test(sensor.name));
  if (total) {
    return total.value;
  }
  // One input sensor per power supply (Supermicro "PS1 Input Power"): their sum.
  const inputs = watts.filter((sensor) => /input|\bin\b/i.test(sensor.name));
  if (inputs.length > 0) {
    return inputs.reduce((sum, sensor) => sum + sensor.value, 0);
  }
  return watts.find((sensor) => TOTAL_POWER.test(sensor.name))?.value ?? watts[0].value;
}

/**
 * The fans: their mean speed (in the unit most of them report), how many
 * there are and how many are out of their thresholds.
 */
function summarizeFans(sensors) {
  const fans = sensors.filter(
    (sensor) =>
      (sensor.unit === 'rpm' || sensor.unit === 'percent') &&
      (sensor.entity === ENTITY.FAN || /fan/i.test(sensor.name)),
  );
  if (fans.length === 0) {
    return null;
  }
  const rpm = fans.filter((fan) => fan.unit === 'rpm');
  const percent = fans.filter((fan) => fan.unit === 'percent');
  const unit = rpm.length >= percent.length ? 'rpm' : 'percent';
  const chosen = unit === 'rpm' ? rpm : percent;
  return {
    speed: mean(chosen.map((fan) => fan.value)),
    unit,
    count: fans.length,
    failed: fans.filter((fan) => fan.severity === 'Warning' || fan.severity === 'Critical').length,
  };
}

/** Out of their thresholds, or in a failed state: worst first. */
export function alertsOf(sensors) {
  return sensors
    .filter((sensor) => sensor.severity === 'Warning' || sensor.severity === 'Critical')
    .map((sensor) => ({
      name: sensor.name,
      number: sensor.number,
      severity: sensor.severity,
      value: sensor.value,
      unit: sensor.unit,
      text: sensor.text,
    }))
    .sort((a, b) => healthRank(b.severity) - healthRank(a.severity));
}

/**
 * The figures of a server.
 * @param {object} raw what IpmiClient.read() returns
 */
export function parseServer(raw) {
  const sensors = raw.sensors ?? [];
  const temperatures = sensors.filter(
    (sensor) =>
      sensor.unit === 'celsius' && sensor.value !== null && !NOT_A_TEMPERATURE.test(sensor.name),
  );
  const intake = temperatures.find(isIntake)?.value ?? null;
  const processors = temperatures.filter(isProcessor).map((sensor) => sensor.value);
  const alerts = alertsOf(sensors);
  const faults = raw.chassis?.faults ?? [];
  const fru = raw.fru ?? {};
  const manufacturer = fru.manufacturer ?? raw.mc?.manufacturer ?? null;
  const health =
    sensors.some((sensor) => sensor.severity !== null) || faults.length > 0
      ? worstHealth([
          'OK',
          ...alerts.map((alert) => alert.severity),
          ...faults.map((fault) => FAULT_HEALTH[fault]),
        ])
      : null;
  return {
    on: raw.chassis?.on ?? null,
    faults,
    health,
    watts: powerDraw(raw.dcmiWatts, sensors),
    intake,
    cpu: processors.length ? Math.max(...processors) : null,
    hottest: temperatures.length ? Math.max(...temperatures.map((sensor) => sensor.value)) : null,
    fans: summarizeFans(sensors),
    alerts,
    sensors: sensors.map(({ name, number, severity }) => ({ name, number, severity })),
    // Sensors with a reading: a server off has fewer.
    sensorCount: sensors.filter((sensor) => sensor.severity !== null).length,
    model: [manufacturer, fru.product].filter(Boolean).join(' ') || null,
    product: fru.product ?? null,
    serial: fru.serial ?? null,
    firmware: raw.mc?.firmware ?? null,
  };
}
