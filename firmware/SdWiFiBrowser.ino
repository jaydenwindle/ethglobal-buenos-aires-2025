#include <Arduino.h>
#include "sdControl.h"
#include "config.h"
#include "serial.h"
#include "network.h"
#include "FSWebServer.h"
#include "bluetooth.h"
#include <SPIFFS.h>

void setup() {
  SERIAL_INIT(115200);
  SPIFFS.begin();
  sdcontrol.setup();
  
  // Initialize Bluetooth
  BT.begin("ESP32-SD-WiFi");
  
  network.start();
  server.begin(&SPIFFS);
  
  DEBUG_LOG("Setup complete\n");
}

void handleBluetoothCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  
  if (cmd == "HELP") {
    BT.write("Available commands:\n");
    BT.write("  HELP - Show this help\n");
    BT.write("  STATUS - Show WiFi status\n");
    BT.write("  WIFI ON - Enable WiFi\n");
    BT.write("  WIFI OFF - Disable WiFi\n");
    BT.write("  WIFI SCAN - Scan for networks\n");
    BT.write("  WIFI CONNECT <ssid> <password> - Connect to WiFi\n");
    BT.write("  WIFI AP - Start Access Point mode\n");
    BT.write("  RESTART - Restart device\n");
  }
  else if (cmd == "STATUS") {
    BT.write("=== Device Status ===\n");
    BT.write("WiFi Mode: ");
    BT.write(network.isSTAmode() ? "Station\n" : "Access Point\n");
    
    if (network.isSTAmode()) {
      BT.write("WiFi Status: ");
      if (network.isConnected()) {
        BT.write("Connected\n");
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
        BT.write("Connecting...\n");
      } else {
        BT.write("Disconnected\n");
      }
    } else {
      BT.write("AP SSID: PERMA\n");
      BT.write("AP IP: ");
      BT.write(WiFi.softAPIP().toString().c_str());
      BT.write("\n");
    }
    
    BT.write("Bluetooth: Connected\n");
  }
  else if (cmd == "WIFI ON") {
    if (WiFi.getMode() == WIFI_OFF) {
      WiFi.mode(WIFI_STA);
      BT.write("WiFi enabled\n");
    } else {
      BT.write("WiFi already enabled\n");
    }
  }
  else if (cmd == "WIFI OFF") {
    if (WiFi.getMode() != WIFI_OFF) {
      WiFi.disconnect(true);
      WiFi.mode(WIFI_OFF);
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
  network.loop();
  
  // Handle Bluetooth data if available
  if (BT.available()) {
    String data = BT.readString();
    data.trim();
    
    if (data.length() > 0) {
      DEBUG_LOG("BT Command: %s\n", data.c_str());
      handleBluetoothCommand(data);
    }
  }
}