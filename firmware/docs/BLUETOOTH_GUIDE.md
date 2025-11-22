# Bluetooth Implementation Guide

## Overview
This project now includes Bluetooth Low Energy (BLE) support using the NimBLE library. NimBLE is a lightweight, efficient BLE stack that uses less memory than the standard ESP32 Bluetooth library.

## Features
- **BLE UART Service**: Implements Nordic UART Service (NUS) for serial communication
- **Status Monitoring**: Web interface shows real-time Bluetooth connection status
- **Low Memory Footprint**: NimBLE uses ~50% less RAM than classic Bluetooth
- **Auto-reconnect**: Automatically starts advertising when client disconnects

## Device Name
The Bluetooth device advertises as: **ESP32-SD-WiFi**

## Service UUIDs
- **Service UUID**: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` (Nordic UART Service)
- **RX Characteristic**: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` (Write to ESP32)
- **TX Characteristic**: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (Notify from ESP32)

## Quick Start Guide

### Easiest Methods (Recommended)

| Platform | App | Difficulty | Notes |
|----------|-----|------------|-------|
| **Android** | Serial Bluetooth Terminal | ⭐ Easy | Best option - simple terminal interface |
| **Desktop** | Python script (below) | ⭐⭐ Medium | Great for automation |
| **iOS** | LightBlue | ⭐⭐ Medium | Clean interface |
| **iOS/Android** | nRF Connect | ⭐⭐⭐ Advanced | More technical, full BLE control |

### First Time Setup (Any App)
1. Connect to device "ESP32-SD-WiFi"
2. Send command: `HELP`
3. Send command: `STATUS`
4. You're ready!

## Connecting to the Device

### Using Mobile Apps

#### Recommended: Serial Bluetooth Terminal (Android) - EASIEST!
**Best option for sending commands - much simpler than nRF Connect**

1. Download **Serial Bluetooth Terminal** from Play Store
2. Tap the menu (☰) → **Devices**
3. Tap **Bluetooth LE** tab
4. Scan and select **ESP32-SD-WiFi**
5. You'll see a terminal interface - just type commands!
6. Type `HELP` and press send to see all commands

**Why this is better:**
- Simple terminal interface (like a chat)
- Easy to type and send commands
- Shows responses clearly
- No need to navigate UUIDs

#### Using nRF Connect (iOS/Android) - More Technical

**Step-by-step for nRF Connect:**

1. **Download and Open**
   - iOS: Download from App Store
   - Android: Download from Play Store

2. **Scan for Device**
   - Tap **SCAN** button
   - Look for **ESP32-SD-WiFi** in the list
   - Tap **CONNECT**

3. **Find the UART Service**
   - Scroll down to find service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
   - Or look for "Unknown Service" with 2 characteristics

4. **Enable Notifications (to receive responses)**
   - Find characteristic `6E400003...` (TX - for receiving)
   - Tap the **↓** (download/notify) icon
   - It should turn blue/highlighted

5. **Send Commands**
   - Find characteristic `6E400002...` (RX - for sending)
   - Tap the **↑** (upload/write) icon
   - Select **Text** (not Byte Array)
   - Type your command (e.g., `STATUS`)
   - Tap **SEND**

6. **View Responses**
   - Responses appear in the TX characteristic notifications
   - Tap on the notification to see full text

**Example Commands to Try:**
```
HELP
STATUS
WIFI SCAN
WIFI CONNECT MyNetwork MyPassword
```

#### LightBlue (iOS) - Alternative

1. Download **LightBlue** from App Store
2. Tap **ESP32-SD-WiFi** to connect
3. Find the **Unknown Service** (6E400001...)
4. Tap **Listen for notifications** on characteristic ending in ...0003
5. Tap **Write new value** on characteristic ending in ...0002
6. Select **UTF-8 String**
7. Type command and tap **Write**

### Using Python (Desktop/Laptop) - BEST FOR SCRIPTING

**Interactive Terminal Script:**

```python
#!/usr/bin/env python3
"""
ESP32 Bluetooth Terminal
Simple interactive terminal for ESP32-SD-WiFi device
Install: pip install bleak
Usage: python esp32_terminal.py
"""

import asyncio
from bleak import BleakClient, BleakScanner

SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

async def main():
    print("Scanning for ESP32-SD-WiFi...")
    device = await BleakScanner.find_device_by_name("ESP32-SD-WiFi", timeout=10.0)
    
    if not device:
        print("Device not found! Make sure it's powered on and nearby.")
        return
    
    print(f"Found device: {device.name} ({device.address})")
    print("Connecting...")
    
    async with BleakClient(device) as client:
        print("Connected!")
        
        # Enable notifications to receive responses
        def notification_handler(sender, data):
            try:
                print(f"\n{data.decode('utf-8')}", end='')
            except:
                print(f"\n[Binary data: {data.hex()}]")
        
        await client.start_notify(TX_UUID, notification_handler)
        print("\nType commands (or 'quit' to exit):")
        print("Try: HELP, STATUS, WIFI SCAN\n")
        
        # Interactive loop
        while True:
            try:
                command = input("> ")
                if command.lower() in ['quit', 'exit', 'q']:
                    break
                
                if command.strip():
                    await client.write_gatt_char(RX_UUID, command.encode('utf-8'))
                    await asyncio.sleep(0.5)  # Wait for response
                    
            except KeyboardInterrupt:
                break
        
        print("\nDisconnecting...")

if __name__ == "__main__":
    asyncio.run(main())
```

**Save as `esp32_terminal.py` and run:**
```bash
pip install bleak
python esp32_terminal.py
```

**One-liner Commands:**
```python
# Quick status check
import asyncio
from bleak import BleakClient, BleakScanner

async def send_command(cmd):
    device = await BleakScanner.find_device_by_name("ESP32-SD-WiFi")
    async with BleakClient(device) as client:
        await client.write_gatt_char("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", cmd.encode())

asyncio.run(send_command("STATUS"))
```

## Web Interface Status
The web interface at `http://[device-ip]/` shows:
- **Bluetooth: Connected** (green) - Client is connected
- **Bluetooth: Ready (No client)** (blue) - Advertising, waiting for connection
- **Bluetooth: Disabled** (gray) - Bluetooth not initialized

## WiFi Control via Bluetooth

You can control WiFi settings through Bluetooth commands. Send text commands to the device:

### Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `HELP` | Show all available commands | `HELP` |
| `STATUS` | Show device and WiFi status | `STATUS` |
| `WIFI ON` | Enable WiFi radio | `WIFI ON` |
| `WIFI OFF` | Disable WiFi radio | `WIFI OFF` |
| `WIFI SCAN` | Scan for available networks | `WIFI SCAN` |
| `WIFI CONNECT <ssid> <password>` | Connect to WiFi network | `WIFI CONNECT MyNetwork MyPassword123` |
| `WIFI AP` | Start Access Point mode | `WIFI AP` |
| `RESTART` | Restart the device | `RESTART` |

### Command Examples

**Check Status:**
```
> STATUS
=== Device Status ===
WiFi Mode: Station
WiFi Status: Connected
SSID: MyNetwork
IP: 192.168.1.100
RSSI: -45 dBm
Bluetooth: Connected
```

**Scan Networks:**
```
> WIFI SCAN
Scanning WiFi networks...
Networks found:
[{"ssid":"MyNetwork","rssi":"-45","type":"close"},{"ssid":"OpenWiFi","rssi":"-67","type":"open"}]
```

**Connect to WiFi:**
```
> WIFI CONNECT MyNetwork MyPassword123
Connecting to: MyNetwork
Connection initiated. Use STATUS to check.
```

**Disable WiFi:**
```
> WIFI OFF
WiFi disabled
```

**Enable WiFi:**
```
> WIFI ON
WiFi enabled
```

## API Usage

### In Your Code
```cpp
#include "bluetooth.h"

// Check if connected
if (BT.isConnected()) {
    // Send data
    BT.write("Hello from ESP32\n");
}

// Read data
if (BT.available()) {
    String data = BT.readString();
    Serial.println(data);
}
```

### Available Methods
- `BT.begin(deviceName)` - Initialize Bluetooth with device name
- `BT.end()` - Stop Bluetooth
- `BT.isConnected()` - Check if client is connected
- `BT.isEnabled()` - Check if Bluetooth is enabled
- `BT.write(data)` - Send data to connected client
- `BT.available()` - Check if data is available to read
- `BT.read()` - Read single byte
- `BT.readString()` - Read all available data as string
- `BT.flush()` - Clear receive buffer

## Memory Usage
NimBLE is optimized for low memory usage:
- **RAM**: ~20-30KB (vs 50-60KB for classic Bluetooth)
- **Flash**: ~200KB

## Build Flags
The following flags are set in `platformio.ini` to reduce memory:
```ini
-DCONFIG_BT_NIMBLE_ROLE_PERIPHERAL_DISABLED
-DCONFIG_BT_NIMBLE_ROLE_BROADCASTER_DISABLED
```

These disable unused BLE roles (we only need Central role for UART service).

## Troubleshooting

### Device Not Appearing in Scan
- Ensure Bluetooth is enabled on your phone/computer
- Check that the ESP32 has booted successfully (check serial monitor)
- Try restarting the ESP32

### Cannot Connect
- Make sure no other device is already connected
- Restart the ESP32
- Clear Bluetooth cache on your phone (Settings > Apps > Bluetooth > Clear Cache)

### Connection Drops
- Check power supply - weak power can cause disconnections
- Reduce distance between devices
- Check for WiFi interference (both use 2.4GHz)

## Disabling Bluetooth
To disable Bluetooth and save memory, comment out the initialization in `SdWiFiBrowser.ino`:
```cpp
// BT.begin("ESP32-SD-WiFi");
```

## Future Enhancements
Possible additions:
- File transfer over Bluetooth
- Remote command execution
- Bluetooth-based configuration
- Multiple simultaneous connections
