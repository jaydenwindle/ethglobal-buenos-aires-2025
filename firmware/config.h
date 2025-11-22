#ifndef _CONFIG_H_
#define _CONFIG_H_

#include <stdio.h>
#include <string.h>
#include <FS.h>

#define WIFI_SSID_LEN 32
#define WIFI_PASSWD_LEN 64

#define EEPROM_SIZE 512
#define CONFIG_FILE "/SETUP.INI"

// Default AP credentials (used if not specified in SETUP.INI)
#define DEFAULT_AP_SSID "PERMA"
#define DEFAULT_AP_PASSWORD "FuturePrimitive"

typedef struct config_type
{
  unsigned char flag; // Was saved before?
  char ssid[32];
  char psw[64];
  char ap_ssid[32];
  char ap_psw[64];
}CONFIG_TYPE;

class Config	{
public:
  int loadFS();
	unsigned char load(FS* fs);
  char* ssid();
  void ssid(char* ssid);
  char* password();
  void password(char* password);
  char* apSSID();
  void apSSID(char* ssid);
  char* apPassword();
  void apPassword(char* password);
  void save(const char*ssid,const char*password);
  void save();
  int save_ip(const char *ip);
  void clear();

protected:
  CONFIG_TYPE data;
  FS* _fs;
};

extern Config config;

#endif
