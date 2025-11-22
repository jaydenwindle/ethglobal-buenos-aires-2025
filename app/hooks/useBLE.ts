import { useState, useEffect, useRef } from "react";
import { BleManager, Device, State } from "react-native-ble-plx";
import { Alert } from "react-native";
import { Buffer } from "buffer";
import WifiManager from "react-native-wifi-reborn";
import { logger } from "../services/logger";

// UUIDs from the ESP32 device (Nordic UART Service)
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; // Write to ESP32
const TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; // Notify from ESP32

const DEVICE_NAME = "digicam-001";

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
  const [wifiCredentials, setWifiCredentials] = useState<{ ssid: string; password: string } | null>(null);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiConnected, setWifiConnected] = useState(false);
  const pendingCommandRef = useRef<string | null>(null);

  const addLog = (type: BLELog["type"], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, type, message }]);
    console.log(`[BLE ${type}] ${message}`);
  };

  // Subscribe to logger events
  useEffect(() => {
    const handleLoggerEvent = (log: { timestamp: string; type: BLELog["type"]; message: string }) => {
      setLogs((prev) => [...prev, log]);
    };

    logger.addListener(handleLoggerEvent);

    return () => {
      logger.removeListener(handleLoggerEvent);
    };
  }, []);

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

  // Connect to WiFi network
  const connectToWifi = async (ssid: string, password: string) => {
    setWifiConnecting(true);
    setWifiConnected(false);
    addLog("info", `Connecting to WiFi: ${ssid}...`);

    try {
      await WifiManager.connectToProtectedSSID(ssid, password, false, false);
      addLog("success", `Connected to WiFi: ${ssid}`);
      setWifiConnected(true);
      Alert.alert("WiFi Connected", `Successfully connected to ${ssid}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || "Unknown error";
      addLog("error", `WiFi connection failed: ${errorMessage}`);

      let userMessage = "Failed to connect to WiFi network.";
      if (errorMessage.includes("userDenied")) {
        userMessage = "User denied WiFi connection permission.";
      } else if (errorMessage.includes("locationPermissionDenied")) {
        userMessage = "Location permission is required for WiFi connection.";
      } else if (errorMessage.includes("invalidSSID")) {
        userMessage = "Invalid WiFi network name.";
      } else if (errorMessage.includes("invalidPassphrase")) {
        userMessage = "Incorrect WiFi password.";
      }

      Alert.alert("WiFi Connection Failed", userMessage);
    } finally {
      setWifiConnecting(false);
    }
  };

  // Parse WiFi credentials from received data (for WAKE command)
  const parseWifiCredentials = (data: string) => {
    const lines = data.split("\n").filter(line => line.trim().length > 0);

    // Look for SSID and password (should be first two non-empty lines after WAKE)
    if (lines.length >= 2) {
      const ssid = lines[0].trim();
      const password = lines[1].trim();

      // Basic validation - SSID shouldn't look like a status message
      if (ssid && password && !ssid.includes("===") && !ssid.toLowerCase().includes("device")) {
        addLog("success", `WiFi credentials received - SSID: ${ssid}`);
        setWifiCredentials({ ssid, password });
        return true;
      }
    }
    return false;
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
            setReceivedData((prev) => {
              const newData = prev + decodedValue;

              // If we just sent a WAKE command, try to parse credentials
              if (pendingCommandRef.current === "WAKE") {
                // Give it a moment to receive all data
                setTimeout(() => {
                  if (parseWifiCredentials(newData)) {
                    pendingCommandRef.current = null;
                  }
                }, 500);
              }

              return newData;
            });
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

      // Clear previous received data and WiFi state
      setReceivedData("");
      setWifiCredentials(null);
      setWifiConnected(false);

      // Track pending command for WAKE
      const upperCommand = command.toUpperCase().trim();
      if (upperCommand === "WAKE") {
        pendingCommandRef.current = "WAKE";
      } else {
        pendingCommandRef.current = null;
      }

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
      pendingCommandRef.current = null;
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

        // Clear WiFi credentials and connection state
        setWifiCredentials(null);
        setWifiConnected(false);
        setWifiConnecting(false);

        addLog("success", "Disconnected successfully");
        addLog("info", "WiFi credentials cleared");
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
    wifiCredentials,
    wifiConnecting,
    wifiConnected,
    scanForDevices,
    sendCommand,
    connectToWifi,
    disconnect,
    clearLogs,
  };
};
