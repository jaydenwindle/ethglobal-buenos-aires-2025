# SD Card Logging for Troubleshooting

## Overview

The firmware now includes SD card logging functionality to help troubleshoot issues when the serial connection is lost (e.g., during Bluetooth testing with `esp32_terminal.py`).

## How It Works

- All important events are logged to `/log.txt` on the SD card
- Logs include timestamps (milliseconds since boot)
- Logs are written in real-time as events occur
- Maximum log file size: 100KB (automatically archived when exceeded)

## What Gets Logged

The following events are automatically logged:

- Device boot and initialization
- Bluetooth commands received
- WiFi operations (AP start, connection attempts, success/failure)
- SD card initialization attempts
- Sleep/wake cycles
- Errors and failures

## Bluetooth Commands

You can manage the log file via Bluetooth:

```
LOG STATUS    - Check if SD logging is enabled
LOG CLEAR     - Clear the log file and start fresh
```

## Reading the Log File

### Method 1: Via Web Interface
1. Connect to the device's WiFi AP
2. Open the web interface
3. Navigate to the SD card files
4. Download `/log.txt`

### Method 2: Remove SD Card
1. Power off the device
2. Remove the SD card
3. Insert into your computer
4. Open `log.txt` with any text editor

### Method 3: Via Serial (if available)
If you have serial access, you can read the file through the web server or file browser.

## Log Format

Each log entry includes a timestamp:

```
[12345ms] Device started
[12567ms] Bluetooth initialized: ESP32_Device
[13000ms] Starting WiFi Access Point...
[13500ms] AP started successfully - IP: 192.168.4.1
```

## Troubleshooting

### Log file not created
- Ensure SD card is properly inserted
- Check that SD card is formatted as FAT32
- Verify SD card has free space
- Use `LOG STATUS` command via Bluetooth to check status

### Log file stops updating
- Check if log file reached 100KB (will be archived to `log_old.txt`)
- Verify SD card is not write-protected
- Ensure device has sufficient power

### Can't read log file
- Make sure device is powered off before removing SD card
- Try using `LOG CLEAR` to start with a fresh log file
- Check SD card for corruption

## Example Troubleshooting Session

1. Start device and connect via Bluetooth
2. Send `LOG STATUS` to verify logging is enabled
3. Send `LOG CLEAR` to start with a clean log
4. Perform the operation that causes issues
5. Power off device and read `/log.txt` from SD card
6. Look for ERROR messages or unexpected behavior in the timestamps

## Technical Details

- Log implementation: `firmware/sdlog.h` and `firmware/sdlog.cpp`
- Logs are appended to file after each event (no buffering)
- Old logs are archived to `/log_old.txt` when size limit is reached
- Logging works in both SD_MMC and SPI modes
