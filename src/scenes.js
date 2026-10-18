// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "State of a server" is what a condition on the device features cannot do:
// put the state of a server in a message ("r720: on, health Warning, 192 W,
// intake 22 °C…, Fan1 RPM 900 RPM"), with every figure as an output too. It
// reads the BMC again when the last read is older than 15 seconds. An
// unreachable BMC is an answer, not a failure: `online` false, and the
// summary says so.
//
// "Power command" sends on, soft shutdown, forced restart or power cycle,
// only when "Allow power control" is ticked. Never a hard power off.
// -----------------------------------------------------------------------------

import { COMMANDS } from './hub.js';
import {
  ACTION_TEXT,
  ERROR_TEXT,
  HEALTH_TEXT,
  POWER_TEXT,
  SUMMARY_TEXT,
  formatCelsius,
  formatFans,
  formatReading,
  formatWatts,
  labelled,
  pick,
} from './texts.js';

// Sensors named in a summary, at most.
const MAX_NAMED_ALERTS = 3;

/** "CPU1 Temp 92 °C, Fan1 RPM 900 RPM". */
export function describeAlerts(alerts, language, max = MAX_NAMED_ALERTS) {
  return alerts
    .slice(0, max)
    .map((alert) => `${alert.name} ${formatReading(alert, language)}`.trim())
    .join(', ');
}

/** The one-line state of a server, in the configured language. */
export function summarize(view, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  if (!view.online) {
    const reason = view.error ? pick(ERROR_TEXT[view.error.kind], language) : text.unreachable;
    return labelled(view.name, reason, language);
  }
  const { server } = view;
  const parts = [];
  if (server.on !== null) {
    parts.push(pick(server.on ? POWER_TEXT.on : POWER_TEXT.off, language).toLowerCase());
  }
  if (server.health) {
    parts.push(`${text.health} ${pick(HEALTH_TEXT[server.health], language)}`);
  }
  if (server.watts !== null) {
    parts.push(formatWatts(server.watts, language));
  }
  if (server.intake !== null) {
    parts.push(`${text.intake} ${formatCelsius(server.intake, language)}`);
  }
  if (server.cpu !== null) {
    parts.push(`${text.cpu} ${formatCelsius(server.cpu, language)}`);
  }
  if (server.fans?.speed !== null && server.fans?.speed !== undefined) {
    parts.push(`${text.fans} ${formatFans(server.fans, language)}`);
  }
  if (server.alerts.length > 0) {
    parts.push(`${text.alerts(server.alerts.length)} (${describeAlerts(server.alerts, language)})`);
  }
  return labelled(view.name, parts.join(', '), language);
}

/** The server of a scene field, read again when stale. */
async function serverOf(hub, fields) {
  hub.assertReadable();
  const found = hub.find(fields.server);
  if (!found) {
    throw new Error(pick(ACTION_TEXT.unknownServer, hub.config.language));
  }
  await hub.refreshIfStale([found.record]);
  // Read again: the BMC may have been reconfigured meanwhile.
  return hub.find(fields.server) ?? found;
}

export const SCENE_ACTIONS = {
  async get_server_status(hub, { fields = {} }) {
    const language = hub.config?.language;
    const found = await serverOf(hub, fields);
    const view = hub.view(found.record);
    const outputs = { name: view.name, online: view.online, summary: summarize(view, language) };
    if (!view.online) {
      return outputs;
    }
    const { server } = view;
    const set = (key, value) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        outputs[key] = Math.round(value);
      }
    };
    if (server.on !== null) {
      outputs.power_on = server.on;
    }
    if (server.health) {
      outputs.health = pick(HEALTH_TEXT[server.health], language);
    }
    set('power_watts', server.watts);
    set('intake_temperature', server.intake);
    set('cpu_temperature', server.cpu);
    set('max_temperature', server.hottest);
    set('fan_speed', server.fans?.speed);
    outputs.sensors_out_of_range = server.alerts.length;
    outputs.alerts = describeAlerts(server.alerts, language, 10);
    return outputs;
  },

  async power_command(hub, { fields = {} }) {
    const language = hub.config?.language;
    if (!Object.values(COMMANDS).includes(fields.command)) {
      throw new Error(pick(ACTION_TEXT.unknownCommand, language));
    }
    const found = await serverOf(hub, fields);
    const sent = await hub.command(found.record, fields.command);
    return { ipmi_action: sent ?? '' };
  },
};
