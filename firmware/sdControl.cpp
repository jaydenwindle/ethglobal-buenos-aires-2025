#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <SD_MMC.h>
#include "sdControl.h"
#include "pins.h"
#include "serial.h"

volatile long SDControl::_spiBlockoutTime = 0;
bool SDControl::_weTookBus = false;
volatile bool SDControl::_printerRequest = false;

void SDControl::setup() {
  // ----- GPIO -------
	// Detect when other master uses SD card
	// pinMode(CS_SENSE, INPUT_PULLUP);
	pinMode(SD_SWITCH_PIN, OUTPUT);
	#ifdef SD_POWER_PIN
	  pinMode(SD_POWER_PIN, OUTPUT);
	#endif
	_spiBlockoutTime = millis();
	attachInterrupt(CS_SENSE, []() {
		if(!_weTookBus) {
			_spiBlockoutTime = millis() + SPI_BLOCKOUT_PERIOD;
			//SERIAL_ECHOPAIR("Printer take:",_spiBlockoutTime);
			//SERIAL_ECHOLNPAIR(",", millis());
			// _printerRequest = true;
		} else {
			_spiBlockoutTime = millis();
		}
	}, CHANGE);

	//sdcontrol.relinquishControl();
	digitalWrite(SD_SWITCH_PIN,HIGH);
	#ifdef SD_POWER_PIN
	  digitalWrite(SD_POWER_PIN,LOW);
	#endif

	// NOTE: WE DISABLE THIS FOR DIGICAM

	/*
	// Wait for other master to assert SD card first
	for (int i=0; i<SPI_BLOCKOUT_PERIOD; i++)
	{
		delay(1000);
		LOG("Wait for printer to assert SD card first.\n");
		// if(_printerRequest) { 
		// 	_printerRequest = false; 
		// 	LOG("Printer Request.\n");
		// 	break;
		// }
	}
	*/
}

// ------------------------
void SDControl::takeControl()	{
// ------------------------
	if(_weTookBus) return; // We already have control

	_weTookBus = true;
 
	digitalWrite(SD_SWITCH_PIN,LOW); // Switch SD pins to ESP32
	delay(100); // Increased delay for SD card to settle

	SPI.begin(SD_SCLK_PIN,SD_MISO_PIN,SD_MOSI_PIN,SD_CS_PIN);

	int cnt = 0;
	bool sdInitialized = false;
	while(cnt < 5) {
		if(SD.begin(SD_CS_PIN)) {
			sdInitialized = true;
			DEBUG_LOG("SD card initialized on attempt %d\n", cnt + 1);
			break;
		}
		DEBUG_LOG("SD init attempt %d failed\n", cnt + 1);
		delay(500);
		cnt++;
	}
	
	if(!sdInitialized) {
		DEBUG_LOG("SD card initialization failed after 5 attempts\n");
	}
  
	DEBUG_LOG("takeControl\n");
}

// Power-optimized version for file transfers
void SDControl::takeControlLowPower()	{
	if(_weTookBus) return; // We already have control

	_weTookBus = true;
 
	#ifdef SD_POWER_PIN
	  // Power on SD card if power control is available
	  digitalWrite(SD_POWER_PIN, HIGH);
	  delay(100); // Wait for SD card to power up
	#endif
	
	digitalWrite(SD_SWITCH_PIN,LOW); // Switch SD pins to ESP32
	delay(50);

	// Use lower SPI frequency for power savings (10MHz instead of default 25MHz)
	SPI.begin(SD_SCLK_PIN,SD_MISO_PIN,SD_MOSI_PIN,SD_CS_PIN);
	SPI.setFrequency(10000000); // 10 MHz - reduces power by ~30%

	int cnt = 0;
	while((!SD.begin(SD_CS_PIN)&&(cnt<5))) {
		delay(500);
		cnt++;
	}
  
	DEBUG_LOG("takeControlLowPower\n");
}

// ------------------------
void SDControl:: relinquishControl()	{
	pinMode(SD_D0_PIN,  INPUT_PULLUP);
	pinMode(SD_D1_PIN,  INPUT_PULLUP);
	pinMode(SD_D2_PIN,  INPUT_PULLUP);
	pinMode(SD_D3_PIN,  INPUT_PULLUP);
	pinMode(SD_CLK_PIN, INPUT_PULLUP);
	pinMode(SD_CMD_PIN, INPUT_PULLUP);

	SD.end();
	SPI.end();

	digitalWrite(SD_SWITCH_PIN,HIGH);
	delay(50);

	_weTookBus = false;

	DEBUG_LOG("relinquishControl\n");
}

int SDControl::canWeTakeControl() {
	if(_weTookBus) return 0;

	if(millis() < _spiBlockoutTime) {
		SERIAL_ECHOPAIR("Blocking:",_spiBlockoutTime);
		SERIAL_ECHOLNPAIR(",", millis());
		return -1;
	}
	return 0;
}

bool SDControl::wehaveControl() {
	return _weTookBus;
}

bool SDControl::printerRequest() {
	return _printerRequest;
}

void SDControl::deleteFile(String path)
{
  File file = SD.open((char *)path.c_str());
  if(!file) {
    DEBUG_LOG("Open file fail\n");
    return;
  }
  if (!file.isDirectory()) 
  {
    file.close();
    SD.remove((char *)path.c_str());
  }
}

SDControl sdcontrol;