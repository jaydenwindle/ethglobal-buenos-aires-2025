#ifndef __SDLOG_H__
#define __SDLOG_H__

#include <Arduino.h>
#include <SD.h>
#include <SD_MMC.h>

// Define SD object based on mode
#ifdef USE_SD_MMC
  #define SD_LOG_OBJ SD_MMC
#else
  #define SD_LOG_OBJ SD
#endif

#define SD_LOG_FILE "/log.txt"
#define SD_LOG_MAX_SIZE 102400  // 100KB max log size

class SDLogger {
public:
  static void init();
  static void log(const char* format, ...);
  static void logln(const char* message);
  static void flush();
  static void clear();
  static bool isEnabled();
  
private:
  static bool _enabled;
  static bool _sdAvailable;
  static void checkLogSize();
};

extern SDLogger sdLogger;

// Logging macros that write to both Serial and SD card
#define SD_LOG(...) { Serial.printf(__VA_ARGS__); sdLogger.log(__VA_ARGS__); }
#define SD_LOGLN(x) { Serial.println(x); sdLogger.logln(x); }

#endif // __SDLOG_H__
