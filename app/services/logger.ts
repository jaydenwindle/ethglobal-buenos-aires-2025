export type LogType = "info" | "success" | "error" | "data";

export interface LogEntry {
  timestamp: string;
  type: LogType;
  message: string;
}

type LogListener = (log: LogEntry) => void;

class Logger {
  private listeners: LogListener[] = [];

  addListener(listener: LogListener) {
    this.listeners.push(listener);
  }

  removeListener(listener: LogListener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  log(type: LogType, message: string) {
    const timestamp = new Date().toLocaleTimeString();
    const log: LogEntry = { timestamp, type, message };

    // Also log to console for debugging
    console.log(`[${type.toUpperCase()}] ${message}`);

    // Notify all listeners
    this.listeners.forEach(listener => listener(log));
  }

  info(message: string) {
    this.log("info", message);
  }

  success(message: string) {
    this.log("success", message);
  }

  error(message: string) {
    this.log("error", message);
  }

  data(message: string) {
    this.log("data", message);
  }
}

export const logger = new Logger();
