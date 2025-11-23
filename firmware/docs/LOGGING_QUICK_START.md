# SD Logging Quick Start

## Problem Solved
When testing firmware with `esp32_terminal.py`, the device disconnects and you lose serial output. Now all debug info is saved to the SD card!

## Quick Usage

### 1. Flash the firmware
```bash
cd firmware
./upload.sh
```

### 2. Test via Bluetooth
```bash
python tools/esp32_terminal.py
```

### 3. Check logging status
In the Bluetooth terminal, type:
```
LOG STATUS
```

### 4. Perform your test
Do whatever causes the issue (e.g., SPIFFS operations, WiFi changes, etc.)

### 5. Read the log
Power off the device, remove SD card, and read `/log.txt`

Or use the web interface to download the log file.

## Useful Commands

```
HELP          - Show all commands
LOG STATUS    - Check if logging is working
LOG CLEAR     - Start fresh log file
STATUS        - Show device status
RESTART       - Restart device
```

## What You'll See in the Log

```
========================================
Device started: 1234
========================================
[1234ms] === DEVICE BOOT ===
[1456ms] Config loaded from SPIFFS
[1567ms] Bluetooth initialized: ESP32_Device
[1678ms] WiFi disabled on startup - waiting for BT commands
[1789ms] Setup complete
[2000ms] BT Command received: WAKE
[2100ms] Waking from sleep mode
[2200ms] Starting WiFi in AP mode
[2300ms] Starting WiFi Access Point...
[2400ms] AP SSID: ESP32_AP
[2500ms] AP mode: Password protected
[2600ms] AP started successfully - IP: 192.168.4.1
```

## Tips

- Clear the log before each test session with `LOG CLEAR`
- Timestamps help correlate events with your actions
- Look for ERROR messages in the log
- Old logs are saved to `/log_old.txt` when file gets too large
