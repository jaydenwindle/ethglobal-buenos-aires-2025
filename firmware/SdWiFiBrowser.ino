#include <Arduino.h>
#include "sdControl.h"
#include "config.h"
#include "serial.h"
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

void setup() {
  SERIAL_INIT(115200);
  
  // Initialize Bluetooth first (needed for wake from sleep)
  BT.begin("ESP32-SD-WiFi");
  
  // if WiFi enabled on startup
    // SERIAL_ECHOLN("WiFi enabled on startup (WIFI_ENABLED_ON_START=true)");
    // SPIFFS.begin();
    // sdcontrol.setup();
    // network.start();
    // server.begin(&SPIFFS);
    // wifiEnabled = true;
    // serverStarted = true;

  SERIAL_ECHOLN("WiFi disabled on startup");
  SERIAL_ECHOLN("Use Bluetooth commands to enable WiFi");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiEnabled = false;
  
  lastActivityTime = millis();

  // start in sleep mode
  enterSleepMode();

  DEBUG_LOG("Setup complete\n");
}

void enterSleepMode() {
  if (sleepMode) return;
  
  SERIAL_ECHOLN("Entering light sleep mode...");
  BT.write("Entering sleep mode. Send 'WAKE' to wake up.\n");
  
  // Disable WiFi to save power
  if (wifiEnabled) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }
  
  // Configure light sleep (Bluetooth stays active)
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = 80;  // Reduce CPU frequency
  pm_config.min_freq_mhz = 10;  // Minimum frequency
  pm_config.light_sleep_enable = true;
  esp_pm_configure(&pm_config);
  
  sleepMode = true;
  SERIAL_ECHOLN("Sleep mode active. Bluetooth remains active for wake command.");
}

void exitSleepMode() {
  if (!sleepMode) return;
  
  SERIAL_ECHOLN("Waking from sleep mode...");
  
  // Restore normal power mode
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = 240;
  pm_config.min_freq_mhz = 240;
  pm_config.light_sleep_enable = false;
  esp_pm_configure(&pm_config);
  
  sleepMode = false;
  lastActivityTime = millis();
  
  BT.write("Device awake! Type HELP for commands.\n");
  SERIAL_ECHOLN("Device awake.");
}

void handleBluetoothCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  
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
    
    BT.write("WiFi: ");
    if (wifiEnabled && WiFi.getMode() != WIFI_OFF) {
      BT.write("Enabled\n");
      BT.write("Mode: ");
      BT.write(network.isSTAmode() ? "Station\n" : "Access Point\n");
      
      if (network.isSTAmode()) {
        if (network.isConnected()) {
          BT.write("Status: Connected\n");
          BT.write("SSID: ");
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
  else if (cmd == "RESTART") {
    BT.write("Restarting device...\n");
    delay(1000);
    ESP.restart();
  }
  else {
    BT.write("Unknown command: ");
    BT.write(cmd.c_str());
    BT.write("\nType HELP for available commands\n");
  }
}

void loop() {
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