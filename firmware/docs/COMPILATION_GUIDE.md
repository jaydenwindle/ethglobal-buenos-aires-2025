# Compilation Guide - ESP32 Core Version Compatibility

## Quick Fixes for Common Errors

### Error 1: "network_event_handle_t does not name a type"
**Solution**: Downgrade to ESP32 Core 2.0.17 (see Option 1 below)

### Error 2: "AsyncWebServer::state() discards qualifiers"
**Solution**: Fix AsyncTCP library (after downgrading to Core 2.0.17)

```bash
# macOS/Linux
sed -i '' 's/uint8_t status();/uint8_t status() const;/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.h

sed -i '' 's/uint8_t AsyncServer::status(){/uint8_t AsyncServer::status() const {/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.cpp

# Windows (PowerShell)
# Edit files manually - see detailed instructions below
```

## Issue Summary

This firmware was originally developed for **ESP32 Arduino Core 2.0.x**. If you're using **ESP32 Core 3.x**, you'll encounter compilation errors due to breaking API changes in the WiFi library.

## Error Symptoms

```
error: 'network_event_handle_t' does not name a type
error: 'NetworkEventCb' has not been declared
error: 'arduino_event_id_t' has not been declared
error: expected class-name before '{' token
```

## Solution Options

### Option 1: Use ESP32 Core 2.0.x (Recommended)

This is the easiest solution and ensures full compatibility.

#### Arduino IDE

1. Open Arduino IDE
2. Go to **Tools > Board > Boards Manager**
3. Search for "esp32"
4. If you have 3.x installed, click on it and select version **2.0.17** from dropdown
5. Click "Install"
6. Restart Arduino IDE
7. Verify: Tools > Board > ESP32 Arduino > ESP32 Dev Module

#### PlatformIO

Edit `platformio.ini`:

```ini
[env:esp32dev]
platform = espressif32@6.5.0  ; Uses ESP32 Core 2.0.14
board = esp32dev
framework = arduino
```

Or specify exact version:

```ini
platform_packages = 
    platformio/framework-arduinoespressif32 @ ~3.20014.0  ; Core 2.0.14
```

### Option 2: Update Code for ESP32 Core 3.x

The code has been partially updated with compatibility checks. However, you may need additional library updates:

#### Required Library Versions for Core 3.x

1. **ESPAsyncWebServer**: Use the latest version or a Core 3.x compatible fork
   - Original: https://github.com/me-no-dev/ESPAsyncWebServer
   - Core 3.x fork: https://github.com/mathieucarbou/ESPAsyncWebServer

2. **AsyncTCP**: Use Core 3.x compatible version
   - Original: https://github.com/me-no-dev/AsyncTCP
   - Core 3.x fork: https://github.com/mathieucarbou/AsyncTCP

#### Arduino IDE Installation (Core 3.x Compatible Libraries)

```bash
# Remove old libraries first
rm -rf ~/Documents/Arduino/libraries/ESPAsyncWebServer
rm -rf ~/Documents/Arduino/libraries/AsyncTCP

# Clone compatible versions
cd ~/Documents/Arduino/libraries/
git clone https://github.com/mathieucarbou/ESPAsyncWebServer.git
git clone https://github.com/mathieucarbou/AsyncTCP.git
```

#### PlatformIO Installation (Core 3.x)

Edit `platformio.ini`:

```ini
[env:esp32dev]
platform = espressif32  ; Latest (3.x)
board = esp32dev
framework = arduino

lib_deps = 
    mathieucarbou/ESP Async WebServer @ ^3.0.0
    mathieucarbou/AsyncTCP @ ^3.0.0
    bblanchon/ArduinoJson @ ^6.21.0
```

### Option 3: Use ESP8266 Instead

If you have an ESP8266 board, it doesn't have these compatibility issues:

#### Arduino IDE
1. Tools > Board > ESP8266 Boards > Generic ESP8266 Module
2. Install libraries normally (no special versions needed)

#### PlatformIO
```ini
[env:esp8266]
platform = espressif8266
board = esp12e
framework = arduino

lib_deps = 
    ESP Async WebServer
    ESPAsyncTCP
    ArduinoJson
```

## Verification Steps

After choosing a solution, verify compilation:

### Arduino IDE
1. Open `SdWiFiBrowser.ino`
2. Select correct board and port
3. Click **Verify** (checkmark icon)
4. Should compile without errors

### PlatformIO
```bash
platformio run
```

## Common Issues and Fixes

### Issue: "Multiple libraries were found for SD.h"

**Solution**: This is just a warning, not an error. The correct library is being used.

### Issue: "AsyncWebServer::state() discards qualifiers"

**Error Message:**
```
error: passing 'const AsyncServer' as 'this' argument discards qualifiers [-fpermissive]
return static_cast<tcp_state>(_server.status());
```

**Cause**: AsyncTCP library `status()` method is missing `const` qualifier

**Solution - Quick Fix (macOS/Linux):**
```bash
# Fix AsyncTCP.h
sed -i 's/uint8_t status();/uint8_t status() const;/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.h

# Fix AsyncTCP.cpp
sed -i 's/uint8_t AsyncServer::status(){/uint8_t AsyncServer::status() const {/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.cpp
```

**Solution - Manual Fix:**

1. Open `~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.h`
2. Find line ~252: `uint8_t status();`
3. Change to: `uint8_t status() const;`
4. Open `~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.cpp`
5. Find line ~1509: `uint8_t AsyncServer::status(){`
6. Change to: `uint8_t AsyncServer::status() const {`
7. Save both files and recompile

**Alternative Solution:**
- Install a newer version of AsyncTCP that has this fix
- Or use mathieucarbou's AsyncTCP fork (see Option 2 above)

### Issue: "WiFi.h: No such file or directory"

**Cause**: ESP32 board support not installed

**Solution**:
1. Arduino IDE: Install ESP32 boards via Boards Manager
2. PlatformIO: Add `platform = espressif32` to platformio.ini

### Issue: Libraries not found after installation

**Solution**:
```bash
# Arduino IDE - Verify library location
ls ~/Documents/Arduino/libraries/

# Should see:
# - ESPAsyncWebServer/
# - AsyncTCP/ (ESP32) or ESPAsyncTCP/ (ESP8266)
# - ArduinoJson/

# If missing, reinstall via Library Manager
```

## Recommended Setup (Tested Configuration)

### For ESP32

**Arduino IDE:**
- ESP32 Core: **2.0.17**
- ESPAsyncWebServer: **1.2.3** (me-no-dev)
- AsyncTCP: **1.1.1** (me-no-dev)
- ArduinoJson: **6.21.5**

**PlatformIO:**
```ini
[env:esp32dev]
platform = espressif32@6.5.0
board = esp32dev
framework = arduino
monitor_speed = 115200

lib_deps = 
    https://github.com/me-no-dev/ESPAsyncWebServer.git
    https://github.com/me-no-dev/AsyncTCP.git
    bblanchon/ArduinoJson@^6.21.0
```

### For ESP8266

**Arduino IDE:**
- ESP8266 Core: **3.1.2**
- ESPAsyncWebServer: **1.2.3**
- ESPAsyncTCP: **1.2.2**
- ArduinoJson: **6.21.5**

**PlatformIO:**
```ini
[env:esp8266]
platform = espressif8266
board = esp12e
framework = arduino
monitor_speed = 115200

lib_deps = 
    ESP Async WebServer
    ESPAsyncTCP
    ArduinoJson@^6.21.0
```

## Board Selection

### Arduino IDE

**ESP32:**
- Tools > Board > ESP32 Arduino > ESP32 Dev Module

**ESP8266:**
- Tools > Board > ESP8266 Boards > Generic ESP8266 Module

### Board Settings (ESP32)

- Upload Speed: 921600
- CPU Frequency: 240MHz
- Flash Frequency: 80MHz
- Flash Mode: DIO
- Flash Size: 4MB (or 8MB if available)
- Partition Scheme: **Default 4MB with spiffs** (or 8MB with spiffs)
- Core Debug Level: None (or "Info" for debugging)

## Troubleshooting Compilation

### Enable Verbose Output

**Arduino IDE:**
1. File > Preferences
2. Check "Show verbose output during: compilation"
3. Try compiling again to see detailed errors

**PlatformIO:**
```bash
platformio run -v
```

### Clean Build

**Arduino IDE:**
1. Close Arduino IDE
2. Delete build cache:
   - macOS: `rm -rf ~/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/sdk/esp32/include`
   - Windows: Delete `%LOCALAPPDATA%\Arduino15\packages\esp32\hardware\esp32\*\tools\sdk\esp32\include`
3. Reopen and compile

**PlatformIO:**
```bash
platformio run --target clean
platformio run
```

## Getting Help

If you continue to have issues:

1. **Check your versions:**
   ```bash
   # Arduino IDE: Tools > Board > Boards Manager
   # Look for "esp32" version
   
   # PlatformIO:
   pio platform show espressif32
   ```

2. **Verify library installation:**
   - Arduino IDE: Sketch > Include Library > Manage Libraries
   - Search for each required library
   - Note installed versions

3. **Check serial output:**
   - Set monitor speed to 115200 baud
   - Look for boot messages and errors

4. **Review documentation:**
   - See USER_GUIDE.md for usage
   - See DEVELOPER_GUIDE.md for architecture details
   - See README.md for quick start

## Summary

**Quick Fix**: Downgrade to ESP32 Core 2.0.17 in Boards Manager

**Long Term**: Wait for library ecosystem to fully support Core 3.x, or use the mathieucarbou forks

**Alternative**: Use ESP8266 which has stable library support
