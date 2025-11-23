#ifndef _SD_CONTROL_H_
#define _SD_CONTROL_H_

#define SPI_BLOCKOUT_PERIOD	10UL // Second

// Uncomment this line if SD switch circuit is not working on custom board
// This will bypass the switch and assume SD card is always connected to ESP32
#define DISABLE_SD_SWITCH

// Uncomment this line to use SD_MMC mode instead of SPI mode
// SD_MMC is MORE STABLE and doesn't need SD_SWITCH_PIN
// Requires pins: CMD=15, CLK=14, D0=2, D1=4, D2=12, D3=13
// NOTE: Cannot share SD card with printer in this mode
#define USE_SD_MMC

class SDControl {
public:
  SDControl() { }
  static void setup();
  static void takeControl();
  static void takeControlLowPower(); // Power-optimized version for downloads
  static void relinquishControl();
  static int canWeTakeControl();
  static bool wehaveControl();
  static bool printerRequest();
  void deleteFile(String path);

private:
  static volatile long _spiBlockoutTime;
  static bool _weTookBus;
  static volatile bool _printerRequest;
};

extern SDControl sdcontrol;

#endif
