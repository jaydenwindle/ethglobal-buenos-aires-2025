# WiFi Credentials Configuration

## Single Source of Truth

All WiFi credentials are managed through the **Config System** (`config.cpp` / `config.h`), which provides a single source of truth for both Station Mode and Access Point Mode credentials.

## Configuration Hierarchy

The system loads credentials in the following order:

1. **EEPROM** - Previously saved credentials (highest priority)
2. **SETUP.INI** - Configuration file in SPIFFS
3. **Defaults** - Hardcoded defaults in `config.h` (fallback)

## Configuration Files

### SETUP.INI (SPIFFS)

Located at `/data/SETUP.INI`, this file configures WiFi credentials:

```ini
# Station Mode Configuration (for connecting to existing WiFi)
SSID=YourNetworkName
PASSWORD=YourNetworkPassword

# Access Point Mode Configuration (optional)
AP_SSID=PERMA
AP_PASSWORD=FuturePrimitive
```

**Station Mode (SSID/PASSWORD):**
- Required for connecting to an existing WiFi network
- Device will attempt to connect to this network on startup
- If connection fails, device falls back to AP mode

**Access Point Mode (AP_SSID/AP_PASSWORD):**
- Optional - if not specified, defaults from `config.h` are used
- Used when device creates its own WiFi network
- Minimum 8 characters for password, or leave empty for open network

### Default Values (config.h)

Fallback values defined in code:

```cpp
#define DEFAULT_AP_SSID "PERMA"
#define DEFAULT_AP_PASSWORD "FuturePrimitive"
```

These are used when:
- SETUP.INI doesn't exist
- AP_SSID/AP_PASSWORD are not specified in SETUP.INI
- EEPROM is empty

## Config System API

### Station Mode Credentials

```cpp
// Get credentials
char* ssid = config.ssid();
char* password = config.password();

// Set credentials
config.ssid("NewSSID");
config.password("NewPassword");

// Save to EEPROM
config.save("NewSSID", "NewPassword");
```

### Access Point Mode Credentials

```cpp
// Get AP credentials
char* ap_ssid = config.apSSID();
char* ap_password = config.apPassword();

// Set AP credentials
config.apSSID("NewAPSSID");
config.apPassword("NewAPPassword");
```

## How It Works

### Startup Flow

1. **Load Config**: `config.load(&SPIFFS)` is called
2. **Check EEPROM**: If valid data exists, use it
3. **Check SETUP.INI**: If EEPROM empty, load from file
4. **Apply Defaults**: If file missing/invalid, use defaults
5. **Connect**: Attempt Station mode connection
6. **Fallback**: If connection fails, start AP mode

### Runtime Changes

**Via Web Interface:**
- POST to `/wificonnect` with ssid and password
- Credentials are saved to EEPROM
- Device attempts connection

**Via Bluetooth:**
- Command: `WIFI CONNECT <ssid> <password>`
- Credentials are saved to EEPROM
- Device attempts connection

**Via Code:**
```cpp
network.startConnect("NewSSID", "NewPassword");
```

### Saving Credentials

When a successful WiFi connection is made:
```cpp
config.save(ssid, password);
```

This saves to EEPROM and sets the `flag` field, so on next boot the device will use these credentials.

### Clearing Credentials

To reset to defaults:
```cpp
config.clear();
```

This clears EEPROM and forces the device to reload from SETUP.INI or use defaults.

## Data Structure

```cpp
typedef struct config_type {
  unsigned char flag;      // Was saved before?
  char ssid[32];          // Station mode SSID
  char psw[64];           // Station mode password
  char ap_ssid[32];       // AP mode SSID
  char ap_psw[64];        // AP mode password
} CONFIG_TYPE;
```

## Network Module Integration

The `network.cpp` module uses the config system:

```cpp
// Station mode - uses config.ssid() and config.password()
WiFi.begin(config.ssid(), config.password());

// AP mode - uses config.apSSID() and config.apPassword()
WiFi.softAP(config.apSSID(), config.apPassword());
```

## Best Practices

1. **Never hardcode credentials** in network.cpp or other modules
2. **Always use config system** to get/set credentials
3. **Update SETUP.INI** for default credentials
4. **Update config.h defaults** only if changing product defaults
5. **Use EEPROM save** for runtime credential changes

## Migration Notes

**Old System:**
- AP credentials were hardcoded in `network.cpp`
- Only Station mode used config system

**New System:**
- All credentials use config system
- Single source of truth
- AP credentials can be customized via SETUP.INI
- Backward compatible with existing SETUP.INI files

## Example Configurations

### Home Network Setup
```ini
SSID=HomeNetwork
PASSWORD=MyHomePassword
AP_SSID=ESP32-Backup
AP_PASSWORD=BackupPass123
```

### Open AP Mode
```ini
SSID=HomeNetwork
PASSWORD=MyHomePassword
AP_SSID=ESP32-Open
AP_PASSWORD=
```

### Factory Defaults
```ini
SSID=PERMA
PASSWORD=FuturePrimitive
# AP credentials will use defaults from config.h
```

## Troubleshooting

**Device won't connect to WiFi:**
1. Check SETUP.INI has correct SSID/PASSWORD
2. Clear EEPROM: `config.clear()`
3. Restart device
4. Check serial output for connection errors

**AP mode uses wrong credentials:**
1. Check SETUP.INI for AP_SSID/AP_PASSWORD
2. If not set, check defaults in config.h
3. Verify EEPROM isn't corrupted

**Credentials not persisting:**
1. Ensure `config.save()` is called after changes
2. Check EEPROM size is sufficient (512 bytes)
3. Verify EEPROM.commit() is called
