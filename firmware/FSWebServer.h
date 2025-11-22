#ifndef _FSWEBSERVER_h_
#define _FSWEBSERVER_h_

#if defined(ARDUINO) && ARDUINO >= 100
    #include "Arduino.h"
#else
    #include "WProgram.h"
#endif

#ifdef ESP32
#include <WiFi.h>
#include <AsyncTCP.h>
// Compatibility for ESP32 Core 3.x
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
#include <NetworkInterface.h>
#endif
#elif defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESPAsyncTCP.h>
#include <ESP8266mDNS.h>
#endif
#include <WiFiClient.h>
#include <ESPAsyncWebServer.h>
#include <SPIFFS.h>
#include <Ticker.h>
// #include <ArduinoOTA.h>  // Not used, excluded in platformio.ini
#include <ArduinoJson.h>

#define CONNECTION_LED -1 // Connection LED pin (Built in). -1 to disable
#define AP_ENABLE_BUTTON 5 // Button pin to enable AP during startup for configuration. -1 to disable

typedef struct {
    String ssid;
    String password;
    IPAddress  ip;
    IPAddress  netmask;
    IPAddress  gateway;
    IPAddress  dns;
    bool dhcp;
    String ntpServerName;
    long updateNTPTimeEvery;
    long timezone;
    bool daylight;
    String deviceName;
} strConfig;

typedef struct {
    String APssid = "ESP"; // ChipID is appended to this name
    String APpassword = "12345678";
    bool APenable = false; // AP disabled by default
} strApConfig;

typedef struct {
    bool auth;
    String wwwUsername;
    String wwwPassword;
} strHTTPAuth;

class FSWebServer : public AsyncWebServer {
public:
    FSWebServer(uint16_t port);
    void begin(FS* fs);
    void handle();

protected:
    FS* _fs;
    void onHttpRelinquish(AsyncWebServerRequest *request);
    void onHttpList(AsyncWebServerRequest *request);
    bool onHttpNotFound(AsyncWebServerRequest *request);
    void onHttpDelete(AsyncWebServerRequest *request);
    void onHttpDownload(AsyncWebServerRequest *request);
    bool handleFileRead(String path, AsyncWebServerRequest *request);
    bool handleFileReadSD(String path, AsyncWebServerRequest *request);
    void onHttpFileUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final);
    void onHttpWifiConnect(AsyncWebServerRequest *request);
    void onHttpWifiScan(AsyncWebServerRequest * request);
    void onHttpWifiStatus(AsyncWebServerRequest *request);
    void onHttpWifiAP(AsyncWebServerRequest *request);
    void onHttpWifiList(AsyncWebServerRequest *request);
    void onHttpBTStatus(AsyncWebServerRequest *request);
};

extern FSWebServer server;

#endif // _FSWEBSERVER_h_