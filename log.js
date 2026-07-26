// Leaf logging module. Kept dependency-free so every other module can import it
// without creating import cycles.

// Log-level priorities (lower number = more severe). 'essential' and 'error'
// rank at/below the minimum DEBUG_LEVEL threshold, so they always surface.
const LOG_LEVELS = { essential: -1, error: 0, warn: 1, info: 2, verbose: 3 };

function debug(message, level = 'info', data = null) {
    // Gate on DEBUG_LEVEL before doing any formatting work.
    const threshold = LOG_LEVELS[process.env.DEBUG_LEVEL] ?? LOG_LEVELS.info;
    const priority = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    if (priority > threshold) {
        return;
    }

    const logMessage = `[${new Date().toISOString()}] ${message}`;
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data !== null && data !== undefined) {
        logFn(logMessage, data);
    } else {
        logFn(logMessage);
    }
}

export { debug };
