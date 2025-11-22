#ifndef _BLUETOOTH_H_
#define _BLUETOOTH_H_

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <NimBLEServer.h>
#include <NimBLEService.h>
#include <NimBLECharacteristic.h>
#include <NimBLEAdvertising.h>

#define BLE_SERVICE_UUID        "6E400001-B5A3-F393-E0A9-E50E24DCCA9E" // UART service UUID
#define BLE_CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define BLE_CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

class BluetoothManager {
public:
    BluetoothManager();
    void begin(const char* deviceName);
    void end();
    bool isConnected();
    bool isEnabled();
    size_t write(const uint8_t* buffer, size_t size);
    size_t write(const char* str);
    int available();
    int read();
    String readString();
    void flush();
    
private:
    NimBLEServer* pServer;
    NimBLECharacteristic* pTxCharacteristic;
    NimBLECharacteristic* pRxCharacteristic;
    bool deviceConnected;
    bool enabled;
    String rxBuffer;
    
    class ServerCallbacks;
    class CharacteristicCallbacks;
    
    friend class ServerCallbacks;
    friend class CharacteristicCallbacks;
};

extern BluetoothManager BT;

#endif // _BLUETOOTH_H_
