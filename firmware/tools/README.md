# ESP32 Tools

## Bluetooth Terminal (esp32_terminal.py)

Interactive terminal for controlling ESP32-SD-WiFi via Bluetooth.

### Installation

```bash
pip install bleak
```

### Usage

```bash
python esp32_terminal.py
```

### Features
- Auto-discovery of ESP32 device
- Interactive command interface
- Real-time response display
- WiFi control commands
- Easy to use

### Example Session

```
$ python esp32_terminal.py
Scanning for ESP32-SD-WiFi...
✓ Found device: ESP32-SD-WiFi (AA:BB:CC:DD:EE:FF)
Connecting...
✓ Connected!

Available commands:
  HELP - Show this help
  STATUS - Show WiFi status
  WIFI ON - Enable WiFi
  ...

> STATUS
=== Device Status ===
WiFi Mode: Station
WiFi Status: Connected
SSID: MyNetwork
IP: 192.168.1.100

> quit
✓ Disconnected
```

## Other Tools

### Flash Tool
Located in `Flash/` directory - for flashing firmware to ESP32.

### ESP32FS
Located in `ESP32FS/` directory - for uploading SPIFFS filesystem.
