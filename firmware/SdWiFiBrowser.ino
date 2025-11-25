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
#include <SD.h>
#include <SD_MMC.h>
#include <ArduinoJson.h>

// Define SD object based on mode
#ifdef USE_SD_MMC
  #define SD_OBJ SD_MMC
#else
  #define SD_OBJ SD
#endif

// Sleep mode state
bool sleepMode = false;
bool wifiEnabled = false;
bool serverStarted = false;
unsigned long lastActivityTime = 0;
const bool WIFI_ENABLED_ON_START = false;
bool pendingCredentialsSend = false;

void setup() {
  SERIAL_INIT(115200);
  
  // Load config first to get BT name
  SPIFFS.begin();
  config.load(&SPIFFS);
  
  // Initialize Bluetooth with configured name
  BT.begin(config.btSSID());
  
  if (WIFI_ENABLED_ON_START) {    
    SERIAL_ECHOLN("WiFi enabled on startup (WIFI_ENABLED_ON_START=true)");
    sdcontrol.setup();
    network.start();
    server.begin(&SPIFFS);
    wifiEnabled = true;
    serverStarted = true;
  }

  else {

  SERIAL_ECHOLN("WiFi disabled on startup");
  SERIAL_ECHOLN("Use Bluetooth commands to enable WiFi");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  wifiEnabled = false;

  // start in sleep mode
  enterSleepMode();
  }
  
  lastActivityTime = millis();
  DEBUG_LOG("Setup complete\n");
}

void enterSleepMode() {
  if (sleepMode) return;
  
  SERIAL_ECHOLN("Entering light sleep mode...");
  
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
  BT.write("zzz\n");
  SERIAL_ECHOLN("Sleep mode active. Bluetooth remains active for wake command.");
}

void exitSleepMode() {
  if (!sleepMode) return;
  
  BT.write("[WAKE] Starting wake sequence...\n");
  SERIAL_ECHOLN("Waking from sleep mode...");
  
  // Restore normal power mode
  BT.write("[WAKE] Restoring CPU to 240MHz...\n");
  esp_pm_config_esp32_t pm_config;
  pm_config.max_freq_mhz = 240;
  pm_config.min_freq_mhz = 240;
  pm_config.light_sleep_enable = false;
  esp_err_t pm_result = esp_pm_configure(&pm_config);
  if (pm_result == ESP_OK) {
    BT.write("[WAKE] CPU frequency restored OK\n");
  } else {
    BT.write("[WAKE] ERROR: CPU frequency restore failed: ");
    BT.write(String(pm_result).c_str());
    BT.write("\n");
  }
  
  sleepMode = false;
  lastActivityTime = millis();
  BT.write("[WAKE] Sleep mode flag cleared\n");
  
  // Start WiFi and server if not already started
  if (!wifiEnabled || WiFi.getMode() == WIFI_OFF) {
    BT.write("[WAKE] WiFi is OFF, starting initialization...\n");
    SERIAL_ECHOLN("Starting WiFi in AP mode...");
    
    if (!serverStarted) {
      BT.write("[WAKE] First-time setup: Initializing SPIFFS...\n");
      if (!SPIFFS.begin()) {
        BT.write("[WAKE] ERROR: SPIFFS.begin() failed!\n");
      } else {
        BT.write("[WAKE] SPIFFS OK\n");
      }
      
      BT.write("[WAKE] Setting up SD control pins...\n");
      sdcontrol.setup();
      BT.write("[WAKE] SD pins configured\n");
      
      BT.write("[WAKE] Taking SD card control...\n");
      sdcontrol.takeControl();
      if (sdcontrol.wehaveControl()) {
        BT.write("[WAKE] SD card initialized successfully\n");
      } else {
        BT.write("[WAKE] WARNING: SD card initialization may have failed\n");
      }
      
      serverStarted = true;
      BT.write("[WAKE] Server started flag set\n");
    } else {
      BT.write("[WAKE] Server already initialized, skipping setup\n");
    }
    
    BT.write("[WAKE] Starting WiFi AP...\n");
    network.startSoftAP();
    BT.write("[WAKE] AP start command sent\n");
    
    BT.write("[WAKE] Initializing web server...\n");
    server.begin(&SPIFFS);
    BT.write("[WAKE] Web server initialized\n");
    
    wifiEnabled = true;
    
    // Flag to send credentials after AP is confirmed running in main loop
    pendingCredentialsSend = true;
    BT.write("[WAKE] Credentials will be sent after AP confirms running\n");
    SERIAL_ECHOLN("WiFi AP starting...");
  } else {
    BT.write("[WAKE] WiFi already running\n");
    // WiFi already running, send credentials immediately
    sendAPCredentials();
  }
  
  BT.write("[WAKE] Wake sequence complete!\n");
  SERIAL_ECHOLN("Device awake.");
}

// Queue management functions
void handleQueueCommand() {
  BT.write("[QUEUE] Starting queue check...\n");
  
  // Ensure SD card is available
  if (!sdcontrol.wehaveControl()) {
    BT.write("[QUEUE] SD card not initialized, setting up...\n");
    
    // Initialize SD control if not already done
    if (!serverStarted) {
      BT.write("[QUEUE] Running first-time SD setup...\n");
      sdcontrol.setup();
      delay(100);
    }
    
    BT.write("[QUEUE] Taking SD card control...\n");
    sdcontrol.takeControl();
    delay(200); // Give SD card time to initialize
    
    if (!sdcontrol.wehaveControl()) {
      BT.write("{\"error\":\"SD card not available - initialization failed\"}\n");
      return;
    }
    BT.write("[QUEUE] SD card control acquired\n");
  } else {
    BT.write("[QUEUE] SD card already initialized\n");
  }
  
  const char* queuePath = "/queue.txt";
  const char* dcimPath = "/DCIM";
  
  // Check if DCIM folder exists
  if (!SD_OBJ.exists(dcimPath)) {
    BT.write("{\"error\":\"DCIM folder not found\"}\n");
    return;
  }
  
  // Get list of image files in DCIM (sorted by modification time)
  File dcimDir = SD_OBJ.open(dcimPath);
  if (!dcimDir || !dcimDir.isDirectory()) {
    BT.write("{\"error\":\"Cannot open DCIM folder\"}\n");
    return;
  }
  
  // Collect all image files with their timestamps
  struct ImageFile {
    String name;
    time_t modTime;
  };
  
  std::vector<ImageFile> allImages;
  File entry = dcimDir.openNextFile();
  while (entry) {
    if (!entry.isDirectory()) {
      String filename = String(entry.name());
      filename.toLowerCase();
      // Check for image extensions
      if (filename.endsWith(".jpg") || filename.endsWith(".jpeg") || 
          filename.endsWith(".png") || filename.endsWith(".bmp")) {
        ImageFile img;
        img.name = String(entry.name());
        img.modTime = entry.getLastWrite();
        allImages.push_back(img);
      }
    }
    entry.close();
    entry = dcimDir.openNextFile();
  }
  dcimDir.close();
  
  // Sort by modification time (oldest first)
  std::sort(allImages.begin(), allImages.end(), [](const ImageFile& a, const ImageFile& b) {
    return a.modTime < b.modTime;
  });
  
  BT.write("[QUEUE] Found ");
  BT.write(String(allImages.size()).c_str());
  BT.write(" images in DCIM\n");
  
  // Check if queue.txt exists
  bool queueExists = SD_OBJ.exists(queuePath);
  std::vector<String> queuedImages;
  int addedCount = 0;
  
  if (queueExists) {
    BT.write("[QUEUE] Reading existing queue.txt...\n");
    // Read existing queue
    File queueFile = SD_OBJ.open(queuePath, FILE_READ);
    if (queueFile) {
      while (queueFile.available()) {
        String line = queueFile.readStringUntil('\n');
        line.trim();
        if (line.length() > 0) {
          queuedImages.push_back(line);
        }
      }
      queueFile.close();
    }
    
    BT.write("[QUEUE] Existing queue has ");
    BT.write(String(queuedImages.size()).c_str());
    BT.write(" images\n");
    
    // Check for new images not in queue
    for (const auto& img : allImages) {
      bool inQueue = false;
      for (const auto& queued : queuedImages) {
        if (queued == img.name) {
          inQueue = true;
          break;
        }
      }
      if (!inQueue) {
        queuedImages.push_back(img.name);
        addedCount++;
      }
    }
    
    if (addedCount > 0) {
      BT.write("[QUEUE] Adding ");
      BT.write(String(addedCount).c_str());
      BT.write(" new images to queue\n");
      
      // Update queue.txt with new images
      File queueFile = SD_OBJ.open(queuePath, FILE_WRITE);
      if (queueFile) {
        for (const auto& img : queuedImages) {
          queueFile.println(img);
        }
        queueFile.close();
      }
    }
  } else {
    BT.write("[QUEUE] Creating new queue.txt with 5 oldest images...\n");
    // Create new queue with 5 oldest images
    int count = min(5, (int)allImages.size());
    File queueFile = SD_OBJ.open(queuePath, FILE_WRITE);
    if (queueFile) {
      for (int i = 0; i < count; i++) {
        queueFile.println(allImages[i].name);
        queuedImages.push_back(allImages[i].name);
      }
      queueFile.close();
      addedCount = count;
    } else {
      BT.write("{\"error\":\"Failed to create queue.txt\"}\n");
      return;
    }
  }
  
  // Build JSON response
  BT.write("{");
  BT.write("\"count\":");
  BT.write(String(queuedImages.size()).c_str());
  BT.write(",\"added\":");
  BT.write(String(addedCount).c_str());
  BT.write(",\"images\":[");
  
  for (size_t i = 0; i < queuedImages.size(); i++) {
    BT.write("\"");
    BT.write(queuedImages[i].c_str());
    BT.write("\"");
    if (i < queuedImages.size() - 1) {
      BT.write(",");
    }
  }
  
  BT.write("]}\n");
  BT.write("[QUEUE] Complete\n");
}

void sendStatusReport() {
  BT.write("=== Device Status ===\n");
  
  // Power & Performance (for brownout troubleshooting)
  BT.write("--- Power & Performance ---\n");
  
  // CPU Frequency
  BT.write("CPU Freq (MHz): ");
  BT.write(String(getCpuFrequencyMhz()).c_str());
  
  // Power Mode
  BT.write("Power Mode: ");
  BT.write(sleepMode ? "Sleep (80MHz)\n" : "Active (240MHz)\n");
  
  // WiFi Power Mode
  if (wifiEnabled && WiFi.getMode() != WIFI_OFF) {
    wifi_ps_type_t ps_type;
    esp_wifi_get_ps(&ps_type);
    BT.write("WiFi Power: ");
    switch(ps_type) {
      case WIFI_PS_NONE:
        BT.write("Max Performance (High Power)\n");
        break;
      case WIFI_PS_MIN_MODEM:
        BT.write("Min Modem (Power Save)\n");
        break;
      case WIFI_PS_MAX_MODEM:
        BT.write("Max Modem (Max Power Save)\n");
        break;
      default:
        BT.write("Unknown\n");
    }
  }
  
  BT.write("Bluetooth: Connected\n");
  
  // WiFi Status
  BT.write("\n--- WiFi Status ---\n");
  BT.write("WiFi: ");
  if (wifiEnabled && WiFi.getMode() != WIFI_OFF) {
    BT.write("ON\n");
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
    BT.write("OFF\n");
  }
  
  // SD Card Status
  BT.write("\n--- SD Card ---\n");
  BT.write("SD: ");
  BT.write(sdcontrol.wehaveControl() ? "Active\n" : "Inactive\n");
  
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
  
  // STATUS command works in both sleep and awake modes
  if (cmd == "STATUS") {
    sendStatusReport();
    return;
  }
  
  // QUEUE command works in both sleep and awake modes
  if (cmd == "QUEUE") {
    handleQueueCommand();
    return;
  }
  
  // SD ON command works in both sleep and awake modes
  if (cmd == "SD ON") {
    if (sdcontrol.wehaveControl()) {
      BT.write("SD card already active\n");
    } else {
      BT.write("[SD ON] Initializing SD card...\n");
      
      // Setup SD pins if not done yet
      if (!serverStarted) {
        BT.write("[SD ON] First-time setup: configuring SD pins...\n");
        sdcontrol.setup();
        delay(100);
        BT.write("[SD ON] SD pins configured\n");
      }
      
      BT.write("[SD ON] Taking SD card control...\n");
      sdcontrol.takeControl();
      delay(200);
      
      if (sdcontrol.wehaveControl()) {
        BT.write("[SD ON] SD card initialized successfully\n");
        BT.write("SD card is now ACTIVE\n");
      } else {
        BT.write("[SD ON] ERROR: SD card initialization failed\n");
        BT.write("Check:\n");
        BT.write("  - SD card is inserted\n");
        BT.write("  - SD card is formatted (FAT32)\n");
        BT.write("  - Device has sufficient power\n");
      }
    }
    return;
  }
  
  // SD OFF command works in both sleep and awake modes
  if (cmd == "SD OFF") {
    if (!sdcontrol.wehaveControl()) {
      BT.write("SD card already inactive\n");
    } else {
      BT.write("[SD OFF] Releasing SD card control...\n");
      sdcontrol.relinquishControl();
      delay(100);
      
      if (!sdcontrol.wehaveControl()) {
        BT.write("[SD OFF] SD card released successfully\n");
        BT.write("SD card is now INACTIVE\n");
      } else {
        BT.write("[SD OFF] WARNING: SD card may still be active\n");
      }
    }
    return;
  }
  
  // If in sleep mode, only accept WAKE, STATUS, QUEUE, and SD commands
  if (sleepMode) {
    BT.write("Device is sleeping. Available commands: WAKE, STATUS, QUEUE, SD ON, SD OFF\n");
    return;
  }
  
  if (cmd == "HELP") {
    BT.write("Available commands:\n");
    BT.write("  HELP - Show this help\n");
    BT.write("  STATUS - Show device status\n");
    BT.write("  QUEUE - Check/update image processing queue\n");
    BT.write("  SD ON - Initialize and mount SD card\n");
    BT.write("  SD OFF - Unmount and release SD card\n");
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
  else if (cmd == "WIFI ON") {
    if (!wifiEnabled || WiFi.getMode() == WIFI_OFF) {
      BT.write("Starting WiFi...\n");
      if (!serverStarted) {
        SPIFFS.begin();
        sdcontrol.setup();
        sdcontrol.takeControl();  // Initialize SD card
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