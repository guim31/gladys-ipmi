// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, health words, the "Test the connection" report,
// scene event variables, scene action outputs and errors. Four languages, the
// four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ipmi/parse.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noBmc: {
    en: 'Enter the address of a BMC (iDRAC, iLO, Supermicro…) in the configuration.',
    fr: "Saisissez l'adresse d'un BMC (iDRAC, iLO, Supermicro…) dans la configuration.",
    de: 'Gib die Adresse eines BMC (iDRAC, iLO, Supermicro …) in der Konfiguration ein.',
    es: 'Introduzca la dirección de un BMC (iDRAC, iLO, Supermicro…) en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.30 or idrac.lan:623',
    fr: 'Adresse incomprise, ex. 192.168.1.30 ou idrac.lan:623',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.30 oder idrac.lan:623',
    es: 'Dirección no válida, p. ej. 192.168.1.30 o idrac.lan:623',
  },
};

// One short explanation per error kind (src/ipmi/parse.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused',
    fr: "nom d'utilisateur ou mot de passe refusé",
    de: 'Benutzername oder Passwort abgelehnt',
    es: 'nombre de usuario o contraseña rechazados',
  },
  [ERROR_KINDS.PRIVILEGE]: {
    en: 'the account lacks the privilege',
    fr: "le compte n'a pas le privilège nécessaire",
    de: 'dem Konto fehlt die Berechtigung',
    es: 'la cuenta no tiene el privilegio necesario',
  },
  [ERROR_KINDS.NO_TOOL]: {
    en: 'ipmitool is missing from the image',
    fr: "ipmitool est absent de l'image",
    de: 'ipmitool fehlt im Image',
    es: 'falta ipmitool en la imagen',
  },
  [ERROR_KINDS.FAILED]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// Health words: the text feature, widget, scenes.
export const HEALTH_TEXT = {
  OK: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  Warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  Critical: { en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítico' },
};

export const POWER_TEXT = {
  on: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
};

// Errors of the commands (switch, widget buttons, scene action).
export const ACTION_TEXT = {
  noBmc: CONNECTION_TEXT.noBmc,
  unknownServer: {
    en: 'This server is not one of the integration (choose it again in the scene).',
    fr: "Ce serveur n'appartient pas à l'intégration (choisissez-le de nouveau dans la scène).",
    de: 'Dieser Server gehört nicht zur Integration (wähle ihn in der Szene erneut aus).',
    es: 'Este servidor no pertenece a la integración (elíjalo de nuevo en la escena).',
  },
  controlDisabled: {
    en: 'Power control is off: tick "Allow power control" in the configuration.',
    fr: "Le pilotage est désactivé : cochez « Autoriser le pilotage de l'alimentation » dans la configuration.",
    de: 'Die Steuerung ist aus: Aktiviere „Stromsteuerung erlauben“ in der Konfiguration.',
    es: 'El control está desactivado: marque «Permitir el control de la alimentación» en la configuración.',
  },
  serverOff: {
    en: 'The server is off: power it on first.',
    fr: "Le serveur est éteint : allumez-le d'abord.",
    de: 'Der Server ist aus: Schalte ihn zuerst ein.',
    es: 'El servidor está apagado: enciéndalo primero.',
  },
  privilege: {
    en: 'The BMC refused the command: the account needs the Operator privilege.',
    fr: 'Le BMC a refusé la commande : le compte doit avoir le privilège Opérateur.',
    de: 'Der BMC hat den Befehl abgelehnt: Das Konto braucht die Berechtigung Operator.',
    es: 'El BMC ha rechazado el comando: la cuenta necesita el privilegio Operador.',
  },
  failed: {
    en: 'The BMC refused the command, see the integration logs.',
    fr: "Le BMC a refusé la commande, voir les logs de l'intégration.",
    de: 'Der BMC hat den Befehl abgelehnt, sieh in den Protokollen der Integration nach.',
    es: 'El BMC ha rechazado el comando, consulte los registros de la integración.',
  },
  notFromSwitch: {
    en: 'Power control goes through the widget buttons or the scene action, never a switch.',
    fr: "Le pilotage passe par les boutons du widget ou l'action de scène, jamais par un interrupteur.",
    de: 'Die Stromsteuerung läuft über die Widget-Tasten oder die Szenen-Aktion, nie über einen Schalter.',
    es: 'El control de la alimentación se hace con los botones del widget o la acción de escena, nunca con un interruptor.',
  },
  unknownCommand: {
    en: 'Unknown command.',
    fr: 'Commande inconnue.',
    de: 'Unbekannter Befehl.',
    es: 'Comando desconocido.',
  },
};

// What a command sent, for the widget toast.
export const COMMAND_TEXT = {
  on: {
    en: 'Power on requested.',
    fr: 'Allumage demandé.',
    de: 'Einschalten angefordert.',
    es: 'Encendido solicitado.',
  },
  shutdown: {
    en: 'Clean shutdown requested.',
    fr: 'Arrêt propre demandé.',
    de: 'Sauberes Herunterfahren angefordert.',
    es: 'Apagado ordenado solicitado.',
  },
  force_restart: {
    en: 'Forced restart requested.',
    fr: 'Redémarrage forcé demandé.',
    de: 'Erzwungener Neustart angefordert.',
    es: 'Reinicio forzado solicitado.',
  },
  power_cycle: {
    en: 'Power cycle requested.',
    fr: 'Cycle d’alimentation demandé.',
    de: 'Aus- und Einschalten angefordert.',
    es: 'Ciclo de alimentación solicitado.',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    sensors: (count) => `${count} sensor(s)`,
    dcmi: 'DCMI power reading',
    control: (on) => (on ? 'power control allowed' : 'power control off'),
  },
  fr: {
    ok: 'OK',
    sensors: (count) => `${count} capteur(s)`,
    dcmi: 'mesure de puissance DCMI',
    control: (on) => (on ? 'pilotage autorisé' : 'pilotage désactivé'),
  },
  de: {
    ok: 'OK',
    sensors: (count) => `${count} Sensor(en)`,
    dcmi: 'DCMI-Leistungsmessung',
    control: (on) => (on ? 'Stromsteuerung erlaubt' : 'Stromsteuerung aus'),
  },
  es: {
    ok: 'OK',
    sensors: (count) => `${count} sensor(es)`,
    dcmi: 'medición de potencia DCMI',
    control: (on) => (on ? 'control permitido' : 'control desactivado'),
  },
};

export const SUMMARY_TEXT = {
  en: {
    unreachable: 'BMC unreachable',
    health: 'health',
    intake: 'intake',
    cpu: 'CPU',
    fans: 'fans',
    alerts: (count) => `${count} sensor(s) out of range`,
  },
  fr: {
    unreachable: 'BMC injoignable',
    health: 'santé',
    intake: 'entrée',
    cpu: 'processeur',
    fans: 'ventilateurs',
    alerts: (count) => `${count} capteur(s) hors seuil`,
  },
  de: {
    unreachable: 'BMC nicht erreichbar',
    health: 'Zustand',
    intake: 'Zuluft',
    cpu: 'Prozessor',
    fans: 'Lüfter',
    alerts: (count) => `${count} Sensor(en) außerhalb der Grenzwerte`,
  },
  es: {
    unreachable: 'BMC inaccesible',
    health: 'estado',
    intake: 'entrada',
    cpu: 'procesador',
    fans: 'ventiladores',
    alerts: (count) => `${count} sensor(es) fuera de umbral`,
  },
};

export const UNIT_TEXT = {
  rpm: { en: 'rpm', fr: 'tr/min', de: 'U/min', es: 'rpm' },
};

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (text, language) => (text ? (text[language] ?? text.en) : '');

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

export function formatNumber(value, language, digits = 0) {
  return new Intl.NumberFormat(LOCALES[language] ?? 'en-GB', {
    maximumFractionDigits: digits,
  }).format(value);
}

export const formatCelsius = (value, language) => `${formatNumber(value, language)} °C`;

export const formatWatts = (value, language) => `${formatNumber(value, language)} W`;

/** A fan speed in its unit. */
export function formatFans(fans, language) {
  return fans.unit === 'percent'
    ? `${formatNumber(fans.speed, language)} %`
    : `${formatNumber(fans.speed, language)} ${pick(UNIT_TEXT.rpm, language)}`;
}

const SENSOR_UNITS = { celsius: '°C', rpm: 'RPM', watts: 'W', volts: 'V', amps: 'A', percent: '%' };

/** The reading of a sensor in an alert: "92 °C", "900 RPM", or its discrete state. */
export function formatReading(alert, language) {
  if (alert.value === null || alert.value === undefined) {
    return String(alert.text ?? '').slice(0, 200);
  }
  return `${formatNumber(alert.value, language, 2)} ${SENSOR_UNITS[alert.unit] ?? ''}`.trim();
}
