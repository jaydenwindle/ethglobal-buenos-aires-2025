# SD WiFi Pro - Developer Guide

## Architecture Overview

SD WiFi Pro is an ESP32/ESP8266 firmware that creates a wireless bridge between a 3D printer's SD card and WiFi network. The system uses a hardware multiplexer to share SD card access between the printer and ESP32.

## System Components

### Core Modules

1. **SdWiFiBrowser.ino** - Main entry point
2. **FSWebServer** - Async web server and HTTP handlers
3. **Network** - WiFi management (STA/AP modes)
4. **SDControl** - SD card access arbitration
5. **Config** - Configuration persistence (EEPROM/SPIFFS)
6. **Serial** - Debug output utilities

### File Structure

```
SdWiFiBrowser/
├── SdWiFiBrowser.ino      # Main Arduino sketch
├── FSWebServer.h/cpp      # Web server implementation
├── network.h/cpp          # WiFi management
├── sdControl.h/cpp        # SD card control
├── config.h/cpp           # Configuration management
├── serial.h/cpp           # Serial utilities
├── pins.h                 # Hardware pin definitions
├── macros.h               # Utility macros
└── data/                  # Web interface files (SPIFFS)
    ├── index.htm          # Main UI
    ├── wifi.htm           # WiFi settings
    ├── SETUP.INI          # Config file
    ├── css/               # Stylesheets
    ├── js/                # JavaScript
    └── img/               # Images
```

## Initialization Flow

### Startup Sequence

```cpp
void setup() {
  1. SERIAL_INIT(115200)           // Initialize serial at 115200 baud
  2. SPIFFS.begin()                // Mount SPIFFS filesystem
  3. sdcontrol.setup()             // Configure SD card control
  4. network.start()               // Start WiFi (STA or AP mode)
  5. server.begin(&SPIFFS)         // Start web server
}

void loop() {
  network.loop()                   // Handle WiFi operations
}
```

### Configuration Loading Priority

1. **EEPROM Check**: `config.load(&SPIFFS)`
   - Reads EEPROM for saved credentials
   - If `flag` byte is set, uses stored SSID/password
   
2. **SETUP.INI Fallback**: `config.loadFS()`
   - Parses `/SETUP.INI` from SPIFFS
   - Looks for `SSID=` and `PASSWORD=` lines
   
3. **AP Mode Default**: `network.startSoftAP()`
   - Creates access point if no config found
   - SSID: "SD-WIFI-PRO", IP: 192.168.4.1

## SD Card Access Control

### Hardware Architecture

The system uses a multiplexer circuit controlled by three signals:

- **SD_SWITCH_PIN**: Controls multiplexer (HIGH=printer, LOW=ESP32)
- **CS_SENSE**: Interrupt pin monitoring printer's SD chip select
- **SD_POWER_PIN**: Optional power control for SD card

### Access Arbitration Algorithm

```cpp
// Interrupt handler on CS_SENSE pin
attachInterrupt(CS_SENSE, []() {
    if(!_weTookBus) {
        _spiBlockoutTime = millis() + SPI_BLOCKOUT_PERIOD;
    } else {
        _spiBlockoutTime = millis();
    }
}, CHANGE);
```

**State Machine:**

1. **Idle State**: Both printer and ESP32 can request access
2. **Printer Active**: CS_SENSE interrupt fires
   - Sets blockout time to current + 10 seconds
   - ESP32 operations return "SDBUSY" error
3. **ESP32 Active**: `takeControl()` called
   - Checks if blockout period expired
   - Switches multiplexer to ESP32
   - Initializes SPI and SD library
4. **Release**: `relinquishControl()` called
   - Closes SD library
   - Ends SPI
   - Switches multiplexer back to printer
   - Sets pins to INPUT_PULLUP to avoid interference

### Critical Sections

```cpp
int SDControl::canWeTakeControl() {
    if(_weTookBus) return 0;              // Already have control
    if(millis() < _spiBlockoutTime) {
        return -1;                         // Printer active, blocked
    }
    return 0;                              // Safe to take control
}
```

All file operations check this before proceeding:
```cpp
switch(sdcontrol.canWeTakeControl()) { 
    case -1: 
        request->send(500, "text/plain","OPERATION:SDBUSY");
        return;
    default: break;
}
```

## Web Server Architecture

### Async HTTP Server

Uses `ESPAsyncWebServer` library for non-blocking operation:

```cpp
class FSWebServer : public AsyncWebServer {
    FSWebServer(uint16_t port);           // Constructor (port 80)
    void begin(FS* fs);                   // Initialize with filesystem
    void handle();                        // Process requests (unused in async)
}
```

### Route Registration

Routes are registered in `FSWebServer::begin()`:

```cpp
server.on("/list", HTTP_GET, [this](AsyncWebServerRequest *request) {
    this->onHttpList(request);
});

server.on("/upload", HTTP_POST, 
    [](AsyncWebServerRequest *request) { 
        request->send(200, "text/plain", ""); 
    },
    [this](AsyncWebServerRequest *request, String filename, 
           size_t index, uint8_t *data, size_t len, bool final) {
        this->onHttpFileUpload(request, filename, index, data, len, final);
    }
);

server.onNotFound([this](AsyncWebServerRequest *request) {
    this->onHttpNotFound(request);
});
```

### Content Type Detection

```cpp
String getContentType(String filename, AsyncWebServerRequest *request) {
    if (request->hasArg("download")) return "application/octet-stream";
    else if (filename.endsWith(".htm")) return "text/html";
    else if (filename.endsWith(".css")) return "text/css";
    else if (filename.endsWith(".js")) return "application/javascript";
    // ... more types
    return "text/plain";
}
```

## HTTP Handlers

### File Operations

#### List Directory

```cpp
void FSWebServer::onHttpList(AsyncWebServerRequest * request) {
    // 1. Check SD access permission
    // 2. Get 'dir' parameter
    // 3. Validate path exists
    // 4. Take SD control
    // 5. Open directory
    // 6. Iterate files, build JSON array
    // 7. Send response
    // 8. Release SD control
}
```

**Response Format:**
```json
[
  {"type":"file","name":"model.gcode","size":"1234567"},
  {"type":"dir","name":"subfolder","size":"0"}
]
```

#### Download File

```cpp
void FSWebServer::onHttpDownload(AsyncWebServerRequest *request) {
    // 1. Check SD access permission
    // 2. Get file path from parameter
    // 3. Call handleFileReadSD()
    //    - Opens file from SD card
    //    - Creates AsyncWebServerResponse
    //    - Sends file with appropriate content-type
}
```

**Key Feature**: Supports gzip-compressed files (checks for `.gz` extension).

#### Upload File

```cpp
void FSWebServer::onHttpFileUpload(AsyncWebServerRequest *request, 
                                   String filename, size_t index, 
                                   uint8_t *data, size_t len, bool final) {
    static File uploadFile;
    
    if (!index) {                          // First chunk
        sdcontrol.takeControl();
        if (SD.exists(filename)) SD.remove(filename);
        uploadFile = SD.open(filename, FILE_WRITE);
    }
    
    if (len) {                             // Data chunk
        uploadFile.write(data, len);
    }
    
    if (final) {                           // Last chunk
        uploadFile.close();
        sdcontrol.relinquishControl();
    }
}
```

**Chunked Upload**: Handles large files by processing in chunks.

#### Delete File

```cpp
void FSWebServer::onHttpDelete(AsyncWebServerRequest *request) {
    // 1. Check SD access permission
    // 2. Get 'path' parameter
    // 3. Validate path (not root, exists)
    // 4. Take SD control
    // 5. Call sdcontrol.deleteFile()
    // 6. Release SD control
}
```

### WiFi Operations

#### Connect to Network

```cpp
void FSWebServer::onHttpWifiConnect(AsyncWebServerRequest *request) {
    // 1. Extract 'ssid' and 'password' parameters
    // 2. Validate parameters
    // 3. Call network.startConnect(ssid, password)
    //    - Sets _doConnect flag
    //    - Actual connection happens in network.loop()
    // 4. Return status
}
```

**Async Connection**: Connection happens in main loop to avoid blocking.

#### WiFi Status

```cpp
void FSWebServer::onHttpWifiStatus(AsyncWebServerRequest *request) {
    String resp = "WIFI:";
    switch(network.status()) {
        case 1: resp += "Failed"; break;
        case 2: resp += "Connecting"; break;
        case 3: 
            resp += "Connected:" + WiFi.localIP().toString();
            break;
    }
    request->send(200, "text/plain", resp);
}
```

#### Scan Networks

```cpp
void FSWebServer::onHttpWifiScan(AsyncWebServerRequest * request) {
    network.doScan();                      // Sets _doScan flag
    request->send(200, "text/json", "ok");
}

// In network.loop():
void Network::scanWiFi() {
    int n = WiFi.scanNetworks();
    _wifiList = "[";
    for (int i = 0; i < n; ++i) {
        _wifiList += "{\"ssid\":\"" + WiFi.SSID(i) + "\",";
        _wifiList += "\"rssi\":\"" + WiFi.RSSI(i) + "\",";
        _wifiList += "\"type\":\"" + 
            ((WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "open" : "close") + 
            "\"}";
        if(i != n-1) _wifiList += ",";
    }
    _wifiList += "]";
}
```

## Network Management

### WiFi Modes

#### Station Mode (STA)

```cpp
int Network::connect(String ssid, String psd) {
    WiFi.mode(WIFI_AP_STA);                // Dual mode during connection
    WiFi.begin(ssid.c_str(), psd.c_str());
    
    unsigned int timeout = 0;
    while(WiFi.status() != WL_CONNECTED) {
        timeout++;
        if(timeout++ > WIFI_CONNECT_TIMEOUT/100) {
            return 2;                       // Connection failed
        }
        delay(500);
    }
    
    config.save(ssid.c_str(), psd.c_str()); // Save to EEPROM
    _stamode = true;
    wifiConnected = true;
    return 3;                               // Connected
}
```

#### Access Point Mode (AP)

```cpp
void Network::startSoftAP() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAPConfig(AP_local_ip, AP_gateway, AP_subnet);
    WiFi.softAP(AP_SSID);                   // "SD-WIFI-PRO"
    
    _stamode = false;
    config.clear();                         // Clear saved credentials
}
```

**AP Configuration:**
- IP: 192.168.4.1
- Gateway: 192.168.4.1
- Subnet: 255.255.255.0
- No password (open network)

### Connection State Machine

```cpp
void Network::loop() {
    if(_doConnect) {
        connect(_ssid, _psd);
        _doConnect = false;
    }
    
    if(_doScan) {
        scanWiFi();
        _doScan = false;
    }
}
```

**States:**
- `wifiConnected`: Successfully connected to network
- `wifiConnecting`: Connection in progress
- `_stamode`: Operating in station mode (vs AP mode)
- `_doConnect`: Flag to initiate connection
- `_doScan`: Flag to initiate WiFi scan

## Configuration Management

### EEPROM Structure

```cpp
typedef struct config_type {
    unsigned char flag;                     // 0=not saved, 1=saved
    char ssid[32];                          // WiFi SSID
    char psw[64];                           // WiFi password
} CONFIG_TYPE;
```

**Size**: 97 bytes (1 + 32 + 64)
**EEPROM Allocation**: 512 bytes

### Save/Load Operations

```cpp
void Config::save(const char*ssid, const char*password) {
    EEPROM.begin(EEPROM_SIZE);
    data.flag = 1;
    strncpy(data.ssid, ssid, WIFI_SSID_LEN);
    strncpy(data.psw, password, WIFI_PASSWD_LEN);
    
    uint8_t *p = (uint8_t*)(&data);
    for (int i = 0; i < sizeof(data); i++) {
        EEPROM.write(i, *(p + i));
    }
    EEPROM.commit();
}

unsigned char Config::load(FS* fs) {
    EEPROM.begin(EEPROM_SIZE);
    uint8_t *p = (uint8_t*)(&data);
    for (int i = 0; i < sizeof(data); i++) {
        *(p + i) = EEPROM.read(i);
    }
    
    if(data.flag) {
        return data.flag;                   // Use EEPROM config
    }
    
    if(0 == loadFS()) {                     // Try SETUP.INI
        return 1;
    }
    
    return 0;                               // No config found
}
```

### INI File Parser

```cpp
int Config::loadFS() {
    File file = _fs->open(CONFIG_FILE, "r");
    
    while (file.available()) {
        buffer = file.readStringUntil('\n');
        buffer.replace("\r", "");
        
        int iS = buffer.indexOf('=');
        if(iS < 0) continue;
        
        sKEY = buffer.substring(0, iS);
        sValue = buffer.substring(iS+1);
        
        if(sKEY == "SSID") {
            sValue.toCharArray(data.ssid, WIFI_SSID_LEN);
        }
        else if(sKEY == "PASSWORD") {
            sValue.toCharArray(data.psw, WIFI_PASSWD_LEN);
        }
    }
}
```

**Format:**
```ini
SSID=NetworkName
PASSWORD=NetworkPassword
```

## Serial Debug System

### Debug Macros

```cpp
#define RELEASE                             // Comment to enable debug

#ifndef RELEASE
#define DEBUG_LOG(...) Serial.printf(__VA_ARGS__)
#else
#define DEBUG_LOG(...)                      // No-op in release
#endif

#define SERIAL_ECHOLN(x) SERIAL_PROTOCOLLN(x)
#define SERIAL_ECHO(x) SERIAL_PROTOCOL(x)
```

### Usage Examples

```cpp
DEBUG_LOG("takeControl\n");                 // Only in debug builds
SERIAL_ECHOLN("Going to load config");      // Always printed
SERIAL_ECHOPAIR("Blocking:", _spiBlockoutTime);
```

## Pin Definitions

### ESP32 Standard

```cpp
#define CS_SENSE      32                    // Printer SD access detect
#define SD_SWITCH_PIN 26                    // Multiplexer control
#define SD_POWER_PIN  27                    // SD power control

// SPI Mode
#define SD_CS_PIN     13
#define SD_MISO_PIN   2
#define SD_MOSI_PIN   15
#define SD_SCLK_PIN   14

// SD MMC Mode (4-bit)
#define SD_CMD_PIN    15
#define SD_CLK_PIN    14
#define SD_D0_PIN     2
#define SD_D1_PIN     4
#define SD_D2_PIN     12
#define SD_D3_PIN     13
```

### ESP8266

```cpp
#define SD_CS_PIN     4
#define SD_MISO_PIN   12
#define SD_MOSI_PIN   13
#define SD_SCLK_PIN   14
#define CS_SENSE      5
```

## Building and Flashing

### Dependencies

**Arduino Libraries:**
- ESP32/ESP8266 Core
- ESPAsyncWebServer
- AsyncTCP (ESP32) or ESPAsyncTCP (ESP8266)
- ArduinoJson
- SD
- SPIFFS
- Ticker
- ArduinoOTA

### Compilation

```bash
# Arduino IDE
1. Install ESP32/ESP8266 board support
2. Install required libraries
3. Select board (ESP32 Dev Module or ESP8266)
4. Set partition scheme (with SPIFFS)
5. Compile and upload

# PlatformIO
platformio run --target upload
```

### SPIFFS Upload

```bash
# Arduino IDE
1. Install ESP32/ESP8266 Sketch Data Upload plugin
2. Place web files in data/ folder
3. Tools > ESP32/ESP8266 Sketch Data Upload

# PlatformIO
platformio run --target uploadfs
```

## Extending the System

### Adding New HTTP Endpoints

```cpp
// In FSWebServer::begin()
server.on("/custom", HTTP_GET, [this](AsyncWebServerRequest *request) {
    this->onHttpCustom(request);
});

// Add handler method
void FSWebServer::onHttpCustom(AsyncWebServerRequest *request) {
    // Your implementation
    request->send(200, "text/plain", "Custom response");
}

// Declare in FSWebServer.h
void onHttpCustom(AsyncWebServerRequest *request);
```

### Adding Configuration Parameters

```cpp
// In config.h
typedef struct config_type {
    unsigned char flag;
    char ssid[32];
    char psw[64];
    char newParam[16];                      // Add new field
} CONFIG_TYPE;

// Update save/load methods in config.cpp
// Update SETUP.INI parser to handle new key
```

### Custom SD Operations

```cpp
void customSDOperation() {
    if(sdcontrol.canWeTakeControl() == -1) {
        // SD busy, handle error
        return;
    }
    
    sdcontrol.takeControl();
    
    // Your SD operations here
    File file = SD.open("/myfile.txt", FILE_READ);
    // ...
    file.close();
    
    sdcontrol.relinquishControl();
}
```

## Performance Considerations

### Memory Usage

- **Heap**: Async server uses dynamic allocation
- **Stack**: Keep local variables minimal in handlers
- **SPIFFS**: ~1-2MB for web interface files
- **EEPROM**: 512 bytes allocated

### Optimization Tips

1. **Chunked Transfers**: Large files handled in chunks
2. **Async Operations**: Non-blocking WiFi and file operations
3. **Static Files**: Web assets served from SPIFFS (fast)
4. **Minimal JSON**: Compact JSON responses

### Timing Constraints

- **SPI Blockout**: 10 seconds after printer access
- **WiFi Timeout**: 30 seconds for connection
- **Upload/Download**: No timeout (chunked)

## Security Considerations

### Current Implementation

- **No Authentication**: Web interface is open
- **No Encryption**: HTTP only (no HTTPS)
- **Open AP**: Default AP has no password

### Potential Improvements

```cpp
// Add HTTP authentication
typedef struct {
    bool auth;
    String wwwUsername;
    String wwwPassword;
} strHTTPAuth;

// In FSWebServer::begin()
server.on("/list", HTTP_GET, [this](AsyncWebServerRequest *request) {
    if(!request->authenticate(username, password)) {
        return request->requestAuthentication();
    }
    this->onHttpList(request);
});
```

## Debugging Techniques

### Serial Monitor

```cpp
SERIAL_INIT(115200);
SERIAL_ECHOLN("System starting...");
SERIAL_ECHOPAIR("IP: ", WiFi.localIP());
```

### Enable Debug Mode

```cpp
// In serial.h
//#define RELEASE                            // Comment this line

// Rebuild and upload
```

### Common Debug Points

```cpp
DEBUG_LOG("takeControl\n");
DEBUG_LOG("handleFileRead: %s\r\n", path.c_str());
DEBUG_LOG("Upload: First upload part: %s \n", filename.c_str());
SERIAL_ECHOPAIR("Blocking:", _spiBlockoutTime);
```

### WiFi Diagnostics

```cpp
Serial.println(WiFi.status());              // Connection status
Serial.println(WiFi.localIP());             // Assigned IP
Serial.println(WiFi.RSSI());                // Signal strength
Serial.println(WiFi.SSID());                // Connected network
```

### SD Card Diagnostics

```cpp
Serial.println(SD.cardType());              // Card type
Serial.println(SD.cardSize());              // Card size
Serial.println(SD.totalBytes());            // Total space
Serial.println(SD.usedBytes());             // Used space
```

## Testing

### Unit Testing Approach

```cpp
// Test SD control
void testSDControl() {
    sdcontrol.takeControl();
    assert(sdcontrol.wehaveControl() == true);
    sdcontrol.relinquishControl();
    assert(sdcontrol.wehaveControl() == false);
}

// Test config save/load
void testConfig() {
    config.save("TestSSID", "TestPassword");
    config.load(&SPIFFS);
    assert(strcmp(config.ssid(), "TestSSID") == 0);
}
```

### Integration Testing

1. **WiFi Connection**: Test STA and AP modes
2. **File Upload**: Upload various file sizes
3. **File Download**: Download and verify integrity
4. **Concurrent Access**: Simulate printer SD access during ESP32 operations
5. **Error Handling**: Test invalid paths, full SD card, etc.

### API Testing

```bash
# Test list endpoint
curl http://192.168.1.100/list?dir=/

# Test upload
curl -F "data=@test.gcode" http://192.168.1.100/upload

# Test download
curl http://192.168.1.100/download?path=/test.gcode -o downloaded.gcode

# Test delete
curl http://192.168.1.100/delete?path=/test.gcode

# Test WiFi status
curl http://192.168.1.100/wifistatus
```

## Troubleshooting Development Issues

### Compilation Errors

**Missing Libraries:**
```bash
# Install via Arduino Library Manager or PlatformIO
ESPAsyncWebServer
AsyncTCP (ESP32) / ESPAsyncTCP (ESP8266)
ArduinoJson
```

**Board Not Found:**
```bash
# Install board support
Arduino IDE: File > Preferences > Additional Board Manager URLs
ESP32: https://dl.espressif.com/dl/package_esp32_index.json
ESP8266: http://arduino.esp8266.com/stable/package_esp8266com_index.json
```

### Upload Failures

**SPIFFS Upload Fails:**
- Ensure data/ folder exists
- Check partition scheme includes SPIFFS
- Verify plugin installed correctly

**OTA Upload Fails:**
- Check device is on network
- Verify IP address
- Ensure no firewall blocking

### Runtime Issues

**SD Card Not Detected:**
- Check SPI pins match hardware
- Verify SD card formatted (FAT32)
- Test with different SD card
- Check multiplexer circuit

**WiFi Won't Connect:**
- Verify 2.4GHz network
- Check SSID/password
- Monitor serial output for errors
- Try AP mode for debugging

**Web Interface Not Loading:**
- Verify SPIFFS uploaded
- Check file paths (case-sensitive)
- Monitor serial for 404 errors
- Try accessing specific files

## Best Practices

### Code Style

- Use descriptive variable names
- Comment complex logic
- Keep functions focused and small
- Handle errors gracefully

### Resource Management

- Always release SD control after operations
- Close files after use
- Free allocated memory
- Avoid blocking operations in handlers

### Error Handling

```cpp
// Always check return values
if(sdcontrol.canWeTakeControl() == -1) {
    request->send(500, "text/plain", "SDBUSY");
    return;
}

// Validate parameters
if(!request->hasArg("path")) {
    request->send(400, "text/plain", "Missing parameter");
    return;
}

// Handle file operations
File file = SD.open(path);
if(!file) {
    request->send(404, "text/plain", "File not found");
    return;
}
```

### Testing Before Deployment

1. Test all API endpoints
2. Verify file integrity after upload/download
3. Test with various file sizes
4. Simulate printer SD access
5. Test WiFi reconnection after power loss
6. Verify configuration persistence

## Future Enhancements

### Potential Features

1. **Authentication**: HTTP basic auth or token-based
2. **HTTPS**: SSL/TLS encryption
3. **Directory Navigation**: Browse subdirectories
4. **File Preview**: View G-code or text files
5. **Batch Operations**: Multi-file delete/download
6. **Print Control**: Send commands to printer
7. **Webcam Integration**: Monitor prints
8. **Notifications**: Email/push on print completion
9. **Cloud Sync**: Backup to cloud storage
10. **Mobile App**: Native iOS/Android app

### Architecture Improvements

1. **State Machine**: Formal state management
2. **Event System**: Pub/sub for component communication
3. **Logging**: Structured logging to SD card
4. **Metrics**: Track usage statistics
5. **Configuration UI**: Web-based settings editor

## Contributing

### Code Contributions

1. Fork the repository
2. Create feature branch
3. Follow existing code style
4. Add tests for new features
5. Update documentation
6. Submit pull request

### Documentation

- Keep guides up to date
- Add examples for new features
- Document API changes
- Include troubleshooting tips

## License

GNU General Public License v3.0 or later.
See LICENSE file for details.

## Support

For issues and questions:
- Check serial debug output
- Review this developer guide
- Search existing issues
- Contact FYSETC support
