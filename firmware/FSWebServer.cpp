#include "FSWebServer.h"
#include "sdControl.h"
#include <SPI.h>
#include <SD.h>
#include <StreamString.h>
#include "serial.h"
#include "network.h"
#include "config.h"
#include "bluetooth.h"

// Debug control - set to false for production (eliminates all debug overhead)
constexpr bool ENABLE_VERBOSE_LOGGING = false;

const char* PARAM_MESSAGE = "message";
uint8_t printer_sd_type = 0;

FSWebServer server(80);

FSWebServer::FSWebServer(uint16_t port) : AsyncWebServer(port) {}

void FSWebServer::begin(FS* fs) {
    _fs = fs;

    // Configure server timeouts for large file transfers
    // Default timeout is too short for files > 1MB
    AsyncWebServer::begin();
    
    // Note: AsyncWebServer doesn't have a direct timeout setting
    // The timeout is controlled by AsyncTCP library
    // We'll handle this at the TCP level in platformio.ini

    server.on("/relinquish", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpRelinquish(request);
  	});

    // Linux-style command endpoints
    server.on("/ls", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpList(request);
  	});

    server.on("/rm", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpDelete(request);
  	});

  	server.on("/cat", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpDownload(request);
  	});

  	server.on("/dd", HTTP_POST, [](AsyncWebServerRequest *request) { 
  	  request->send(200, "text/plain", ""); },[this](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
		  this->onHttpFileUpload(request, filename, index, data, len, final);
	  });

    // Legacy endpoints for backward compatibility
    server.on("/list", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpList(request);
  	});

    server.on("/delete", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpDelete(request);
  	});

  	server.on("/download", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpDownload(request);
  	});

  	server.on("/upload", HTTP_POST, [](AsyncWebServerRequest *request) { 
  	  request->send(200, "text/plain", ""); },[this](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
		  this->onHttpFileUpload(request, filename, index, data, len, final);
	  });

    server.on("/wifiap", HTTP_POST, [this](AsyncWebServerRequest *request) {
  		this->onHttpWifiAP(request);
  	});

    server.on("/wificonnect", HTTP_POST, [this](AsyncWebServerRequest *request) {
  		this->onHttpWifiConnect(request);
  	});

    server.on("/wifistatus", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpWifiStatus(request);
  	});
    
    server.on("/wifiscan", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpWifiScan(request);
  	});

    server.on("/wifilist", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpWifiList(request);
  	});

    server.on("/btstatus", HTTP_GET, [this](AsyncWebServerRequest *request) {
  		this->onHttpBTStatus(request);
  	});

	  server.onNotFound([this](AsyncWebServerRequest *request) {
      this->onHttpNotFound(request);
    });
}

String getContentType(String filename, AsyncWebServerRequest *request) {
  if (request->hasArg("download")) return "application/octet-stream";
  
  // Find extension using pointer arithmetic (much faster than endsWith)
  const char* ext = strrchr(filename.c_str(), '.');
  if (!ext) return "text/plain";
  
  // Use direct strcmp instead of String operations
  // Ordered by most common file types first for faster average lookup
  if (strcmp(ext, ".json") == 0) return "application/json";
  if (strcmp(ext, ".png") == 0) return "image/png";
  if (strcmp(ext, ".jpg") == 0 || strcmp(ext, ".jpeg") == 0) return "image/jpeg";
  if (strcmp(ext, ".gif") == 0) return "image/gif";
  if (strcmp(ext, ".ico") == 0) return "image/x-icon";
  // if (strcmp(ext, ".xml") == 0) return "text/xml";
  // if (strcmp(ext, ".pdf") == 0) return "application/x-pdf";
  // if (strcmp(ext, ".zip") == 0) return "application/x-zip";
  // if (strcmp(ext, ".gz") == 0) return "application/x-gzip";
  if (strcmp(ext, ".htm") == 0 || strcmp(ext, ".html") == 0) return "text/html";
  if (strcmp(ext, ".js") == 0) return "application/javascript";
  if (strcmp(ext, ".css") == 0) return "text/css";
  
  return "text/plain";
}

void FSWebServer::onHttpWifiAP(AsyncWebServerRequest *request) {
  Serial.println("onHttpWifiAP");
  if(network.isSTAmode()) {
    request->send(200, "text/plain", "WIFI:StartAPmode");
    network.startSoftAP();
  }
  else {
    request->send(200, "text/plain", "WIFI:AlreadyAPmode");
  }
}

void FSWebServer::onHttpWifiList(AsyncWebServerRequest *request) {
  String resp;
  network.getWiFiList(resp);
  request->send(200, "text/plain", resp);
}

void FSWebServer::onHttpWifiStatus(AsyncWebServerRequest *request) {
  DEBUG_LOG("onHttpWifiStatus\n");

  char resp[64];
  
  // Check if in AP mode or STA mode
  if (!network.isSTAmode()) {
    strcpy(resp, "WIFI:AP_Mode");
  } else {
    switch(network.status()) {
      case 1:
        strcpy(resp, "WIFI:Failed");
      break;
      case 2:
        strcpy(resp, "WIFI:Connecting");
      break;
      case 3:
        IPAddress ip = WiFi.localIP();
        snprintf(resp, sizeof(resp), "WIFI:Connected:%d.%d.%d.%d", 
                 ip[0], ip[1], ip[2], ip[3]);
      break;
    }
  }
  request->send(200, "text/plain", resp);
}

void FSWebServer::onHttpWifiConnect(AsyncWebServerRequest *request)
{
  String wifi_ssid,wifi_psd;
  if (request->hasArg("ssid"))
  {
    Serial.print("got ssid:");
    wifi_ssid = request->arg("ssid");
 
    Serial.println(wifi_ssid);
  } 
  else
  { 
    Serial.println("error, not found ssid");
    request->send(200, "text/plain", "WIFI:NoSSID");
    return;
  }

  if (request->hasArg("password")) 
  {
    Serial.print("got password:");
    wifi_psd = request->arg("password");
    Serial.println(wifi_psd);
  } 
  else 
  {
    Serial.println("error, not found password");
    request->send(200, "text/plain", "WIFI:NoPassword");
    return;
  }

  if(0==wifi_ssid.length() || 0==wifi_psd.length()) {
     request->send(200, "text/plain", "WIFI:WrongPara");
     return;
  }

  if(network.startConnect(wifi_ssid, wifi_psd)) {
    request->send(200, "text/plain", "WIFI:Starting");
  }
  else {
    char resp[64];
    IPAddress ip = WiFi.localIP();
    snprintf(resp, sizeof(resp), "WIFI:AlreadyCon:%d.%d.%d.%d", 
             ip[0], ip[1], ip[2], ip[3]);
    request->send(200, "text/plain", resp);
  }

  return;
}

void FSWebServer::onHttpWifiScan(AsyncWebServerRequest * request) {
    network.doScan();
    request->send(200, "text/json", "ok");
    return;
}

void FSWebServer::onHttpBTStatus(AsyncWebServerRequest *request) {
  DEBUG_LOG("onHttpBTStatus\n");

  String resp = "BT:";
  
  if (!BT.isEnabled()) {
    resp += "Disabled";
  } else if (BT.isConnected()) {
    resp += "Connected";
  } else {
    resp += "Ready";
  }
  
  request->send(200, "text/plain", resp);
}

bool FSWebServer::onHttpNotFound(AsyncWebServerRequest *request) {
  String path = request->url();
	DEBUG_LOG("handleFileRead: %s\r\n", path.c_str());

	if (path.endsWith("/"))
		path += "index.htm";

	String contentType = getContentType(path, request);
	String pathWithGz = path + ".gz";
	if (_fs->exists(pathWithGz) || _fs->exists(path)) {
		if (_fs->exists(pathWithGz)) {
			path += ".gz";
		}
		DEBUG_LOG("Content type: %s\r\n", contentType.c_str());
		AsyncWebServerResponse *response = request->beginResponse(*_fs, path, contentType);
		if (path.endsWith(".gz"))
			response->addHeader("Content-Encoding", "gzip");
		DEBUG_LOG("File %s exist\r\n", path.c_str());
		request->send(response);
		DEBUG_LOG("File %s Sent\r\n", path.c_str());

		return true;
	}
	else
		DEBUG_LOG("Cannot find %s\n", path.c_str());
	return false;
}

bool FSWebServer::handleFileReadSD(String path, AsyncWebServerRequest *request) {
	DEBUG_LOG("handleFileReadSD: %s\r\n", path.c_str());

	if (path.endsWith("/"))
		path += "index.htm";

	String contentType = getContentType(path, request);
	String pathWithGz = path + ".gz";
	sdcontrol.takeControl();
	if (SD.exists(pathWithGz) || SD.exists(path)) {
		if (SD.exists(pathWithGz)) {
			path += ".gz";
		}
		DEBUG_LOG("Content type: %s\r\n", contentType.c_str());
		AsyncWebServerResponse *response = request->beginResponse(SD, path, contentType);
		if (path.endsWith(".gz"))
			response->addHeader("Content-Encoding", "gzip");
		DEBUG_LOG("File %s exist\r\n", path.c_str());
		request->send(response);
		DEBUG_LOG("File %s Sent\r\n", path.c_str());

		return true;
	}
	else
		DEBUG_LOG("Cannot find %s\n", path.c_str());
	sdcontrol.relinquishControl();
	return false;
}

void FSWebServer::onHttpRelinquish(AsyncWebServerRequest *request) {
    sdcontrol.relinquishControl();
    request->send(200, "text/plain", "ok");
}

void FSWebServer::onHttpDownload(AsyncWebServerRequest *request) {
    if constexpr (ENABLE_VERBOSE_LOGGING) {
      SERIAL_ECHOLN("=== HTTP Download Request ===");
      DEBUG_LOG("Client: %s\n", request->client()->remoteIP().toString().c_str());
    }

    switch(sdcontrol.canWeTakeControl())
    { 
      case -1: {
        if constexpr (ENABLE_VERBOSE_LOGGING) {
          SERIAL_ECHOLN("ERROR: Printer controlling the SD card");
        }
        request->send(500, "text/plain","DOWNLOAD:SDBUSY");
      }
      return;
    
      default: break;
    }
  
    // Get path parameter
    if (!request->hasParam("path")) {
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHOLN("ERROR: No path parameter");
      }
      request->send(500, "text/plain","DOWNLOAD:BADARGS");
      return;
    }
    String path = request->getParam("path")->value();
    
    if constexpr (ENABLE_VERBOSE_LOGGING) {
      SERIAL_ECHO("Requested path: ");
      SERIAL_ECHOLN(path.c_str());
    }
    
    // Check for chunked download parameters
    bool isChunked = request->hasParam("chunk");
    int chunkNumber = 0;
    int chunkSize = 16384 * 4; // Default 16KB chunks - optimal for ESP32
    
    if (isChunked) {
      chunkNumber = request->getParam("chunk")->value().toInt();
      if (request->hasParam("size")) {
        chunkSize = request->getParam("size")->value().toInt();
        // Limit chunk size to reasonable range
        // if (chunkSize < 1024) chunkSize = 1024;
        // if (chunkSize > 32768) chunkSize = 32768;
      }
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHO("Mode: Chunked - chunk #");
        SERIAL_ECHO(String(chunkNumber).c_str());
        SERIAL_ECHO(", size: ");
        SERIAL_ECHO(String(chunkSize).c_str());
        SERIAL_ECHOLN(" bytes");
      }
    } else {
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHOLN("Mode: Full file download");
      }
    }

    sdcontrol.takeControl();
    
    if constexpr (ENABLE_VERBOSE_LOGGING) {
      SERIAL_ECHOLN("SD control acquired");
    }
    
    // Open file
    File file = SD.open(path.c_str());
    if (!file) {
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHO("ERROR: File not found: ");
        SERIAL_ECHOLN(path.c_str());
      }
      sdcontrol.relinquishControl();
      request->send(404, "text/plain", "DOWNLOAD:FileNotFound");
      return;
    }
    
    if (file.isDirectory()) {
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHOLN("ERROR: Path is a directory");
      }
      file.close();
      sdcontrol.relinquishControl();
      request->send(500, "text/plain", "DOWNLOAD:ISDIR");
      return;
    }
    
    size_t fileSize = file.size();
    String contentType = getContentType(path, request);
    
    if constexpr (ENABLE_VERBOSE_LOGGING) {
      SERIAL_ECHO("File opened: ");
      SERIAL_ECHO(String(fileSize).c_str());
      SERIAL_ECHO(" bytes, type: ");
      SERIAL_ECHOLN(contentType.c_str());
    }
    
    if (isChunked) {
      // Calculate chunk boundaries
      size_t startByte = chunkNumber * chunkSize;
      
      if (startByte >= fileSize) {
        // Chunk beyond file size
        if constexpr (ENABLE_VERBOSE_LOGGING) {
          SERIAL_ECHO("ERROR: Chunk ");
          SERIAL_ECHO(String(chunkNumber).c_str());
          SERIAL_ECHOLN(" beyond file size");
        }
        file.close();
        sdcontrol.relinquishControl();
        request->send(416, "text/plain", "DOWNLOAD:RANGE_NOT_SATISFIABLE");
        return;
      }
      
      size_t endByte = startByte + chunkSize - 1;
      if (endByte >= fileSize) {
        endByte = fileSize - 1;
      }
      size_t actualChunkSize = endByte - startByte + 1;
      
      // Calculate total chunks
      int totalChunks = (fileSize + chunkSize - 1) / chunkSize;
      
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHO("Sending chunk ");
        SERIAL_ECHO(String(chunkNumber).c_str());
        SERIAL_ECHO("/");
        SERIAL_ECHO(String(totalChunks).c_str());
        SERIAL_ECHO(": bytes ");
        SERIAL_ECHO(String(startByte).c_str());
        SERIAL_ECHO("-");
        SERIAL_ECHO(String(endByte).c_str());
        SERIAL_ECHO("/");
        SERIAL_ECHOLN(String(fileSize).c_str());
      }
      
      // Seek to start position
      file.seek(startByte);
      
      // Create response with chunk data
      AsyncWebServerResponse *response = request->beginResponse(
        contentType,
        actualChunkSize,
        [file, actualChunkSize](uint8_t *buffer, size_t maxLen, size_t index) mutable -> size_t {
          if (index >= actualChunkSize) {
            return 0; // Done
          }
          size_t toRead = actualChunkSize - index;
          if (toRead > maxLen) toRead = maxLen;
          return file.read(buffer, toRead);
        }
      );
      
      // Add chunked download headers
      response->setCode(206); // Partial Content
      char rangeHeader[64];
      snprintf(rangeHeader, sizeof(rangeHeader), "bytes %d-%d/%d", startByte, endByte, fileSize);
      response->addHeader("Content-Range", rangeHeader);
      response->addHeader("Content-Length", String(actualChunkSize));
      response->addHeader("X-Total-Chunks", String(totalChunks));
      response->addHeader("X-Chunk-Number", String(chunkNumber));
      response->addHeader("Access-Control-Allow-Origin", "*");
      response->addHeader("Access-Control-Expose-Headers", "Content-Range, X-Total-Chunks, X-Chunk-Number");
      
      request->send(response);
      
      // Cleanup happens in response callback
      request->onDisconnect([file]() mutable {
        file.close();
        sdcontrol.relinquishControl();
      });
      
    } else {
      // Send entire file (original behavior)
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHO("Sending entire file: ");
        SERIAL_ECHO(String(fileSize).c_str());
        SERIAL_ECHOLN(" bytes");
      }
      
      AsyncWebServerResponse *response = request->beginResponse(SD, path, contentType);
      response->addHeader("Connection", "close");
      response->addHeader("Access-Control-Allow-Origin", "*");
      response->addHeader("Content-Length", String(fileSize));
      
      request->send(response);
      
      file.close();
      sdcontrol.relinquishControl();
      
      if constexpr (ENABLE_VERBOSE_LOGGING) {
        SERIAL_ECHOLN("File sent, SD control released");
      }
    }
    
    if constexpr (ENABLE_VERBOSE_LOGGING) {
      SERIAL_ECHOLN("=== Download Complete ===");
    }
}

void FSWebServer::onHttpList(AsyncWebServerRequest * request) {

  switch(sdcontrol.canWeTakeControl())
  { 
    case -1: {
      DEBUG_LOG("Printer controlling the SD card\n"); 
      request->send(500, "text/plain","LIST:SDBUSY");
    }
    return;
  
    default: break;
  }

  int params = request->params();
  if (params == 0) {
    request->send(500, "text/plain","LIST:BADARGS");
    return;
  }
  const AsyncWebParameter* p = request->getParam((size_t)0);
  String path = p->value();
  
  DEBUG_LOG("List request for path: '%s'\n", path.c_str());

  sdcontrol.takeControl();
  
  // Ensure path starts with /
  if (path.length() == 0 || path[0] != '/') {
    path = "/" + path;
  }
  
  DEBUG_LOG("Opening path: '%s'\n", path.c_str());
  
  // Try to open the directory
  File dir = SD.open(path.c_str());
  
  if (!dir) {
    DEBUG_LOG("Failed to open path: '%s'\n", path.c_str());
    sdcontrol.relinquishControl();
    String errorMsg = "LIST:BADPATH:" + path;
    request->send(500, "text/plain", errorMsg);
    return;
  }
  
  if (!dir.isDirectory()) {
    DEBUG_LOG("Path is not a directory: %s\n", path.c_str());
    dir.close();
    sdcontrol.relinquishControl();
    request->send(500, "text/plain", "LIST:NOTDIR");
    return;
  }

  dir.rewindDirectory();
  
  // Use AsyncResponseStream for efficient streaming
  AsyncResponseStream *response = request->beginResponseStream("text/json");
  response->print("[");
  
  bool first = true;
  int count = 0;
  const int MAX_ITEMS = 200; // Reduced limit
  
  // Only list current directory (non-recursive)
  while (count < MAX_ITEMS) {
    File entry = dir.openNextFile();
    if (!entry) {
      break;
    }
    
    if (!first) {
      response->print(",");
    }
    first = false;
    
    bool isDir = entry.isDirectory();
    String entryName = String(entry.name());
    
    DEBUG_LOG("Entry: '%s' isDir=%d\n", entryName.c_str(), isDir);
    
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
    
    DEBUG_LOG("Full path: '%s'\n", fullPath.c_str());
    
    response->print("{\"type\":\"");
    response->print(isDir ? "dir" : "file");
    response->print("\",\"name\":\"");
    response->print(displayName);
    response->print("\",\"path\":\"");
    response->print(fullPath);
    response->print("\",\"size\":");
    response->print(entry.size());
    response->print("}");
    
    entry.close();
    count++;
  }
  
  response->print("]");
  request->send(response);
  
  dir.close();
  sdcontrol.relinquishControl();

  return;
}

void FSWebServer::onHttpDelete(AsyncWebServerRequest *request) {
  switch(sdcontrol.canWeTakeControl())
  { 
    case -1: {
      DEBUG_LOG("Printer controlling the SD card"); 
      request->send(500, "text/plain","DELETE:SDBUSY");
    }
    return;
  
    default: break;
  }

  Serial.println("onHttpDelete");
  if (!request->hasArg("path")) {
    request->send(500, "text/plain", "DELETE:BADARGS");
    Serial.println("no path arg");
  } 
  else {
    const AsyncWebParameter* p = request->getParam((size_t)0);
    String path = "/"+p->value();
    Serial.print("path:");
    Serial.println(path);

    sdcontrol.takeControl();
    if (path == "/" || !SD.exists((char *)path.c_str())) {
      request->send(500, "text/plain", "DELETE:BADPATH");
      Serial.println("path not exists");
    }
    else {
      sdcontrol.deleteFile(path);
      Serial.println("send ok");
      request->send(200, "text/plain", "ok");
    }
    sdcontrol.relinquishControl();
  }
}

void FSWebServer::onHttpFileUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final){
  static File uploadFile;

  if (request->url() != "/upload") {
    DEBUG_LOG("Upload bad args"); 
    request->send(500, "text/plain","UPLOAD:BADARGS");
    return;
  }

  switch(sdcontrol.canWeTakeControl())
  { 
    case -1: {
      DEBUG_LOG("Printer controlling the SD card\n"); 
      request->send(500, "text/plain","UPLOAD:SDBUSY");
    }
    return;

    default: break;
  }

  if (!index) { // start
    sdcontrol.takeControl();
    if(uploadFile){
        uploadFile.close();
    }

    if (SD.exists((char *)filename.c_str())) {
      SD.remove((char *)filename.c_str());
    }

    uploadFile = SD.open(filename.c_str(), FILE_WRITE);
    if(!uploadFile) {
      request->send(500, "text/plain", "UPLOAD:OPENFAILED");
      sdcontrol.relinquishControl();
      DEBUG_LOG("Upload: Open file failed: %s \n",filename.c_str());
    } else {
      DEBUG_LOG("Upload: First upload part: %s \n",filename.c_str());
    }
  } 

  if (len) { // Continue
    if(len != uploadFile.write(data, len)){
      DEBUG_LOG("Upload: write error\n");  
    }
    DEBUG_LOG("Upload: written: %d bytes\n",len);
  }

  if (final) {  // End
    if (uploadFile) {
      uploadFile.close();
    }
    DEBUG_LOG("Upload End\n");
    sdcontrol.relinquishControl();
  }
}

