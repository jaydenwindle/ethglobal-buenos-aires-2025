#include "bluetooth.h"
#include "serial.h"

BluetoothManager BT;

// Server callbacks
class BluetoothManager::ServerCallbacks: public NimBLEServerCallbacks {
    BluetoothManager* parent;
public:
    ServerCallbacks(BluetoothManager* p) : parent(p) {}
    
    void onConnect(NimBLEServer* pServer) {
        parent->deviceConnected = true;
        DEBUG_LOG("BLE Client connected\n");
    }
    
    void onDisconnect(NimBLEServer* pServer) {
        parent->deviceConnected = false;
        DEBUG_LOG("BLE Client disconnected\n");
        // Restart advertising
        NimBLEDevice::startAdvertising();
    }
};

// Characteristic callbacks
class BluetoothManager::CharacteristicCallbacks: public NimBLECharacteristicCallbacks {
    BluetoothManager* parent;
public:
    CharacteristicCallbacks(BluetoothManager* p) : parent(p) {}
    
    void onWrite(NimBLECharacteristic* pCharacteristic) {
        std::string value = pCharacteristic->getValue();
        if (value.length() > 0) {
            parent->rxBuffer += String(value.c_str());
            DEBUG_LOG("BLE RX: %s\n", value.c_str());
        }
    }
};

BluetoothManager::BluetoothManager() {
    pServer = nullptr;
    pTxCharacteristic = nullptr;
    pRxCharacteristic = nullptr;
    deviceConnected = false;
    enabled = false;
    rxBuffer = "";
}

void BluetoothManager::begin(const char* deviceName) {
    DEBUG_LOG("Initializing BLE: %s\n", deviceName);
    
    // Initialize NimBLE
    NimBLEDevice::init(deviceName);
    
    // Create BLE Server
    pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks(this));
    
    // Create BLE Service
    NimBLEService* pService = pServer->createService(BLE_SERVICE_UUID);
    
    // Create TX Characteristic (for sending data to client)
    pTxCharacteristic = pService->createCharacteristic(
        BLE_CHARACTERISTIC_UUID_TX,
        NIMBLE_PROPERTY::NOTIFY
    );
    
    // Create RX Characteristic (for receiving data from client)
    pRxCharacteristic = pService->createCharacteristic(
        BLE_CHARACTERISTIC_UUID_RX,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pRxCharacteristic->setCallbacks(new CharacteristicCallbacks(this));
    
    // Start the service
    pService->start();
    
    // Start advertising
    NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMaxPreferred(0x12);
    NimBLEDevice::startAdvertising();
    
    enabled = true;
    DEBUG_LOG("BLE initialized and advertising\n");
}

void BluetoothManager::end() {
    if (enabled) {
        NimBLEDevice::deinit(true);
        enabled = false;
        deviceConnected = false;
        DEBUG_LOG("BLE stopped\n");
    }
}

bool BluetoothManager::isConnected() {
    return enabled && deviceConnected;
}

bool BluetoothManager::isEnabled() {
    return enabled;
}

size_t BluetoothManager::write(const uint8_t* buffer, size_t size) {
    if (!enabled || !deviceConnected || !pTxCharacteristic) {
        return 0;
    }
    
    pTxCharacteristic->setValue(buffer, size);
    pTxCharacteristic->notify();
    return size;
}

size_t BluetoothManager::write(const char* str) {
    return write((const uint8_t*)str, strlen(str));
}

int BluetoothManager::available() {
    return rxBuffer.length();
}

int BluetoothManager::read() {
    if (rxBuffer.length() == 0) {
        return -1;
    }
    char c = rxBuffer.charAt(0);
    rxBuffer.remove(0, 1);
    return c;
}

String BluetoothManager::readString() {
    String result = rxBuffer;
    rxBuffer = "";
    return result;
}

void BluetoothManager::flush() {
    rxBuffer = "";
}
