import { useState, useEffect, useRef } from "react";
import { BleManager, Device, State } from "react-native-ble-plx";
import { Alert } from "react-native";
import { Buffer } from "buffer";

// UUIDs from the ESP32 device (Nordic UART Service)
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; // Write to ESP32
const TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; // Notify from ESP32

const DEVICE_NAME = "ESP32-SD-WiFi";

export interface BLELog {
  timestamp: string;
  type: "info" | "success" | "error" | "data";
  message: string;
}

export const useBLE = () => {
  const bleManagerRef = useRef<BleManager | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [bluetoothState, setBluetoothState] = useState<State>(State.Unknown);
  const [logs, setLogs] = useState<BLELog[]>([]);
  const [receivedData, setReceivedData] = useState<string>("");

  const addLog = (type: BLELog["type"], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, type, message }]);
    console.log(`[BLE ${type}] ${message}`);
  };

  // Initialize BLE Manager
  useEffect(() => {
    try {
      bleManagerRef.current = new BleManager();

      // Subscribe to bluetooth state
      const subscription = bleManagerRef.current.onStateChange((state) => {
        setBluetoothState(state);
        addLog("info", `Bluetooth state: ${state}`);

        if (state === State.PoweredOn) {
          addLog("success", "Bluetooth is ready");
        }
      }, true);

      addLog("info", "BLE Manager initialized");

      return () => {
        subscription.remove();
        if (bleManagerRef.current) {
          bleManagerRef.current.destroy();
          addLog("info", "BLE Manager destroyed");
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addLog("error", `Failed to initialize BLE Manager: ${errorMessage}`);
      addLog("info", "Make sure you're running on a physical device with a development build");
    }
  }, []);

  // Scan for devices
  const scanForDevices = async () => {
    if (!bleManagerRef.current) {
      addLog("error", "BLE Manager not initialized");
      return;
    }

    if (bluetoothState !== State.PoweredOn) {
      addLog("error", `Bluetooth not ready. State: ${bluetoothState}`);
      Alert.alert("Bluetooth Required", "Please enable Bluetooth to scan for devices");
      return;
    }

    setIsScanning(true);
    addLog("info", `Scanning for ${DEVICE_NAME}...`);

    bleManagerRef.current.startDeviceScan(
      null,
      { allowDuplicates: false },
      (error, scannedDevice) => {
        if (error) {
          addLog("error", `Scan error: ${error.message}`);
          setIsScanning(false);
          return;
        }

        if (scannedDevice?.name === DEVICE_NAME) {
          addLog("success", `Found ${DEVICE_NAME}! ID: ${scannedDevice.id}`);
          bleManagerRef.current?.stopDeviceScan();
          setIsScanning(false);
          connectToDevice(scannedDevice);
        }
      }
    );

    // Stop scanning after 10 seconds if device not found
    setTimeout(() => {
      if (isScanning) {
        bleManagerRef.current?.stopDeviceScan();
        setIsScanning(false);
        addLog("error", "Scan timeout - device not found");
        Alert.alert("Device Not Found", `Could not find ${DEVICE_NAME}. Make sure it's powered on and nearby.`);
      }
    }, 10000);
  };

  // Connect to device
  const connectToDevice = async (deviceToConnect: Device) => {
    try {
      addLog("info", `Connecting to ${deviceToConnect.name}...`);

      const connectedDevice = await deviceToConnect.connect();
      setDevice(connectedDevice);
      addLog("success", "Connected!");

      addLog("info", "Discovering services and characteristics...");
      await connectedDevice.discoverAllServicesAndCharacteristics();
      addLog("success", "Services discovered");

      setIsConnected(true);

      // Monitor connection
      connectedDevice.onDisconnected((error) => {
        setIsConnected(false);
        setDevice(null);
        if (error) {
          addLog("error", `Disconnected with error: ${error.message}`);
        } else {
          addLog("info", "Disconnected");
        }
      });

      // Subscribe to notifications
      await startNotifications(connectedDevice);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addLog("error", `Connection failed: ${errorMessage}`);
      Alert.alert("Connection Failed", errorMessage);
    }
  };

  // Start listening for notifications
  const startNotifications = async (connectedDevice: Device) => {
    try {
      addLog("info", "Starting notifications...");

      connectedDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            addLog("error", `Notification error: ${error.message}`);
            return;
          }

          if (characteristic?.value) {
            // Decode base64 value
            const decodedValue = Buffer.from(characteristic.value, "base64").toString("utf-8");
            addLog("data", `Received: ${decodedValue}`);
            setReceivedData((prev) => prev + decodedValue);
          }
        }
      );

      addLog("success", "Notifications enabled");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addLog("error", `Failed to start notifications: ${errorMessage}`);
    }
  };

  // Send command
  const sendCommand = async (command: string) => {
    if (!device || !isConnected) {
      addLog("error", "Not connected to device");
      Alert.alert("Not Connected", "Please connect to the device first");
      return;
    }

    try {
      addLog("info", `Sending command: ${command}`);

      // Clear previous received data
      setReceivedData("");

      // Encode command to base64
      const base64Command = Buffer.from(command).toString("base64");

      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        RX_CHARACTERISTIC_UUID,
        base64Command
      );

      addLog("success", `Command sent: ${command}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addLog("error", `Failed to send command: ${errorMessage}`);
      Alert.alert("Send Failed", errorMessage);
    }
  };

  // Disconnect
  const disconnect = async () => {
    if (device) {
      try {
        addLog("info", "Disconnecting...");
        await device.cancelConnection();
        setDevice(null);
        setIsConnected(false);
        addLog("success", "Disconnected successfully");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        addLog("error", `Disconnect failed: ${errorMessage}`);
      }
    }
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    addLog("info", "Logs cleared");
  };

  return {
    device,
    isConnected,
    isScanning,
    bluetoothState,
    logs,
    receivedData,
    scanForDevices,
    sendCommand,
    disconnect,
    clearLogs,
  };
};
