# SD Logging Implementation Summary

## Problem Statement
When testing firmware with `esp32_terminal.py` via Bluetooth, the device often disconnects and serial output is lost, making troubleshooting difficult.

## Solution
Implemented automatic logging to SD card (`/log.txt`) that captures all important events with timestamps, allowing post-mortem debugging even when serial connection is lost.

## Files Added

### 1. `firmware/sdlog.h`
Header file defining the SDLogger class and logging macros:
- `SD_LOG(format, ...)` - Log formatted message with timestamp
- `SD_LOGLN(message)` - Log message with newline and timestamp
- `SDLogger` class with init, log, clear, and status methods

### 2. `firmware/sdlog.cpp`
Implementation of SD logging functionality:
- Writes to `/log.txt` on SD card
- Includes millisecond timestamps for each entry
- Automatic log rotation at 100KB (archives to `/log_old.txt`)
- Works with both SD_MMC and SPI modes
- Gracefully handles SD card unavailability

### 3. `firmware/docs/SD_LOGGING.md`
Complete documentation covering:
- How the logging system works
- What events are logged
- Bluetooth commands for log management
- Multiple methods to read logs
- Troubleshooting guide
- Technical implementation details

### 4. `firmware/docs/LOGGING_QUICK_START.md`
Quick reference guide for:
- Fast setup instructions
- Common commands
- Example log output
- Usage tips

## Files Modified

### 1. `firmware/SdWiFiBrowser.ino`
Added logging to:
- Device boot sequence
- Config loading
- Bluetooth initialization
- WiFi enable/disable
- Sleep/wake cycles
- Bluetooth command handling
- AP credential sending
- All major state changes

New Bluetooth commands:
- `LOG STATUS` - Check if logging is enabled
- `LOG CLEAR` - Clear the log file

### 2. `firmware/sdControl.cpp`
Added logging to:
- SD card initialization attempts (success/failure)
- Each retry attempt with attempt number
- Final initialization status

### 3. `firmware/network.cpp`
Added logging to:
- WiFi AP startup
- AP configuration (SSID, password mode)
- AP success/failure with IP address
- WiFi connection attempts
- Connection success/failure
- Already-connected status

### 4. `firmware/README.md`
Added section documenting:
- SD logging feature overview
- Available commands
- How to read logs
- Links to detailed documentation

## Key Features

### Automatic Initialization
- Logger initializes after SD card is ready
- Checks SD card availability
- Writes startup marker to log file
- Gracefully handles missing SD card

### Timestamped Entries
Every log entry includes milliseconds since boot:
```
[12345ms] Device started
[12567ms] Bluetooth initialized: ESP32_Device
```

### Log Rotation
- Maximum file size: 100KB
- Old log automatically renamed to `/log_old.txt`
- New log file created automatically
- Prevents SD card from filling up

### Bluetooth Management
Users can check and manage logs via Bluetooth:
- `LOG STATUS` - Verify logging is working
- `LOG CLEAR` - Start fresh for new test session

### Multiple Read Methods
1. Web interface (download file)
2. Direct SD card access (remove and read on PC)
3. File browser in web UI

## Usage Workflow

1. Flash firmware with logging enabled
2. Connect via Bluetooth (`esp32_terminal.py`)
3. Send `LOG STATUS` to verify logging
4. Send `LOG CLEAR` to start fresh
5. Perform operations that cause issues
6. Power off and read `/log.txt` from SD card
7. Analyze timestamps and error messages

## Benefits

- **No Serial Required**: Debug without serial connection
- **Persistent**: Logs survive disconnections and crashes
- **Timestamped**: Correlate events with actions
- **Comprehensive**: Captures all major system events
- **Easy Access**: Multiple ways to read logs
- **Automatic**: No manual intervention needed
- **Safe**: Automatic rotation prevents disk full

## Technical Details

- Uses existing SD card infrastructure (SD_MMC or SPI)
- Minimal overhead (writes are quick appends)
- No buffering (immediate write for crash safety)
- Compatible with existing code
- Works in all power modes
- Thread-safe (single-threaded environment)

## Testing Recommendations

1. Verify logging works: `LOG STATUS`
2. Clear before each test: `LOG CLEAR`
3. Check log size periodically
4. Archive important logs before clearing
5. Compare timestamps with your actions
6. Look for ERROR keywords in logs

## Future Enhancements (Optional)

- Add log levels (DEBUG, INFO, WARN, ERROR)
- Compress old logs instead of simple rename
- Add log download via Bluetooth
- Circular buffer for critical events
- Statistics (uptime, error counts, etc.)
