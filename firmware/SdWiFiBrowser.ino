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

// Note: We use SD (SPI mode) directly throughout this file
// sdControl.cpp initializes SD via SPI, not SD_MMC
// FSWebServer.cpp also uses SD directly

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

// Helper struct for image files
struct ImageFile {
  String name;
  time_t modTime;
};

// Helper function to check if a file is an image based on extension
bool isImageFile(const String& filename) {
  String lowerFilename = filename;
  lowerFilename.toLowerCase();
  return lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg") || 
         lowerFilename.endsWith(".png") || lowerFilename.endsWith(".bmp");
}

// Recursive helper function to scan a directory for images
void scanDirectoryForImages(const String& dirPath, std::vector<ImageFile>& allImages, int depth = 0) {
  // Limit recursion depth to prevent stack overflow
  const int MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    DEBUG_LOG("[SCAN] Max recursion depth reached at: %s\n", dirPath.c_str());
    return;
  }
  
  DEBUG_LOG("[SCAN] Scanning directory (depth %d): %s\n", depth, dirPath.c_str());
  BT.write("[SCAN] Scanning: ");
  BT.write(dirPath.c_str());
  BT.write("\n");
  
  File dir = SD.open(dirPath.c_str());
  if (!dir || !dir.isDirectory()) {
    DEBUG_LOG("[SCAN] Cannot open directory: %s\n", dirPath.c_str());
    BT.write("[SCAN] ERROR: Cannot open directory\n");
    return;
  }
  
  dir.rewindDirectory();
  
  while (true) {
    File entry = dir.openNextFile();
    if (!entry) {
      break;
    }
    
    String entryName = String(entry.name());
    bool isDir = entry.isDirectory();
    
    DEBUG_LOG("[SCAN] Entry: '%s' isDir=%d\n", entryName.c_str(), isDir);
    
    // Construct full path
    String fullPath;
    if (entryName.startsWith("/")) {
      // Entry name is already a full path
      fullPath = entryName;
    } else {
      // Entry name is relative, construct full path
      fullPath = dirPath;
      if (!dirPath.endsWith("/")) {
        fullPath += "/";
      }
      fullPath += entryName;
    }
    
    DEBUG_LOG("[SCAN] Full path: '%s'\n", fullPath.c_str());
    
    // Extract just the filename for checking
    int lastSlash = fullPath.lastIndexOf('/');
    String fileName = (lastSlash >= 0) ? fullPath.substring(lastSlash + 1) : fullPath;
    
    // Skip macOS metadata files (._*)
    if (fileName.startsWith("._")) {
      DEBUG_LOG("[SCAN] Skipping metadata file: %s\n", fileName.c_str());
      entry.close();
      continue;
    }
    
    if (isDir) {
      // Recursively scan subdirectory
      BT.write("[SCAN] Found subdirectory: ");
      BT.write(fullPath.c_str());
      BT.write("\n");
      DEBUG_LOG("[SCAN] Recursing into: %s\n", fullPath.c_str());
      entry.close();
      scanDirectoryForImages(fullPath, allImages, depth + 1);
    } else {
      // Check if it's an image file
      if (isImageFile(fileName)) {
        ImageFile img;
        img.name = fullPath;  // Store full path
        img.modTime = entry.getLastWrite();
        allImages.push_back(img);
        DEBUG_LOG("[SCAN] Found image: %s (modTime: %ld)\n", fullPath.c_str(), img.modTime);
      } else {
        DEBUG_LOG("[SCAN] Skipping non-image file: %s\n", fileName.c_str());
      }
      entry.close();
    }
  }
  
  dir.close();
}

// Helper function to get all images from DCIM sorted by modification time
bool getImagesFromDCIM(std::vector<ImageFile>& allImages) {
  const char* dcimPath = "/DCIM";
  
  BT.write("[DCIM] Scanning for images recursively...\n");
  SERIAL_ECHOLN("[DCIM] Starting recursive scan");
  
  // Check if DCIM folder exists
  if (!SD.exists(dcimPath)) {
    BT.write("{\"error\":\"DCIM folder not found\"}\n");
    SERIAL_ECHOLN("[DCIM] ERROR: DCIM folder not found");
    return false;
  }
  
  // Recursively scan DCIM and all subdirectories
  scanDirectoryForImages(dcimPath, allImages);
  
  BT.write("[DCIM] Found ");
  BT.write(String(allImages.size()).c_str());
  BT.write(" images total\n");
  SERIAL_ECHO("[DCIM] Found ");
  SERIAL_ECHO(String(allImages.size()).c_str());
  SERIAL_ECHOLN(" images");
  
  if (allImages.size() == 0) {
    BT.write("{\"error\":\"No images found in DCIM\"}\n");
    SERIAL_ECHOLN("[DCIM] ERROR: No images found");
    return false;
  }
  
  // Sort by modification time (oldest first)
  BT.write("[DCIM] Sorting by modification time...\n");
  std::sort(allImages.begin(), allImages.end(), [](const ImageFile& a, const ImageFile& b) {
    return a.modTime < b.modTime;
  });
  
  BT.write("[DCIM] Scan complete\n");
  SERIAL_ECHOLN("[DCIM] Scan complete");
  
  return true;
}

// Helper function to boost CPU frequency for SD operations
void boostCPUForSD() {
  if (sleepMode) {
    BT.write("[SD] Boosting CPU to 240MHz for SD operations...\n");
    SERIAL_ECHOLN("[SD] Boosting CPU frequency");
    
    esp_pm_config_esp32_t pm_config;
    pm_config.max_freq_mhz = 240;
    pm_config.min_freq_mhz = 240;
    pm_config.light_sleep_enable = false;
    esp_pm_configure(&pm_config);
    
    delay(50); // Give CPU time to stabilize
    
    BT.write("[SD] CPU frequency: ");
    BT.write(String(getCpuFrequencyMhz()).c_str());
    BT.write(" MHz\n");
    SERIAL_ECHO("[SD] CPU frequency: ");
    SERIAL_ECHO(String(getCpuFrequencyMhz()).c_str());
    SERIAL_ECHOLN(" MHz");
  }
}

// Helper function to restore sleep mode CPU frequency
void restoreSleepCPU() {
  if (sleepMode) {
    BT.write("[SD] Restoring sleep mode CPU frequency...\n");
    SERIAL_ECHOLN("[SD] Restoring sleep mode");
    
    esp_pm_config_esp32_t pm_config;
    pm_config.max_freq_mhz = 80;
    pm_config.min_freq_mhz = 10;
    pm_config.light_sleep_enable = true;
    esp_pm_configure(&pm_config);
  }
}

// Helper function to ensure SD card is initialized and verify it's working
bool ensureSDInitialized() {
  // Boost CPU frequency if in sleep mode
  boostCPUForSD();
  
  if (!sdcontrol.wehaveControl()) {
    BT.write("[SD] SD card not initialized, setting up...\n");
    SERIAL_ECHOLN("[SD] SD card not initialized");
    
    // Initialize SD control if not already done
    if (!serverStarted) {
      BT.write("[SD] Running first-time SD setup...\n");
      SERIAL_ECHOLN("[SD] Running first-time setup");
      sdcontrol.setup();
      delay(100);
    }
    
    BT.write("[SD] Taking SD card control...\n");
    SERIAL_ECHOLN("[SD] Taking SD card control");
    sdcontrol.takeControl();
    delay(200); // Give SD card time to initialize
    
    if (!sdcontrol.wehaveControl()) {
      BT.write("{\"error\":\"SD card not available - initialization failed\"}\n");
      SERIAL_ECHOLN("[SD] ERROR: Initialization failed");
      restoreSleepCPU(); // Restore sleep mode before returning
      return false;
    }
    BT.write("[SD] SD card control acquired\n");
    SERIAL_ECHOLN("[SD] SD card control acquired");
  } else {
    BT.write("[SD] SD card already initialized\n");
    SERIAL_ECHOLN("[SD] SD card already initialized");
  }
  
  // Verify SD card is actually working by trying to open root
  BT.write("[SD] Verifying SD card access...\n");
  SERIAL_ECHOLN("[SD] Verifying SD card access");
  
  File root = SD.open("/");
  if (!root) {
    BT.write("[SD] ERROR: Cannot open root directory!\n");
    SERIAL_ECHOLN("[SD] ERROR: Cannot open root directory");
    BT.write("[SD] SD card may not be inserted or formatted correctly\n");
    SERIAL_ECHOLN("[SD] SD card may not be inserted or formatted correctly");
    return false;
  }
  
  if (!root.isDirectory()) {
    BT.write("[SD] ERROR: Root is not a directory!\n");
    SERIAL_ECHOLN("[SD] ERROR: Root is not a directory");
    root.close();
    return false;
  }
  
  // Try to read at least one entry to verify SD is readable
  File entry = root.openNextFile();
  if (!entry) {
    BT.write("[SD] WARNING: Root directory is empty\n");
    SERIAL_ECHOLN("[SD] WARNING: Root directory is empty");
    root.close();
    // Don't fail here - empty SD is still valid
  } else {
    BT.write("[SD] Verification OK - found: ");
    BT.write(entry.name());
    BT.write("\n");
    SERIAL_ECHO("[SD] Verification OK - found: ");
    SERIAL_ECHOLN(entry.name());
    entry.close();
  }
  
  root.close();
  
  BT.write("[SD] SD card is ready\n");
  SERIAL_ECHOLN("[SD] SD card is ready");
  return true;
}

// Helper function to write queue.json file (pretty-printed)
bool writeQueueJSON(const char* queuePath, const std::vector<ImageFile>& queuedImages) {
  File queueFile = SD.open(queuePath, FILE_WRITE);
  if (!queueFile) {
    BT.write("[QUEUE] ERROR: Failed to open queue.json for writing\n");
    SERIAL_ECHOLN("[QUEUE] ERROR: Failed to open queue.json for writing");
    return false;
  }
  
  // Write pretty-printed JSON structure
  queueFile.print("{\n");
  queueFile.print("  \"count\": ");
  queueFile.print(queuedImages.size());
  queueFile.print(",\n");
  queueFile.print("  \"images\": {\n");
  
  for (size_t i = 0; i < queuedImages.size(); i++) {
    queueFile.print("    \"");
    queueFile.print(queuedImages[i].name);
    queueFile.print("\": {\n");
    queueFile.print("      \"date\": ");
    queueFile.print(queuedImages[i].modTime);
    queueFile.print("\n");
    queueFile.print("    }");
    if (i < queuedImages.size() - 1) {
      queueFile.print(",");
    }
    queueFile.print("\n");
  }
  
  queueFile.print("  }\n");
  queueFile.print("}\n");
  queueFile.close();
  
  return true;
}

// Helper function to read queue.json file (handles both compact and pretty-printed)
bool readQueueJSON(const char* queuePath, std::vector<ImageFile>& queuedImages) {
  File queueFile = SD.open(queuePath, FILE_READ);
  if (!queueFile) {
    DEBUG_LOG("[readQueueJSON] Failed to open file\n");
    return false;
  }
  
  // Read entire file into string
  String jsonContent = "";
  while (queueFile.available()) {
    jsonContent += (char)queueFile.read();
  }
  queueFile.close();
  
  DEBUG_LOG("[readQueueJSON] File size: %d bytes\n", jsonContent.length());
  DEBUG_LOG("[readQueueJSON] Content preview: %.100s...\n", jsonContent.c_str());
  
  // Parse JSON manually (simple parser for our specific format)
  // Format: {"count":X,"images":{"path":{"date":timestamp},...}}
  // Handles both compact and pretty-printed with whitespace
  
  int imagesStart = jsonContent.indexOf("\"images\"");
  if (imagesStart == -1) {
    DEBUG_LOG("[readQueueJSON] 'images' key not found\n");
    return false;
  }
  
  // Find the opening brace after "images"
  imagesStart = jsonContent.indexOf("{", imagesStart);
  if (imagesStart == -1) {
    DEBUG_LOG("[readQueueJSON] Opening brace after 'images' not found\n");
    return false;
  }
  imagesStart++; // Skip past the opening brace
  
  // Find the matching closing brace (second to last '}' in file)
  int imagesEnd = jsonContent.lastIndexOf("}");
  if (imagesEnd == -1) {
    DEBUG_LOG("[readQueueJSON] Closing brace not found\n");
    return false;
  }
  // Go back one more closing brace (for the images object)
  imagesEnd = jsonContent.lastIndexOf("}", imagesEnd - 1);
  
  String imagesSection = jsonContent.substring(imagesStart, imagesEnd);
  DEBUG_LOG("[readQueueJSON] Images section length: %d\n", imagesSection.length());
  
  // Parse each image entry
  int pos = 0;
  int imageCount = 0;
  while (pos < imagesSection.length()) {
    // Find next quoted string (image path)
    int pathStart = imagesSection.indexOf("\"", pos);
    if (pathStart == -1) break;
    pathStart++;
    
    int pathEnd = imagesSection.indexOf("\"", pathStart);
    if (pathEnd == -1) break;
    
    String imagePath = imagesSection.substring(pathStart, pathEnd);
    
    // Skip if this is the "date" key
    if (imagePath == "date") {
      pos = pathEnd + 1;
      continue;
    }
    
    // Find the date value after this path
    int dateStart = imagesSection.indexOf("\"date\"", pathEnd);
    if (dateStart == -1) {
      DEBUG_LOG("[readQueueJSON] 'date' key not found for image: %s\n", imagePath.c_str());
      break;
    }
    
    // Find the colon after "date"
    dateStart = imagesSection.indexOf(":", dateStart);
    if (dateStart == -1) break;
    dateStart++; // Skip past the colon
    
    // Find the next closing brace (end of date value)
    int dateEnd = imagesSection.indexOf("}", dateStart);
    if (dateEnd == -1) break;
    
    String dateStr = imagesSection.substring(dateStart, dateEnd);
    dateStr.trim();
    
    // Remove any trailing newlines or whitespace
    dateStr.replace("\n", "");
    dateStr.replace("\r", "");
    dateStr.trim();
    
    ImageFile img;
    img.name = imagePath;
    img.modTime = dateStr.toInt();
    queuedImages.push_back(img);
    imageCount++;
    
    DEBUG_LOG("[readQueueJSON] Parsed image #%d: %s (date: %ld)\n", imageCount, imagePath.c_str(), img.modTime);
    
    pos = dateEnd + 1;
  }
  
  DEBUG_LOG("[readQueueJSON] Successfully parsed %d images\n", imageCount);
  return imageCount > 0;
}

// QUEUE command - just display the current queue
void handleQueueCommand() {
  BT.write("[QUEUE] Displaying current queue...\n");
  SERIAL_ECHOLN("[QUEUE] Command received");
  
  // Ensure SD card is available
  if (!ensureSDInitialized()) {
    return;
  }
  
  const char* queuePath = "/queue.json";
  
  // Check if queue.json exists
  if (!SD.exists(queuePath)) {
    BT.write("{\"error\":\"Queue does not exist. Use QUEUE UPDATE to create it.\"}\n");
    SERIAL_ECHOLN("[QUEUE] Queue file does not exist");
    return;
  }
  
  // Read and display the queue file contents
  BT.write("[QUEUE] Reading queue.json...\n");
  
  // Read existing queue
  std::vector<ImageFile> queuedImages;
  if (!readQueueJSON(queuePath, queuedImages)) {
    BT.write("{\"error\":\"Failed to read queue.json\"}\n");
    SERIAL_ECHOLN("[QUEUE] ERROR: Failed to read queue.json");
    return;
  }
  
  // Pretty print the JSON with buffering to avoid Bluetooth overflow
  BT.write("{\n");
  BT.write("  \"count\": ");
  BT.write(String(queuedImages.size()).c_str());
  BT.write(",\n");
  BT.write("  \"images\": {\n");
  delay(10); // Small delay to let Bluetooth buffer clear
  
  SERIAL_ECHO("[QUEUE] Sending ");
  SERIAL_ECHO(String(queuedImages.size()).c_str());
  SERIAL_ECHOLN(" images...");
  
  for (size_t i = 0; i < queuedImages.size(); i++) {
    // Build the entry as a string first
    String entry = "    \"";
    entry += queuedImages[i].name;
    entry += "\": {\n      \"date\": ";
    entry += String(queuedImages[i].modTime);
    entry += "\n    }";
    if (i < queuedImages.size() - 1) {
      entry += ",";
    }
    entry += "\n";
    
    // Send the complete entry
    BT.write(entry.c_str());
    
    // Add a small delay every 5 entries to prevent buffer overflow
    if ((i + 1) % 5 == 0) {
      delay(20);
      SERIAL_ECHO("[QUEUE] Sent ");
      SERIAL_ECHO(String(i + 1).c_str());
      SERIAL_ECHO("/");
      SERIAL_ECHOLN(String(queuedImages.size()).c_str());
    }
  }
  
  BT.write("  }\n");
  BT.write("}\n");
  delay(10);
  
  BT.write("[QUEUE] Complete\n");
  SERIAL_ECHOLN("[QUEUE] Complete");
  
  // Restore sleep mode CPU frequency if needed
  restoreSleepCPU();
}

// Unified function to update/reset queue with all new images
void updateQueueWithAllImages(bool isReset) {
  const char* cmdName = isReset ? "QUEUE RESET" : "QUEUE UPDATE";
  
  BT.write("[");
  BT.write(cmdName);
  BT.write("] Starting...\n");
  SERIAL_ECHO("[");
  SERIAL_ECHO(cmdName);
  SERIAL_ECHOLN("] Command received");
  
  // Ensure SD card is available
  if (!ensureSDInitialized()) {
    return;
  }
  
  const char* queuePath = "/queue.json";
  
  // If RESET, delete existing queue
  if (isReset && SD.exists(queuePath)) {
    BT.write("[");
    BT.write(cmdName);
    BT.write("] Deleting existing queue.json...\n");
    SERIAL_ECHO("[");
    SERIAL_ECHO(cmdName);
    SERIAL_ECHOLN("] Deleting existing queue.json");
    
    if (SD.remove(queuePath)) {
      BT.write("[");
      BT.write(cmdName);
      BT.write("] Old queue.json deleted\n");
      SERIAL_ECHO("[");
      SERIAL_ECHO(cmdName);
      SERIAL_ECHOLN("] Old queue deleted");
    } else {
      BT.write("[");
      BT.write(cmdName);
      BT.write("] WARNING: Failed to delete old queue.json\n");
      SERIAL_ECHO("[");
      SERIAL_ECHO(cmdName);
      SERIAL_ECHOLN("] ERROR: Failed to delete old queue");
    }
  }
  
  // Get all images from DCIM (recursively scans all subdirectories)
  std::vector<ImageFile> allImages;
  if (!getImagesFromDCIM(allImages)) {
    return;
  }
  
  // Read existing queue if it exists (and not reset)
  std::vector<ImageFile> queuedImages;
  int addedCount = 0;
  bool queueExists = !isReset && SD.exists(queuePath);
  
  if (queueExists) {
    BT.write("[");
    BT.write(cmdName);
    BT.write("] Reading existing queue.json...\n");
    SERIAL_ECHO("[");
    SERIAL_ECHO(cmdName);
    SERIAL_ECHOLN("] Reading existing queue");
    
    if (readQueueJSON(queuePath, queuedImages)) {
      BT.write("[");
      BT.write(cmdName);
      BT.write("] Existing queue has ");
      BT.write(String(queuedImages.size()).c_str());
      BT.write(" images\n");
      SERIAL_ECHO("[");
      SERIAL_ECHO(cmdName);
      SERIAL_ECHO("] Existing queue has ");
      SERIAL_ECHO(String(queuedImages.size()).c_str());
      SERIAL_ECHOLN(" images");
    } else {
      BT.write("[");
      BT.write(cmdName);
      BT.write("] WARNING: Failed to parse existing queue\n");
      SERIAL_ECHO("[");
      SERIAL_ECHO(cmdName);
      SERIAL_ECHOLN("] WARNING: Failed to parse existing queue");
      queuedImages.clear();
      queueExists = false;
    }
  }
  
  // Add all new images not already in queue
  for (const auto& img : allImages) {
    bool inQueue = false;
    for (const auto& queued : queuedImages) {
      if (queued.name == img.name) {
        inQueue = true;
        break;
      }
    }
    if (!inQueue) {
      queuedImages.push_back(img);
      addedCount++;
      DEBUG_LOG("[%s] Added: %s (date: %ld)\n", cmdName, img.name.c_str(), img.modTime);
    }
  }
  
  // Sort by modification time (oldest first)
  std::sort(queuedImages.begin(), queuedImages.end(), [](const ImageFile& a, const ImageFile& b) {
    return a.modTime < b.modTime;
  });
  
  BT.write("[");
  BT.write(cmdName);
  BT.write("] ");
  if (addedCount > 0) {
    BT.write("Added ");
    BT.write(String(addedCount).c_str());
    BT.write(" new images. ");
  } else {
    BT.write("No new images to add. ");
  }
  BT.write("Total: ");
  BT.write(String(queuedImages.size()).c_str());
  BT.write("\n");
  
  SERIAL_ECHO("[");
  SERIAL_ECHO(cmdName);
  SERIAL_ECHO("] Added ");
  SERIAL_ECHO(String(addedCount).c_str());
  SERIAL_ECHO(" new images, total: ");
  SERIAL_ECHOLN(String(queuedImages.size()).c_str());
  
  // Write updated queue
  if (!writeQueueJSON(queuePath, queuedImages)) {
    BT.write("{\"error\":\"Failed to write queue.json\"}\n");
    return;
  }
  
  // Build response
  BT.write("{");
  if (isReset) {
    BT.write("\"reset\":true,");
  }
  BT.write("\"count\":");
  BT.write(String(queuedImages.size()).c_str());
  BT.write(",\"added\":");
  BT.write(String(addedCount).c_str());
  BT.write(",\"images\":{");
  
  for (size_t i = 0; i < queuedImages.size(); i++) {
    if (i > 0) BT.write(",");
    BT.write("\"");
    BT.write(queuedImages[i].name.c_str());
    BT.write("\":{\"date\":");
    BT.write(String(queuedImages[i].modTime).c_str());
    BT.write("}");
  }
  
  BT.write("}}\n");
  BT.write("[");
  BT.write(cmdName);
  BT.write("] Complete\n");
  SERIAL_ECHO("[");
  SERIAL_ECHO(cmdName);
  SERIAL_ECHOLN("] Complete");
  
  // Restore sleep mode CPU frequency if needed
  restoreSleepCPU();
}

// QUEUE UPDATE command - update queue with all new images
void handleQueueUpdateCommand() {
  updateQueueWithAllImages(false);
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
  
  // QUEUE command works in both sleep and awake modes - just displays current queue
  if (cmd == "QUEUE") {
    handleQueueCommand();
    return;
  }
  
  // QUEUE UPDATE command - updates queue with new images
  if (cmd == "QUEUE UPDATE") {
    handleQueueUpdateCommand();
    return;
  }
  
  // QUEUE RESET command - recreate queue.json from scratch with all images
  if (cmd == "QUEUE RESET") {
    updateQueueWithAllImages(true);
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
  
  // SD STATUS command - detailed SD card diagnostics
  if (cmd == "SD STATUS") {
    BT.write("=== SD Card Status ===\n");
    SERIAL_ECHOLN("[SD STATUS] Command received");
    
    BT.write("Control Status: ");
    BT.write(sdcontrol.wehaveControl() ? "ACTIVE\n" : "INACTIVE\n");
    SERIAL_ECHO("[SD STATUS] Control: ");
    SERIAL_ECHOLN(sdcontrol.wehaveControl() ? "ACTIVE" : "INACTIVE");
    
    if (!sdcontrol.wehaveControl()) {
      BT.write("SD card is not initialized. Use 'SD ON' first.\n");
      BT.write("=====================\n");
      return;
    }
    
    // Try to open root
    BT.write("Root Access: ");
    File root = SD.open("/");
    if (!root) {
      BT.write("FAILED - Cannot open root\n");
      SERIAL_ECHOLN("[SD STATUS] ERROR: Cannot open root");
    } else {
      BT.write("OK\n");
      SERIAL_ECHOLN("[SD STATUS] Root access OK");
      
      // List root contents
      BT.write("Root Contents:\n");
      int count = 0;
      while (count < 10) {
        File entry = root.openNextFile();
        if (!entry) break;
        BT.write("  - ");
        BT.write(entry.name());
        BT.write(entry.isDirectory() ? " [DIR]\n" : " [FILE]\n");
        entry.close();
        count++;
      }
      root.close();
      
      if (count == 0) {
        BT.write("  (empty)\n");
      }
    }
    
    // Check DCIM folder
    BT.write("DCIM Folder: ");
    if (SD.exists("/DCIM")) {
      BT.write("EXISTS\n");
      SERIAL_ECHOLN("[SD STATUS] DCIM exists");
      
      File dcim = SD.open("/DCIM");
      if (dcim && dcim.isDirectory()) {
        BT.write("DCIM Contents:\n");
        int count = 0;
        while (count < 10) {
          File entry = dcim.openNextFile();
          if (!entry) break;
          BT.write("  - ");
          BT.write(entry.name());
          BT.write(entry.isDirectory() ? " [DIR]\n" : " [FILE]\n");
          entry.close();
          count++;
        }
        dcim.close();
        
        if (count == 0) {
          BT.write("  (empty)\n");
        }
      }
    } else {
      BT.write("NOT FOUND\n");
      SERIAL_ECHOLN("[SD STATUS] DCIM not found");
    }
    
    BT.write("=====================\n");
    return;
  }
  
  // SD LIST command - list files in a directory
  if (cmd.startsWith("SD LIST")) {
    BT.write("[SD LIST] Starting...\n");
    SERIAL_ECHOLN("[SD LIST] Command received");
    
    // Extract path parameter (default to "/" if not provided)
    String path = "/";
    if (cmd.length() > 8) {
      path = cmd.substring(8);
      path.trim();
    }
    
    BT.write("[SD LIST] Requested path: '");
    BT.write(path.c_str());
    BT.write("'\n");
    SERIAL_ECHO("[SD LIST] Requested path: '");
    SERIAL_ECHO(path.c_str());
    SERIAL_ECHOLN("'");
    
    // Check SD card control status
    BT.write("[SD LIST] Checking SD control... ");
    SERIAL_ECHO("[SD LIST] wehaveControl() = ");
    SERIAL_ECHOLN(sdcontrol.wehaveControl() ? "true" : "false");
    
    if (!sdcontrol.wehaveControl()) {
      BT.write("FAILED\n");
      BT.write("[SD LIST] ERROR: SD card not initialized\n");
      BT.write("Use 'SD ON' command first\n");
      SERIAL_ECHOLN("[SD LIST] ERROR: SD card not initialized");
      return;
    }
    BT.write("OK\n");
    
    // Ensure path starts with /
    if (path.length() == 0 || path[0] != '/') {
      path = "/" + path;
      BT.write("[SD LIST] Normalized path to: '");
      BT.write(path.c_str());
      BT.write("'\n");
    }
    
    // Use SD directly (SPI mode) like FSWebServer does
    // sdControl.cpp initializes SD (SPI), not SD_MMC
    BT.write("[SD LIST] Using SD (SPI) mode (same as FSWebServer)\n");
    SERIAL_ECHOLN("[SD LIST] Using SD (SPI) mode");
    
    // Check if path exists
    BT.write("[SD LIST] Checking if path exists... ");
    SERIAL_ECHO("[SD LIST] SD.exists('");
    SERIAL_ECHO(path.c_str());
    SERIAL_ECHO("') = ");
    bool pathExists = SD.exists(path.c_str());
    SERIAL_ECHOLN(pathExists ? "true" : "false");
    
    if (!pathExists) {
      BT.write("NOT FOUND\n");
      BT.write("[SD LIST] ERROR: Path does not exist: '");
      BT.write(path.c_str());
      BT.write("'\n");
      SERIAL_ECHO("[SD LIST] ERROR: Path not found: '");
      SERIAL_ECHO(path.c_str());
      SERIAL_ECHOLN("'");
      
      // Try to list root to help debug
      BT.write("[SD LIST] Attempting to open root directory for debugging...\n");
      File rootDir = SD.open("/");
      if (rootDir) {
        BT.write("[SD LIST] Root directory opened successfully\n");
        if (rootDir.isDirectory()) {
          BT.write("[SD LIST] Root is a directory. First few entries:\n");
          int debugCount = 0;
          while (debugCount < 5) {
            File entry = rootDir.openNextFile();
            if (!entry) break;
            BT.write("  - ");
            BT.write(entry.name());
            BT.write(entry.isDirectory() ? " [DIR]\n" : " [FILE]\n");
            entry.close();
            debugCount++;
          }
        }
        rootDir.close();
      } else {
        BT.write("[SD LIST] ERROR: Cannot even open root directory!\n");
        SERIAL_ECHOLN("[SD LIST] ERROR: Cannot open root directory");
      }
      
      BT.write("{\"error\":\"Path not found: ");
      BT.write(path.c_str());
      BT.write("\"}\n");
      return;
    }
    BT.write("EXISTS\n");
    
    // Open directory
    BT.write("[SD LIST] Opening directory... ");
    SERIAL_ECHO("[SD LIST] Opening directory: '");
    SERIAL_ECHO(path.c_str());
    SERIAL_ECHOLN("'");
    
    File dir = SD.open(path.c_str());
    if (!dir) {
      BT.write("FAILED\n");
      BT.write("[SD LIST] ERROR: Cannot open path\n");
      SERIAL_ECHOLN("[SD LIST] ERROR: SD.open() returned null");
      BT.write("{\"error\":\"Cannot open path\"}\n");
      return;
    }
    BT.write("OK\n");
    
    // Check if it's a directory
    BT.write("[SD LIST] Checking if path is directory... ");
    bool isDirectory = dir.isDirectory();
    SERIAL_ECHO("[SD LIST] isDirectory() = ");
    SERIAL_ECHOLN(isDirectory ? "true" : "false");
    
    if (!isDirectory) {
      BT.write("NO (it's a file)\n");
      dir.close();
      BT.write("[SD LIST] ERROR: Path is not a directory\n");
      SERIAL_ECHOLN("[SD LIST] ERROR: Path is a file, not a directory");
      BT.write("{\"error\":\"Path is not a directory\"}\n");
      return;
    }
    BT.write("YES\n");
    
    dir.rewindDirectory();
    BT.write("[SD LIST] Building JSON response...\n");
    SERIAL_ECHOLN("[SD LIST] Building JSON response");
    
    // Build JSON output similar to onHttpList
    BT.write("[");
    bool first = true;
    int count = 0;
    const int MAX_ITEMS = 200;
    
    while (count < MAX_ITEMS) {
      File entry = dir.openNextFile();
      if (!entry) {
        break;
      }
      
      if (!first) {
        BT.write(",");
      }
      first = false;
      
      bool isDir = entry.isDirectory();
      String entryName = String(entry.name());
      
      DEBUG_LOG("[SD LIST] Entry: '%s' isDir=%d\n", entryName.c_str(), isDir);
      
      // Extract just the filename from full path
      int lastSlash = entryName.lastIndexOf('/');
      String displayName = (lastSlash >= 0) ? entryName.substring(lastSlash + 1) : entryName;
      
      // Construct full path by combining parent path with filename
      String fullPath;
      if (entryName.startsWith("/")) {
        // Entry name is already a full path
        fullPath = entryName;
      } else {
        // Entry name is relative, combine with parent path
        fullPath = path;
        if (!path.endsWith("/")) {
          fullPath += "/";
        }
        fullPath += displayName;
      }
      
      DEBUG_LOG("[SD LIST] Full path: '%s'\n", fullPath.c_str());
      
      BT.write("{\"type\":\"");
      BT.write(isDir ? "dir" : "file");
      BT.write("\",\"name\":\"");
      BT.write(displayName.c_str());
      BT.write("\",\"path\":\"");
      BT.write(fullPath.c_str());
      BT.write("\",\"size\":");
      BT.write(String(entry.size()).c_str());
      BT.write("}");
      
      entry.close();
      count++;
    }
    
    BT.write("]\n");
    BT.write("[SD LIST] Complete. Listed ");
    BT.write(String(count).c_str());
    BT.write(" items\n");
    SERIAL_ECHO("[SD LIST] Complete. Listed ");
    SERIAL_ECHO(String(count).c_str());
    SERIAL_ECHOLN(" items");
    
    dir.close();
    return;
  }
  
  // If in sleep mode, only accept WAKE, STATUS, QUEUE, and SD commands
  if (sleepMode) {
    BT.write("Device is sleeping. Available commands: WAKE, STATUS, QUEUE, QUEUE UPDATE, QUEUE RESET, SD ON, SD OFF, SD STATUS, SD LIST\n");
    return;
  }
  
  if (cmd == "HELP") {
    BT.write("Available commands:\n");
    BT.write("  HELP - Show this help\n");
    BT.write("  STATUS - Show device status\n");
    BT.write("  QUEUE - Display current queue (queue.json)\n");
    BT.write("  QUEUE UPDATE - Add all new images to queue\n");
    BT.write("  QUEUE RESET - Delete queue and add all images\n");
    BT.write("  SD ON - Initialize and mount SD card\n");
    BT.write("  SD OFF - Unmount and release SD card\n");
    BT.write("  SD STATUS - Show SD card diagnostics\n");
    BT.write("  SD LIST [path] - List files in directory (default: /)\n");
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