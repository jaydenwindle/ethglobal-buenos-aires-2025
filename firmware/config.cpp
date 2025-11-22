#include <SPI.h>
#include <EEPROM.h>
#include "pins.h"
#include "config.h"
#include "serial.h"

int Config::loadFS() {
  SERIAL_ECHOLN("Going to load config from INI file");

  File file = _fs->open(CONFIG_FILE, "r");
	if (!file) {
		SERIAL_ECHOLN("Failed to open config file");
		return -1;
	}

  // Initialize AP and BT credentials with defaults
  strncpy(data.ap_ssid, DEFAULT_AP_SSID, WIFI_SSID_LEN);
  strncpy(data.ap_psw, DEFAULT_AP_PASSWORD, WIFI_PASSWD_LEN);
  strncpy(data.bt_ssid, DEFAULT_BT_SSID, WIFI_SSID_LEN);

  // Get SSID and PASSWORD from file
  int rst = 0,step = 0;
  String buffer,sKEY,sValue;
  while (file.available()) { // check for EOF
    buffer = file.readStringUntil('\n');
    if(buffer.length() == 0) continue; // Empty line
    buffer.replace("\r", ""); // Delete all CR
    
    // Skip comment lines
    if(buffer.startsWith("#")) continue;
    
    int iS = buffer.indexOf('='); // Get the seperator
    if(iS < 0) continue; // Bad line
    sKEY = buffer.substring(0,iS);
    sValue = buffer.substring(iS+1);
    
    if(sKEY == "SSID") {
      SERIAL_ECHOLN("INI file : SSID found");
      if(sValue.length()>0) {
        memset(data.ssid,'\0',WIFI_SSID_LEN);
        sValue.toCharArray(data.ssid,WIFI_SSID_LEN);
        step++;
      }
    }
    else if(sKEY == "PASSWORD") {
      SERIAL_ECHOLN("INI file : PASSWORD found");
      if(sValue.length()>0) {
        memset(data.psw,'\0',WIFI_PASSWD_LEN);
        sValue.toCharArray(data.psw,WIFI_PASSWD_LEN);
        step++;
      }
    }
    else if(sKEY == "AP_SSID") {
      SERIAL_ECHOLN("INI file : AP_SSID found");
      if(sValue.length()>0) {
        memset(data.ap_ssid,'\0',WIFI_SSID_LEN);
        sValue.toCharArray(data.ap_ssid,WIFI_SSID_LEN);
      }
    }
    else if(sKEY == "AP_PASSWORD") {
      SERIAL_ECHOLN("INI file : AP_PASSWORD found");
      if(sValue.length()>0) {
        memset(data.ap_psw,'\0',WIFI_PASSWD_LEN);
        sValue.toCharArray(data.ap_psw,WIFI_PASSWD_LEN);
      }
    }
    else if(sKEY == "BT_SSID") {
      SERIAL_ECHOLN("INI file : BT_SSID found");
      if(sValue.length()>0) {
        memset(data.bt_ssid,'\0',WIFI_SSID_LEN);
        sValue.toCharArray(data.bt_ssid,WIFI_SSID_LEN);
      }
    }
  }
  
  file.close();
  
  // Station credentials are optional - if not provided, device will start in AP mode
  if(step == 2) {
    SERIAL_ECHOLN("Station credentials loaded from INI file");
    return 0; // Success - will try to connect to station
  } else if(step == 0) {
    SERIAL_ECHOLN("No station credentials in INI file - will start in AP mode");
    return -1; // No station credentials - start AP mode
  } else {
    SERIAL_ECHOLN("Incomplete station credentials in INI file");
    return -4; // Incomplete credentials
  }

  return rst;
}

unsigned char Config::load(FS* fs) {
  _fs = fs;

  // Initialize AP and BT credentials with defaults first
  strncpy(data.ap_ssid, DEFAULT_AP_SSID, WIFI_SSID_LEN);
  strncpy(data.ap_psw, DEFAULT_AP_PASSWORD, WIFI_PASSWD_LEN);
  strncpy(data.bt_ssid, DEFAULT_BT_SSID, WIFI_SSID_LEN);

  SERIAL_ECHOLN("Going to load config from EEPROM");

  EEPROM.begin(EEPROM_SIZE);
  uint8_t *p = (uint8_t*)(&data);
  for (int i = 0; i < sizeof(data); i++)
  {
    *(p + i) = EEPROM.read(i);
  }
  EEPROM.commit();

  if(data.flag) {
    SERIAL_ECHOLN("Going to use the old network config");
    // Ensure AP and BT credentials are set if not in EEPROM
    if(strlen(data.ap_ssid) == 0) {
      strncpy(data.ap_ssid, DEFAULT_AP_SSID, WIFI_SSID_LEN);
    }
    if(strlen(data.ap_psw) == 0) {
      strncpy(data.ap_psw, DEFAULT_AP_PASSWORD, WIFI_PASSWD_LEN);
    }
    if(strlen(data.bt_ssid) == 0) {
      strncpy(data.bt_ssid, DEFAULT_BT_SSID, WIFI_SSID_LEN);
    }
    return data.flag;
  }

  // Try to get the config from ini file
  if(0 == loadFS())
  {
    return 1; // Return as connected before
  }
  
  return 0;
}

char* Config::ssid() {
  return data.ssid;
}

void Config::ssid(char* ssid) {
  if(ssid == NULL) return;
  strncpy(data.ssid,ssid,WIFI_SSID_LEN);
}

char* Config::password() {
  return data.psw;
}

void Config::password(char* password) {
  if(password == NULL) return;
  strncpy(data.psw,password,WIFI_PASSWD_LEN);
}

char* Config::apSSID() {
  return data.ap_ssid;
}

void Config::apSSID(char* ssid) {
  if(ssid == NULL) return;
  strncpy(data.ap_ssid,ssid,WIFI_SSID_LEN);
}

char* Config::apPassword() {
  return data.ap_psw;
}

void Config::apPassword(char* password) {
  if(password == NULL) return;
  strncpy(data.ap_psw,password,WIFI_PASSWD_LEN);
}

char* Config::btSSID() {
  return data.bt_ssid;
}

void Config::btSSID(char* ssid) {
  if(ssid == NULL) return;
  strncpy(data.bt_ssid,ssid,WIFI_SSID_LEN);
}

void Config::save(const char*ssid,const char*password) {
  if(ssid ==NULL || password==NULL)
    return;

  EEPROM.begin(EEPROM_SIZE);
  data.flag = 1;
  strncpy(data.ssid, ssid, WIFI_SSID_LEN);
  strncpy(data.psw, password, WIFI_PASSWD_LEN);
  uint8_t *p = (uint8_t*)(&data);
  for (int i = 0; i < sizeof(data); i++)
  {
    EEPROM.write(i, *(p + i));
  }
  EEPROM.commit();
}

void Config::save() {
  if(data.ssid == NULL || data.psw == NULL)
    return;

  EEPROM.begin(EEPROM_SIZE);
  data.flag = 1;
  uint8_t *p = (uint8_t*)(&data);
  for (int i = 0; i < sizeof(data); i++)
  {
    EEPROM.write(i, *(p + i));
  }
  EEPROM.commit();
}

void Config::clear() {

  EEPROM.begin(EEPROM_SIZE);
  data.flag = 0;
  for (int i = 0; i < EEPROM_SIZE; i++)
  {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
}

Config config;
