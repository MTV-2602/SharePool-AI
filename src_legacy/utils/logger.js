// src/utils/logger.js — Structured, color-coded logger
'use strict';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_LEVEL = process.env.NODE_ENV === 'production' ? LEVELS.INFO : LEVELS.DEBUG;

const COLORS = {
  DEBUG: '\x1b[90m',  // gray
  INFO:  '\x1b[36m',  // cyan
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
  RESET: '\x1b[0m',
  DIM:   '\x1b[2m',
};

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function formatArgs(args) {
  return args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
}

function log(level, module, args) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const color = COLORS[level];
  const prefix = module ? `${COLORS.DIM}[${module}]${COLORS.RESET} ` : '';
  const ts = `${COLORS.DIM}${timestamp()}${COLORS.RESET}`;
  const lvl = `${color}${level.padEnd(5)}${COLORS.RESET}`;
  console.log(`${ts} ${lvl} ${prefix}${formatArgs(args)}`);
}

/**
 * Create a named logger instance
 * @param {string} module — module name shown in brackets
 */
function create(module) {
  return {
    debug: (...args) => log('DEBUG', module, args),
    info:  (...args) => log('INFO',  module, args),
    warn:  (...args) => log('WARN',  module, args),
    error: (...args) => log('ERROR', module, args),
  };
}

// Default global logger
const defaultLogger = create('');

module.exports = { create, ...defaultLogger };
