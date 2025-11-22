# Upload Scripts Guide

This project includes convenient shell scripts for uploading firmware and SPIFFS data to your ESP32.

## Available Scripts

### 1. `upload.sh` - Interactive Upload Menu

Full-featured interactive script with multiple options.

**Usage:**
```bash
./upload.sh
```

**Options:**
1. Upload SPIFFS only
2. Upload Firmware only
3. Upload SPIFFS + Firmware
4. Upload All + Open Monitor
5. Clean build and upload all
6. Exit

**Features:**
- Color-coded output
- Error handling
- Progress indicators
- Automatic delays between uploads
- Serial monitor integration

### 2. `quick-upload.sh` - Fast Upload

Quick upload without prompts. Uploads SPIFFS then firmware.

**Usage:**
```bash
./quick-upload.sh
```

**What it does:**
1. Uploads SPIFFS filesystem
2. Waits 3 seconds
3. Uploads firmware
4. Done!

**Best for:**
- Quick iterations during development
- When you know everything is configured correctly
- Automated workflows

### 3. `monitor.sh` - Serial Monitor

Opens serial monitor at 115200 baud.

**Usage:**
```bash
./monitor.sh
```

**Controls:**
- Press `Ctrl+C` to exit

**What you'll see:**
```
Going to load config from EEPROM
Going to load config from INI file
AP 'PERMA' started.
Password: FuturePrimitive
IP address = 192.168.4.1
MAC address = XX:XX:XX:XX:XX:XX
```

## Prerequisites

### Install PlatformIO

**macOS:**
```bash
brew install platformio
```

**Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py -o get-platformio.py
python3 get-platformio.py
```

**Verify installation:**
```bash
platformio --version
```

### Hardware Setup

Before running scripts, ensure:

1. **DIP Switches** set for programming:
   - Switch 1: **OFF**
   - Switch 2: **ON**

2. **USB connected** to dev board

3. **Correct port** detected:
   ```bash
   ls /dev/cu.usbserial*
   # Should show: /dev/cu.usbserial-1410 (or similar)
   ```

## Workflow Examples

### First Time Setup

```bash
# 1. Upload everything with interactive menu
./upload.sh
# Choose option 4 (Upload All + Open Monitor)

# 2. Watch serial output to verify
# You should see AP started message
```

### Development Workflow

```bash
# 1. Make changes to code or web files

# 2. Quick upload
./quick-upload.sh

# 3. Monitor output
./monitor.sh
```

### Web Interface Changes Only

```bash
# If you only changed HTML/CSS/JS files
./upload.sh
# Choose option 1 (Upload SPIFFS only)
```

### Firmware Changes Only

```bash
# If you only changed C++ code
./upload.sh
# Choose option 2 (Upload Firmware only)
```

### Clean Build

```bash
# If you're having issues or want fresh build
./upload.sh
# Choose option 5 (Clean build and upload all)
```

## Troubleshooting

### "platformio: command not found"

**Solution:**
```bash
# Install PlatformIO
brew install platformio

# Or add to PATH
export PATH=$PATH:~/.platformio/penv/bin
```

### "Permission denied" when running scripts

**Solution:**
```bash
chmod +x upload.sh quick-upload.sh monitor.sh
```

### "Failed to connect to ESP32"

**Solutions:**

1. **Check DIP switches:**
   - Switch 1: OFF
   - Switch 2: ON

2. **Press RESET button** on dev board

3. **Close other serial programs:**
   ```bash
   # Kill any Arduino IDE serial monitors
   pkill -f "Arduino"
   ```

4. **Check USB connection:**
   ```bash
   ls /dev/cu.usbserial*
   ```

5. **Try lower baud rate** in `platformio.ini`:
   ```ini
   upload_speed = 115200
   ```

### "SPIFFS upload failed"

**Solutions:**

1. **Verify data folder exists:**
   ```bash
   ls -la data/
   # Should show: index.htm, wifi.htm, css/, js/, etc.
   ```

2. **Check partition scheme** in `platformio.ini`:
   ```ini
   board_build.partitions = default.csv
   ```

3. **Increase upload timeout:**
   ```ini
   upload_speed = 115200
   monitor_speed = 115200
   ```

### Upload succeeds but device doesn't work

**Solutions:**

1. **Reset DIP switches** for normal operation:
   - Switch 1: **ON**
   - Switch 2: **OFF**

2. **Press RESET button**

3. **Check serial monitor:**
   ```bash
   ./monitor.sh
   # Look for error messages
   ```

## Manual PlatformIO Commands

If scripts don't work, use these commands directly:

```bash
# Upload SPIFFS
platformio run --target uploadfs

# Upload firmware
platformio run --target upload

# Clean build
platformio run --target clean

# Build without uploading
platformio run

# Serial monitor
platformio device monitor --baud 115200

# List connected devices
platformio device list

# Update PlatformIO
platformio upgrade
```

## Advanced Usage

### Upload to specific port

Edit `platformio.ini`:
```ini
upload_port = /dev/cu.usbserial-1410
monitor_port = /dev/cu.usbserial-1410
```

### Verbose output

```bash
platformio run --target upload --verbose
```

### Upload over OTA (WiFi)

Once device is running, you can upload over WiFi:

1. Add to `platformio.ini`:
   ```ini
   upload_protocol = espota
   upload_port = 192.168.4.1  # Device IP
   ```

2. Upload:
   ```bash
   platformio run --target upload
   ```

## Script Customization

### Change baud rate

Edit scripts and change:
```bash
platformio device monitor --baud 115200
```

To your desired baud rate (must match firmware).

### Add custom commands

Edit `upload.sh` and add new menu options:

```bash
7)
    echo ""
    print_msg "🔍 Running custom command..." "$YELLOW"
    # Your custom command here
    ;;
```

### Auto-open browser

Add to end of `quick-upload.sh`:
```bash
echo "🌐 Opening browser..."
sleep 5
open http://192.168.4.1
```

## Tips

1. **Use quick-upload.sh** for rapid development
2. **Use upload.sh option 4** when you want to see serial output immediately
3. **Keep monitor.sh running** in a separate terminal during development
4. **Clean build** if you get weird compilation errors
5. **Check DIP switches** if upload fails

## Integration with IDEs

### VS Code

Add to `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Quick Upload",
      "type": "shell",
      "command": "./quick-upload.sh",
      "group": "build"
    }
  ]
}
```

Run with: `Cmd+Shift+B`

### Makefile

Create `Makefile`:
```makefile
.PHONY: upload spiffs firmware monitor clean

upload:
	./quick-upload.sh

spiffs:
	platformio run --target uploadfs

firmware:
	platformio run --target upload

monitor:
	./monitor.sh

clean:
	platformio run --target clean
```

Use with: `make upload`, `make monitor`, etc.

## See Also

- [README.md](README.md) - Project overview
- [QUICK_FIX.md](QUICK_FIX.md) - Compilation fixes
- [USER_GUIDE.md](USER_GUIDE.md) - Usage guide
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - Technical details
