# Quick Fix Guide - Compilation Errors

## Step 1: Downgrade ESP32 Core

**Arduino IDE:**
1. Tools > Board > Boards Manager
2. Search "esp32"
3. Select version **2.0.17**
4. Click Install
5. Restart Arduino IDE

## Step 2: Fix AsyncTCP Library

### macOS/Linux

Open Terminal and run:

```bash
sed -i '' 's/uint8_t status();/uint8_t status() const;/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.h

sed -i '' 's/uint8_t AsyncServer::status(){/uint8_t AsyncServer::status() const {/' \
  ~/Documents/Arduino/libraries/Async_TCP/src/AsyncTCP.cpp
```

### Windows

**Option A - PowerShell:**
```powershell
$file1 = "$env:USERPROFILE\Documents\Arduino\libraries\Async_TCP\src\AsyncTCP.h"
$file2 = "$env:USERPROFILE\Documents\Arduino\libraries\Async_TCP\src\AsyncTCP.cpp"

(Get-Content $file1) -replace 'uint8_t status\(\);', 'uint8_t status() const;' | Set-Content $file1
(Get-Content $file2) -replace 'uint8_t AsyncServer::status\(\)\{', 'uint8_t AsyncServer::status() const {' | Set-Content $file2
```

**Option B - Manual Edit:**

1. Open `Documents\Arduino\libraries\Async_TCP\src\AsyncTCP.h`
2. Find line ~252: `uint8_t status();`
3. Change to: `uint8_t status() const;`
4. Save file

5. Open `Documents\Arduino\libraries\Async_TCP\src\AsyncTCP.cpp`
6. Find line ~1509: `uint8_t AsyncServer::status(){`
7. Change to: `uint8_t AsyncServer::status() const {`
8. Save file

## Step 3: Compile

**Arduino IDE:**
1. Open `SdWiFiBrowser.ino`
2. Tools > Board > ESP32 Dev Module
3. Tools > Partition Scheme > Default 4MB with spiffs
4. Click Verify (checkmark icon)

**PlatformIO:**
```bash
platformio run
```

## Step 4: Upload SPIFFS

**Arduino IDE:**
1. Tools > ESP32 Sketch Data Upload
2. Wait for upload to complete

**PlatformIO:**
```bash
platformio run --target uploadfs
```

## Step 5: Upload Firmware

**Arduino IDE:**
1. Select correct COM port
2. Click Upload (arrow icon)

**PlatformIO:**
```bash
platformio run --target upload
```

## Verification

After upload, open Serial Monitor at **115200 baud**. You should see:
```
Going to load config from EEPROM
Going to load config from INI file
SD-WIFI-PRO SoftAP started.
IP address = 192.168.4.1
```

Connect to `SD-WIFI-PRO` WiFi network and browse to `http://192.168.4.1`

## Still Having Issues?

See detailed guides:
- [COMPILATION_GUIDE.md](COMPILATION_GUIDE.md) - Comprehensive troubleshooting
- [USER_GUIDE.md](USER_GUIDE.md) - Usage instructions
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - Technical details

## Common Issues

**"Multiple libraries found for SD.h"**
- This is just a warning, ignore it

**"SPIFFS upload failed"**
- Install ESP32 Sketch Data Upload plugin
- Or use PlatformIO instead

**"Port not found"**
- Install CH340 driver
- Check Device Manager (Windows) or `ls /dev/tty.*` (macOS)

**"Upload failed"**
- Check DIP switches: Switch 1 OFF, Switch 2 ON
- Press reset button on board
- Try lower baud rate: 115200 instead of 921600
