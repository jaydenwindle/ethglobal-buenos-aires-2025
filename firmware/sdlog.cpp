#include "sdlog.h"
#include "serial.h"
#include <stdarg.h>

bool SDLogger::_enabled = false;
bool SDLogger::_sdAvailable = false;

void SDLogger::init() {
  _sdAvailable = false;
  _enabled = false;
  
  // Check if SD card is available
  #ifdef USE_SD_MMC
    if (SD_MMC.cardType() != CARD_NONE) {
      _sdAvailable = true;
    }
  #else
    if (SD.cardType() != CARD_NONE) {
      _sdAvailable = true;
    }
  #endif
  
  if (_sdAvailable) {
    _enabled = true;
    SERIAL_ECHOLN("SD logging enabled -> /log.txt");
    
    // Write startup marker
    File logFile = SD_LOG_OBJ.open(SD_LOG_FILE, FILE_APPEND);
    if (logFile) {
      logFile.println("\n========================================");
      logFile.print("Device started: ");
      logFile.println(millis());
      logFile.println("========================================");
      logFile.close();
    }
    
    checkLogSize();
  } else {
    SERIAL_ECHOLN("SD logging disabled (no SD card)");
  }
}

void SDLogger::log(const char* format, ...) {
  if (!_enabled || !_sdAvailable) return;
  
  char buffer[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  
  File logFile = SD_LOG_OBJ.open(SD_LOG_FILE, FILE_APPEND);
  if (logFile) {
    logFile.print("[");
    logFile.print(millis());
    logFile.print("ms] ");
    logFile.print(buffer);
    logFile.close();
  }
}

void SDLogger::logln(const char* message) {
  if (!_enabled || !_sdAvailable) return;
  
  File logFile = SD_LOG_OBJ.open(SD_LOG_FILE, FILE_APPEND);
  if (logFile) {
    logFile.print("[");
    logFile.print(millis());
    logFile.print("ms] ");
    logFile.println(message);
    logFile.close();
  }
}

void SDLogger::flush() {
  // File is closed after each write, so nothing to flush
}

void SDLogger::clear() {
  if (!_enabled || !_sdAvailable) return;
  
  SD_LOG_OBJ.remove(SD_LOG_FILE);
  SERIAL_ECHOLN("Log file cleared");
  
  // Reinitialize with startup marker
  init();
}

void SDLogger::checkLogSize() {
  if (!_enabled || !_sdAvailable) return;
  
  File logFile = SD_LOG_OBJ.open(SD_LOG_FILE);
  if (logFile) {
    size_t fileSize = logFile.size();
    logFile.close();
    
    // If log file is too large, archive it and start fresh
    if (fileSize > SD_LOG_MAX_SIZE) {
      SERIAL_ECHOLN("Log file too large, archiving...");
      
      // Rename old log to log_old.txt
      SD_LOG_OBJ.remove("/log_old.txt");
      SD_LOG_OBJ.rename(SD_LOG_FILE, "/log_old.txt");
      
      SERIAL_ECHOLN("Log file archived to /log_old.txt");
    }
  }
}

bool SDLogger::isEnabled() {
  return _enabled && _sdAvailable;
}

SDLogger sdLogger;
