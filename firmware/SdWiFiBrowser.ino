#include <Arduino.h>
#include "sdControl.h"
#include "config.h"
#include "serial.h"
#include "sdlog.h"
#include "network.h"
#include "FSWebServer.h"
#include "bluetooth.h"
#include <SPIFFS.h>
#include <esp_pm.h>
#include <esp_wifi.h>

// Sleep mode state
bool sleepMode = false;
bool wifiEnabled = false;
bool serverStarted = false;
unsigned long lastActivityTime = 0;
const bool WIFI_ENABLED_ON_START = false;
bool pendingCredentialsSend = false;

void setup() {
  SERIAL_INIT(115200);
  SD_LOGLN("=== DEVICE BOOT ===");
  
  // Load config first to get BT name
  SPIFFS.begin();
  config.load(&SPIFFS);
  SD_LOGLN("Config loaded from SPIFFS");
  
  // Initialize Bluetooth with configured name
  BT.begin(config.btSSID());
  SD_LOG("Bluetooth initialized: %s\n", config.btSSID());
  
  if (WIFI_ENABLED_ON_START) {    
    SERIAL_ECHOLN("WiFi enabled on startup (WIFI_ENABLED_ON_START=true)");
    SD_LOGLN("WiFi enabled on startup");
    sdcontrol.setup();
    sdLogger.init();  // Initialize SD logging after SD card is ready
    network.start();
    server.begin(&SPIFFS);
    wifiEnabled = true;
    serverStarted = true;
    SD_LOGLN("Server started");
  }

  else {

  SERIAL_ECHOLN("WiFi disabled on startup");
  SERIAL_ECHOLN("Use Bluetooth commands to enable WiFi");
  SD_LOGLN("WiFi disabled on startup - waiting for BT commands");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiEnabled = false;

  // start in sleep mode
  enterSleepMode();
  }
  
  lastActivityTime = millis();
  DEBUG_LOG("Setup complete\n");
  SD_LOGLN("Setup complete");
}

void enterSleepMode() {
  if (sleepMode) return;
  
  SERIAL_ECHOLN("Entering light sleep mode...");
  SD_LOGLN("Entering light sleep mode");
  
  // Disable WiFi to save power
  if (wifiEnabled) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    SD_LOGLN("WiFi disabled for sleep");
  }
  
  // Configure light sleep (Bluetooth stays active)
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = 80;  // Reduce CPU frequency
  pm_config.min_freq_mhz = 10;  // Minimum frequency
  pm_config.light_sleep_enable = true;
  esp_pm_configure(&pm_config);
  
  sleepMode = true;
  BT.write("zzz\n");
  SERIAL_ECHOLN("Sleep mode active. Bluetooth remains active for wake command.");
  SD_LOGLN("Sleep mode active");
}

void exitSleepMode() {
  if (!sleepMode) return;
  
  SERIAL_ECHOLN("Waking from sleep mode...");
  SD_LOGLN("Waking from sleep mode");
  
  // Restore normal power mode
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = 240;
  pm_config.min_freq_mhz = 240;
  pm_config.light_sleep_enable = false;
  esp_pm_configure(&pm_config);
  
  sleepMode = false;
  lastActivityTime = millis();
  
  // Start WiFi and server if not already started
  if (!wifiEnabled || WiFi.getMode() == WIFI_OFF) {
    SERIAL_ECHOLN("Starting WiFi in AP mode...");
    SD_LOGLN("Starting WiFi in AP mode");
    if (!serverStarted) {
      SPIFFS.begin();
      sdcontrol.setup();
      sdLogger.init();  // Initialize SD logging after SD card is ready
      serverStarted = true;
    }
    network.startSoftAP();  // Start in AP mode
    server.begin(&SPIFFS);
    wifiEnabled = true;
    
    // Flag to send credentials after AP is confirmed running in main loop
    pendingCredentialsSend = true;
    SERIAL_ECHOLN("WiFi AP starting...");
    SD_LOGLN("WiFi AP starting");
  } else {
    // WiFi already running, send credentials immediately
    sendAPCredentials();
  }
  
  SERIAL_ECHOLN("Device awake.");
  SD_LOGLN("Device awake");
}

void handleBluetoothCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  
  SD_LOG("BT Command received: %s\n", cmd.c_str());
  
  lastActivityTime = millis(); // Reset activity timer
  
  // Wake command works even in sleep mode
  if (cmd == "WAKE") {
    if (sleepMode) {
      exitSleepMode();
    } else {
      BT.write("Device is already awake.\n");
    }
    return;
  }
  
  // If in sleep mode, only accept WAKE command
  if (sleepMode) {
    BT.write("Device is sleeping. Send 'WAKE' to wake up.\n");
    return;
  }
  
  if (cmd == "HELP") {
    BT.write("Available commands:\n");
    BT.write("  HELP - Show this help\n");
    BT.write("  STATUS - Show device status\n");
    BT.write("  SLEEP - Enter low power sleep mode\n");
    BT.write("  WAKE - Wake from sleep mode\n");
    BT.write("  WIFI ON - Enable WiFi\n");
    BT.write("  WIFI OFF - Disable WiFi\n");
    BT.write("  WIFI SCAN - Scan for networks\n");
    BT.write("  WIFI CONNECT <ssid> <password> - Connect to WiFi\n");
    BT.write("  WIFI AP - Start Access Point mode\n");
    BT.write("  LOG STATUS - Check if SD logging is enabled\n");
    BT.write("  LOG CLEAR - Clear the log file\n");
    BT.write("  RESTART - Restart device\n");
  }
  else if (cmd == "SLEEP") {
    enterSleepMode();
  }
  else if (cmd == "STATUS") {
    BT.write("=== Device Status ===\n");
    BT.write("Power Mode: ");
    BT.write(sleepMode ? "Sleep\n" : "Active\n");
    BT.write("Bluetooth: Connected\n");
    
    BT.write("\nWiFi: ");
    if (wifiEnabled && WiFi.getMode() != WIFI_OFF) {
      BT.write("Enabled\n");
      BT.write("Mode: ");
      BT.write(network.isSTAmode() ? "Station\n" : "Access Point\n");
      
      if (network.isSTAmode()) {
        if (network.isConnected()) {
          BT.write("Status: Connected\n");
          BT.write("Current SSID: ");
          BT.write(WiFi.SSID().c_str());
          BT.write("\n");
          BT.write("IP: ");
          BT.write(WiFi.localIP().toString().c_str());
          BT.write("\n");
          BT.write("RSSI: ");
          BT.write(String(WiFi.RSSI()).c_str());
          BT.write(" dBm\n");
        } else if (network.isConnecting()) {
          BT.write("Status: Connecting...\n");
        } else {
          BT.write("Status: Disconnected\n");
        }
      } else {
        BT.write("AP SSID: ");
        BT.write(WiFi.SSID().c_str());
        BT.write("\n");
        BT.write("AP IP: ");
        BT.write(WiFi.softAPIP().toString().c_str());
        BT.write("\n");
      }
    } else {
      BT.write("Disabled\n");
    }
    
    // Show stored credentials
    BT.write("\n--- Stored Credentials ---\n");
    char* stored_ssid = config.ssid();
    char* stored_password = config.password();
    
    if (stored_ssid != NULL && strlen(stored_ssid) > 0) {
      BT.write("Saved SSID: ");
      BT.write(stored_ssid);
      BT.write("\n");
      
      if (stored_password != NULL && strlen(stored_password) > 0) {
        BT.write("Saved Password: ");
        BT.write(stored_password);
        BT.write("\n");
      } else {
        BT.write("Saved Password: (none)\n");
      }
    } else {
      BT.write("No saved credentials\n");
    }
    
    // Show AP credentials
    char* ap_ssid = config.apSSID();
    char* ap_password = config.apPassword();
    
    if (ap_ssid != NULL && strlen(ap_ssid) > 0) {
      BT.write("AP SSID: ");
      BT.write(ap_ssid);
      BT.write("\n");
      
      if (ap_password != NULL && strlen(ap_password) > 0) {
        BT.write("AP Password: ");
        BT.write(ap_password);
        BT.write("\n");
      } else {
        BT.write("AP Password: (open)\n");
      }
    }
    BT.write("========================\n");
  }
  else if (cmd == "WIFI ON") {
    if (!wifiEnabled || WiFi.getMode() == WIFI_OFF) {
      BT.write("Starting WiFi...\n");
      if (!serverStarted) {
        SPIFFS.begin();
        sdcontrol.setup();
        serverStarted = true;
      }
      network.start();
      server.begin(&SPIFFS);
      wifiEnabled = true;
      BT.write("WiFi enabled\n");
    } else {
      BT.write("WiFi already enabled\n");
    }
  }
  else if (cmd == "WIFI OFF") {
    if (wifiEnabled && WiFi.getMode() != WIFI_OFF) {
      WiFi.disconnect(true);
      WiFi.mode(WIFI_OFF);
      wifiEnabled = false;
      BT.write("WiFi disabled\n");
    } else {
      BT.write("WiFi already disabled\n");
    }
  }
  else if (cmd == "WIFI SCAN") {
    BT.write("Scanning WiFi networks...\n");
    network.doScan();
    delay(3000); // Wait for scan to complete
    String list;
    network.getWiFiList(list);
    BT.write("Networks found:\n");
    BT.write(list.c_str());
    BT.write("\n");
  }
  else if (cmd.startsWith("WIFI CONNECT ")) {
    String params = cmd.substring(13);
    int spaceIndex = params.indexOf(' ');
    
    if (spaceIndex > 0) {
      String ssid = params.substring(0, spaceIndex);
      String password = params.substring(spaceIndex + 1);
      
      BT.write("Connecting to: ");
      BT.write(ssid.c_str());
      BT.write("\n");
      
      network.startConnect(ssid, password);
      BT.write("Connection initiated. Use STATUS to check.\n");
    } else {
      BT.write("Error: Usage: WIFI CONNECT <ssid> <password>\n");
    }
  }
  else if (cmd == "WIFI AP") {
    BT.write("Starting Access Point mode...\n");
    network.startSoftAP();
    BT.write("AP mode started\n");
  }
  else if (cmd == "LOG STATUS") {
    if (sdLogger.isEnabled()) {
      BT.write("SD logging is ENABLED\n");
      BT.write("Log file: /log.txt on SD card\n");
      BT.write("You can read this file to troubleshoot issues\n");
    } else {
      BT.write("SD logging is DISABLED\n");
      BT.write("SD card may not be available\n");
    }
  }
  else if (cmd == "LOG CLEAR") {
    if (sdLogger.isEnabled()) {
      sdLogger.clear();
      BT.write("Log file cleared\n");
    } else {
      BT.write("SD logging is not enabled\n");
    }
  }
  else if (cmd == "RESTART") {
    BT.write("Restarting device...\n");
    SD_LOGLN("Device restart requested via BT");
    delay(1000);
    ESP.restart();
  }
  else {
    BT.write("Unknown command: ");
    BT.write(cmd.c_str());
    BT.write("\nType HELP for available commands\n");
    SD_LOG("Unknown BT command: %s\n", cmd.c_str());
  }
}

void sendAPCredentials() {
  char* ap_ssid = config.apSSID();
  char* ap_password = config.apPassword();
  
  if (ap_ssid != NULL && strlen(ap_ssid) > 0) {
    BT.write(ap_ssid);
    BT.write("\n");
    
    if (ap_password != NULL && strlen(ap_password) > 0) {
      BT.write(ap_password);
      BT.write("\n");
    }
  }
}

void loop() {
  // Check if we need to send credentials after AP startup
  if (pendingCredentialsSend) {
    // Wait a bit more for AP to stabilize
    static unsigned long apStartTime = 0;
    if (apStartTime == 0) {
      apStartTime = millis();
    }
    
    if (millis() - apStartTime > 1500) {
      // Verify AP is running
      if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
        SERIAL_ECHOLN("WiFi AP confirmed running");
        sendAPCredentials();
      } else {
        SERIAL_ECHOLN("ERROR: WiFi AP failed to start");
        BT.write("ERROR: AP failed to start\n");
      }
      pendingCredentialsSend = false;
      apStartTime = 0;
    }
  }
  
  // Check if a Bluetooth client just connected
  if (BT.checkAndClearJustConnected()) {
    delay(500); // Small delay to ensure client is ready
    sendAPCredentials();
  }
  
  // Handle Bluetooth data if available (works even in sleep mode)
  if (BT.available()) {
    String data = BT.readString();
    data.trim();
    
    if (data.length() > 0) {
      DEBUG_LOG("BT Command: %s\n", data.c_str());
      handleBluetoothCommand(data);
    }
  }
  
  // Only run network loop if not in sleep mode and WiFi is enabled
  if (!sleepMode && wifiEnabled) {
    network.loop();
  }
  
  // In sleep mode, add a small delay to allow light sleep
  if (sleepMode) {
    delay(100); // Allow CPU to enter light sleep between BLE events
  }
}