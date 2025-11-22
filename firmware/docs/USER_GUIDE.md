# SD WiFi Pro - User Guide

## Overview

SD WiFi Pro is an ESP32-based wireless SD card reader designed for 3D printers. It allows you to wirelessly manage files on your printer's SD card through a web interface, eliminating the need to physically remove the SD card.

## Key Features

- **Wireless File Management**: Upload, download, and delete files on your printer's SD card via WiFi
- **Dual WiFi Modes**: 
  - Station Mode (STA): Connect to your existing WiFi network
  - Access Point Mode (AP): Create its own WiFi network
- **Shared SD Card Access**: Intelligently shares SD card access between the printer and ESP32
- **Web Interface**: User-friendly browser-based file manager
- **OTA Updates**: Over-the-air firmware updates support

## Hardware Requirements

- ESP32 development board
- SD card slot with multiplexer circuit
- 3D printer with SD card interface

### Pin Configuration

**Standard ESP32:**
- SD Card Pins: CS=13, MISO=2, MOSI=15, SCLK=14
- SD Switch Pin: 26 (controls multiplexer)
- SD Power Pin: 27 (optional power control)
- CS Sense Pin: 32 (detects printer SD access)

**ESP8266:**
- SD Card Pins: CS=4, MISO=12, MOSI=13, SCLK=14
- CS Sense Pin: 5

## Getting Started

### Initial Setup

1. **Power on the device** - On first boot, the device will create a WiFi access point

2. **Connect to the AP**:
   - SSID: `SD-WIFI-PRO`
   - Password: None (open network)
   - IP Address: `192.168.4.1`

3. **Configure WiFi**:
   - Open browser and navigate to `http://192.168.4.1/wifi.htm`
   - Enter your WiFi network SSID and password
   - Click "Connect"
   - Wait for connection confirmation

4. **Access the file manager**:
   - Once connected, note the IP address displayed
   - Navigate to that IP in your browser
   - You'll see the main file management interface

### Alternative Configuration Methods

#### Method 1: SETUP.INI File

Create a file named `SETUP.INI` in the SPIFFS filesystem with:

```ini
SSID=YourNetworkName
PASSWORD=YourPassword
```

The device will automatically connect on boot.

#### Method 2: EEPROM Storage

Once you successfully connect via the web interface, credentials are saved to EEPROM and will be used on subsequent boots.

## Using the Web Interface

### Main File Manager (`/` or `/index.htm`)

The main interface provides:

**File List Display:**
- Shows all files on the SD card root directory
- Displays file type (file/dir), name, and size
- Files are numbered for easy reference

**Actions:**
- **Upload**: Select a file from your computer and upload to SD card
- **Download**: Download any file from the SD card to your computer
- **Delete**: Remove files from the SD card
- **Update List**: Refresh the file list

**Progress Indicators:**
- Upload/download progress bars show transfer status
- Real-time feedback during operations

### WiFi Settings (`/wifi.htm`)

Configure network settings:

**Connect to WiFi:**
1. Enter SSID (network name)
2. Enter password
3. Click "Connect"
4. Status will show connection progress and assigned IP

**Switch to AP Mode:**
- Click "Go to AP mode" to create the SD-WIFI-PRO access point
- Useful if you need to reconfigure or can't access your network

## API Endpoints

The device exposes a REST API for programmatic access:

### File Operations

**List Files:**
```
GET /list?dir=/
Response: JSON array of files
[
  {"type":"file","name":"model.gcode","size":"1234567"},
  {"type":"dir","name":"folder","size":"0"}
]
```

**Download File:**
```
GET /download?path=/filename.gcode
Response: File content with appropriate content-type
```

**Upload File:**
```
POST /upload
Content-Type: multipart/form-data
Body: File data with filename
```

**Delete File:**
```
GET /delete?path=/filename.gcode
Response: "ok" or error message
```

**Release SD Card:**
```
GET /relinquish
Response: "ok"
```
Forces the ESP32 to release SD card control back to printer.

### WiFi Operations

**Scan Networks:**
```
GET /wifiscan
Response: "ok"
```
Initiates WiFi scan (results retrieved via /wifilist).

**Get Scan Results:**
```
GET /wifilist
Response: JSON array of networks
[
  {"ssid":"Network1","rssi":"-45","type":"close"},
  {"ssid":"Network2","rssi":"-67","type":"open"}
]
```

**Connect to Network:**
```
POST /wificonnect?ssid=NetworkName&password=Password
Response: Status message
```

**Check Connection Status:**
```
GET /wifistatus
Response: "WIFI:Connected:192.168.1.100" or "WIFI:Connecting" or "WIFI:Failed"
```

**Enable AP Mode:**
```
POST /wifiap
Response: Status message
```

## SD Card Access Control

The device implements intelligent SD card sharing:

### How It Works

1. **Interrupt-Based Detection**: The CS_SENSE pin monitors when the printer accesses the SD card
2. **Blockout Period**: After printer access, ESP32 waits 10 seconds before taking control
3. **Multiplexer Control**: SD_SWITCH_PIN toggles SD card connection between printer and ESP32
4. **Automatic Release**: ESP32 releases control after completing operations

### User Implications

- **"SD card is busy" errors**: Printer is currently using the SD card, wait 10 seconds
- **Automatic handling**: No manual intervention needed for most operations
- **Safe operation**: Prevents data corruption from simultaneous access

### API Response Codes

Operations return specific error codes:
- `SDBUSY`: Printer is using SD card
- `BADARGS`: Invalid parameters provided
- `BADPATH`: File or directory doesn't exist
- `NOTDIR`: Path is not a directory
- `OPENFAILED`: Could not open file for writing

## Configuration Storage

### Priority Order

1. **EEPROM**: Saved credentials from web interface (highest priority)
2. **SETUP.INI**: Configuration file in SPIFFS
3. **AP Mode**: Fallback if no configuration exists

### Clearing Configuration

To reset WiFi settings:
- The device clears EEPROM when switching to AP mode
- Or manually clear by uploading empty SETUP.INI

## Troubleshooting

### Cannot Connect to WiFi

**Symptoms**: Device stays in AP mode or connection fails

**Solutions**:
1. Verify SSID and password are correct
2. Check WiFi signal strength
3. Ensure 2.4GHz network (ESP32 doesn't support 5GHz)
4. Try AP mode and reconfigure

### Cannot Access SD Card

**Symptoms**: "SD card is busy" errors

**Solutions**:
1. Wait 10 seconds after printer finishes printing
2. Ensure printer is idle
3. Try the "Update List" button to refresh
4. Power cycle the device if persistent

### Upload/Download Fails

**Symptoms**: Transfer starts but doesn't complete

**Solutions**:
1. Check WiFi signal strength
2. Try smaller files first
3. Ensure SD card has free space
4. Verify SD card is properly inserted

### Web Interface Not Loading

**Symptoms**: Cannot access web pages

**Solutions**:
1. Verify IP address (check serial output or router)
2. Ensure you're on the same network
3. Try accessing via AP mode (192.168.4.1)
4. Clear browser cache
5. Check SPIFFS filesystem has web files

### Device Not Responding

**Solutions**:
1. Check serial output (115200 baud) for errors
2. Verify power supply is adequate
3. Check SD card multiplexer circuit
4. Reflash firmware

## Technical Details

### Serial Debug Output

Connect to serial port at 115200 baud to see:
- Boot messages
- WiFi connection status
- IP address assignment
- SD card operations
- Error messages

### Debug Mode

To enable detailed debug output:
1. Edit `serial.h`
2. Comment out `#define RELEASE`
3. Recompile and upload

Debug output includes:
- HTTP request details
- File operation status
- SD card control transitions
- Timing information

### File System Structure

**SPIFFS (ESP32 Flash):**
```
/SETUP.INI          - WiFi configuration
/index.htm          - Main file manager page
/wifi.htm           - WiFi settings page
/favicon.ico        - Browser icon
/css/               - Stylesheets
  bootstrap.min.css
  fontawesome-all.min.css
  index.css
/js/                - JavaScript files
  jquery-3.2.1.slim.min.js
  bootstrap.min.js
  index.js
/img/               - Images
  index_bg.jpg
```

**SD Card:**
- Root directory browsing only
- Supports all file types
- Typical use: G-code files for 3D printing

### Supported File Types

The web server recognizes and serves:
- HTML (.htm, .html)
- CSS (.css)
- JavaScript (.js)
- JSON (.json)
- Images (.png, .gif, .jpg, .ico)
- Documents (.xml, .pdf)
- Archives (.zip, .gz)
- G-code and other text files

### Memory Considerations

- EEPROM: 512 bytes (configuration storage)
- SSID: Max 32 characters
- Password: Max 64 characters
- Upload/download: Chunked transfer for large files

## Safety Features

1. **SD Card Protection**: Blockout period prevents conflicts
2. **Interrupt Monitoring**: Detects printer SD access in real-time
3. **Automatic Release**: Returns control to printer after operations
4. **Error Handling**: Graceful failure with informative messages
5. **Connection Timeout**: 30-second WiFi connection timeout

## Advanced Usage

### Programmatic Access

Use the REST API for automation:

```bash
# List files
curl http://192.168.1.100/list?dir=/

# Download file
curl http://192.168.1.100/download?path=/model.gcode -o model.gcode

# Upload file
curl -F "data=@model.gcode" http://192.168.1.100/upload

# Delete file
curl http://192.168.1.100/delete?path=/old_model.gcode
```

### Integration with Slicers

Configure your slicer to upload directly:
1. Use the upload API endpoint
2. Set target URL: `http://[device-ip]/upload`
3. Use POST method with multipart/form-data

### Network Discovery

The device hostname is set to `FYSETC` for mDNS discovery (if supported by your network).

## Maintenance

### Firmware Updates

The device supports OTA (Over-The-Air) updates:
1. Compile new firmware
2. Use Arduino IDE or PlatformIO OTA upload
3. Device will update and reboot automatically

### Backup Configuration

Save your SETUP.INI file as backup:
1. Download via web interface or serial connection
2. Store securely
3. Re-upload if needed after firmware update

## Specifications

- **Microcontroller**: ESP32 or ESP8266
- **WiFi**: 802.11 b/g/n (2.4GHz)
- **Web Server**: Async HTTP server on port 80
- **SD Card**: SPI mode, standard SD/SDHC cards
- **Power**: 3.3V logic, 5V power input
- **Serial**: 115200 baud, 8N1

## Credits

Based on Marlin firmware serial communication code.
Developed by FYSETC.

## License

GNU General Public License v3.0 or later.
