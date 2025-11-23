import React, { useRef } from "react";
import { useMachine } from "@xstate/react";
import { setup, fromPromise, assign, fromCallback } from "xstate";
import { BleManager, Device, State, Subscription } from "react-native-ble-plx";
import { Buffer } from "buffer";
import { logger } from "../services/logger";
import WifiManager from "react-native-wifi-reborn";
import { SDCardAPI, FileEntry } from "../services/sdcard";

const DEVICE_NAME = "digicam-001";
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
const TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

interface FileSyncContext {
  error: string | null;
  device: Device | null;
  receivedData: string;
  wifiSsid: string | null;
  wifiPassword: string | null;
  deviceIpAddress: string;
  files: FileEntry[];
  downloadedFileUri: string | null;
}

type FileSyncEvent =
  | { type: "START" }
  | { type: "DATA_RECEIVED"; data: string }
  | { type: "WIFI_CREDENTIALS_PARSED" }
  | { type: "USER_CONFIRM_WIFI" }
  | { type: "USER_CANCEL_WIFI" }
  | { type: "CANCEL" }
  | { type: "RETRY" };

// Actor: Scan for device and connect
const scanAndConnectActor = fromPromise<Device, { bleManager: BleManager; deviceName: string }>(
  async ({ input }) => {
    const { bleManager, deviceName } = input;

    return new Promise((resolve, reject) => {
      logger.info(`Scanning for ${deviceName}...`);
      let isResolved = false;

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try {
            bleManager.stopDeviceScan();
          } catch (e) {
            logger.error("Failed to stop scan");
          }
          reject(new Error(`Timeout: ${deviceName} not found after 30 seconds`));
        }
      }, 30000);

      try {
        bleManager.startDeviceScan(null, { allowDuplicates: false }, async (error, scannedDevice) => {
          if (isResolved) return;

          if (error) {
            isResolved = true;
            clearTimeout(timeout);
            try {
              bleManager.stopDeviceScan();
            } catch (e) {
              logger.error("Failed to stop scan");
            }
            reject(new Error(`Scan error: ${error.message}`));
            return;
          }

          if (scannedDevice?.name === deviceName) {
            isResolved = true;
            clearTimeout(timeout);
            try {
              bleManager.stopDeviceScan();
            } catch (e) {
              logger.error("Failed to stop scan");
            }
            logger.success(`Found ${deviceName}! Connecting...`);

            try {
              const connectedDevice = await scannedDevice.connect();
              await connectedDevice.discoverAllServicesAndCharacteristics();
              logger.success("Connected and discovered services");
              resolve(connectedDevice);
            } catch (connectError) {
              const errorMsg = connectError instanceof Error ? connectError.message : String(connectError);
              reject(new Error(`Connection failed: ${errorMsg}`));
            }
          }
        });
      } catch (scanError) {
        isResolved = true;
        clearTimeout(timeout);
        const errorMsg = scanError instanceof Error ? scanError.message : String(scanError);
        reject(new Error(`Failed to start scan: ${errorMsg}`));
      }
    });
  }
);

// Actor: Monitor BLE notifications and send data to machine
const monitorNotificationsActor = fromCallback<FileSyncEvent, { device: Device }>(
  ({ input, sendBack }) => {
    const { device } = input;

    if (!device) {
      logger.error("Cannot monitor notifications: device is null");
      return () => {};
    }

    logger.info("Starting notification monitoring...");
    let subscription: Subscription | null = null;

    try {
      subscription = device.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            logger.error(`Notification error: ${error.message}`);
            return;
          }

          if (characteristic?.value) {
            try {
              const decodedValue = Buffer.from(characteristic.value, "base64").toString("utf-8");
              logger.data(`Received: ${decodedValue}`);
              sendBack({ type: "DATA_RECEIVED", data: decodedValue });
            } catch (decodeError) {
              logger.error("Failed to decode notification data");
            }
          }
        }
      );

      logger.success("Notifications enabled");
    } catch (monitorError) {
      const errorMsg = monitorError instanceof Error ? monitorError.message : String(monitorError);
      logger.error(`Failed to start monitoring: ${errorMsg}`);
    }

    // Cleanup function
    return () => {
      try {
        if (subscription) {
          subscription.remove();
          logger.info("Notifications stopped");
        }
      } catch (e) {
        logger.error("Error stopping notifications");
      }
    };
  }
);

// Actor: Send BLE command
const sendCommandActor = fromPromise<
  void,
  { device: Device; command: string }
>(async ({ input }) => {
  const { device, command } = input;

  if (!device) {
    throw new Error("Cannot send command: device is null");
  }

  try {
    logger.info(`Sending command: ${command}`);

    const base64Command = Buffer.from(command).toString("base64");
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      RX_CHARACTERISTIC_UUID,
      base64Command
    );

    logger.success(`Command sent: ${command}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to send ${command}: ${errorMsg}`);
  }
});

// Actor: Connect to WiFi
const connectToWifiActor = fromPromise<void, { ssid: string; password: string }>(
  async ({ input }) => {
    logger.info(`Connecting to WiFi: ${input.ssid}...`);

    try {
      await WifiManager.connectToProtectedSSID(input.ssid, input.password, false, false);
      logger.success(`Connected to WiFi: ${input.ssid}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || "Unknown error";
      logger.error(`WiFi connection failed: ${errorMessage}`);
      throw new Error(`WiFi connection failed: ${errorMessage}`);
    }
  }
);

// Actor: List files
const listFilesActor = fromPromise<FileEntry[], { deviceIpAddress: string }>(
  async ({ input }) => {
    try {
      logger.info("Listing files in DCIM/100NIKON...");
      const api = new SDCardAPI(input.deviceIpAddress);
      const files = await api.listDirectory("/DCIM/100NIKON");
      const imageFiles = files.filter((f) => f.type === "file");
      logger.success(`Found ${imageFiles.length} files`);

      if (imageFiles.length === 0) {
        throw new Error("No image files found in DCIM/100NIKON");
      }

      return imageFiles;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list files: ${errorMsg}`);
    }
  }
);

// Actor: Download file
const downloadFileActor = fromPromise<string, { deviceIpAddress: string; file: FileEntry }>(
  async ({ input }) => {
    try {
      if (!input.file) {
        throw new Error("No file specified for download");
      }

      logger.info(`Downloading file: ${input.file.name}`);
      const api = new SDCardAPI(input.deviceIpAddress);

      const localUri = await api.downloadFileToLocal(
        input.file.path,
        input.file.size,
        undefined,
        65536
      );

      if (!localUri) {
        throw new Error("Download completed but no URI returned");
      }

      logger.success(`File downloaded: ${localUri}`);
      return localUri;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Download failed: ${errorMsg}`);
    }
  }
);

// Actor: Cleanup
const cleanupActor = fromPromise<void, { device: Device | null }>(async ({ input }) => {
  if (!input.device) {
    logger.info("No device to disconnect");
    return;
  }

  try {
    logger.info("Disconnecting from device...");
    await input.device.cancelConnection();
    logger.success("Disconnected");
  } catch (error) {
    // Don't throw on cleanup errors, just log them
    logger.error("Error during cleanup, but continuing");
  }
});

// Helper: Parse WiFi credentials from data
const parseWifiCredentials = (data: string): { ssid: string; password: string } | null => {
  const lines = data.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length >= 2) {
    const ssid = lines[0].trim();
    const password = lines[1].trim();

    if (ssid && password && !ssid.includes("===") && !ssid.toLowerCase().includes("device")) {
      return { ssid, password };
    }
  }

  return null;
};

// Create state machine
const fileSyncMachine = setup({
  types: {
    context: {} as FileSyncContext,
    events: {} as FileSyncEvent,
    input: {} as { bleManager: BleManager; deviceName: string },
  },
  actors: {
    scanAndConnect: scanAndConnectActor,
    monitorNotifications: monitorNotificationsActor,
    sendCommand: sendCommandActor,
    connectToWifi: connectToWifiActor,
    listFiles: listFilesActor,
    downloadFile: downloadFileActor,
    cleanup: cleanupActor,
  },
  actions: {
    setError: assign({
      error: ({ event }) => {
        if (event.type === "xstate.error") {
          const error = (event as any).error;
          return error instanceof Error ? error.message : String(error);
        }
        return "Unknown error";
      },
    }),
    setDevice: assign({
      device: ({ event }) => (event as any).output,
    }),
    appendData: assign({
      receivedData: ({ context, event }) => {
        if (event.type === "DATA_RECEIVED") {
          return context.receivedData + event.data;
        }
        return context.receivedData;
      },
    }),
    clearData: assign({
      receivedData: "",
    }),
    parseAndSetWifiCredentials: assign({
      wifiSsid: ({ context }) => {
        const credentials = parseWifiCredentials(context.receivedData);
        return credentials?.ssid ?? null;
      },
      wifiPassword: ({ context }) => {
        const credentials = parseWifiCredentials(context.receivedData);
        return credentials?.password ?? null;
      },
    }),
    setFiles: assign({
      files: ({ event }) => (event as any).output,
    }),
    setDownloadedFile: assign({
      downloadedFileUri: ({ event }) => (event as any).output,
    }),
  },
  guards: {
    hasWifiCredentials: ({ context }) => {
      const credentials = parseWifiCredentials(context.receivedData);
      return credentials !== null;
    },
    hasFiles: ({ context }) => context.files.length > 0,
  },
}).createMachine({
  id: "fileSync",
  initial: "idle",
  context: {
    error: null,
    device: null,
    receivedData: "",
    wifiSsid: null,
    wifiPassword: null,
    deviceIpAddress: "192.168.4.1",
    files: [],
    downloadedFileUri: null,
  },
  states: {
    idle: {
      on: {
        START: "scanningAndConnecting",
      },
    },
    scanningAndConnecting: {
      invoke: {
        src: "scanAndConnect",
        input: ({ input }) => ({
          bleManager: input.bleManager,
          deviceName: input.deviceName,
        }),
        onDone: {
          target: "connected",
          actions: "setDevice",
        },
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cancelled",
      },
    },
    connected: {
      invoke: {
        src: "monitorNotifications",
        input: ({ context }) => {
          if (!context.device) {
            throw new Error("Device not available for monitoring");
          }
          return {
            device: context.device,
          };
        },
      },
      always: "sendingSleep",
    },
    sendingSleep: {
      entry: "clearData",
      invoke: {
        src: "sendCommand",
        input: ({ context }) => {
          if (!context.device) {
            throw new Error("Device not available for SLEEP command");
          }
          return {
            device: context.device,
            command: "SLEEP",
          };
        },
        onDone: "waitingForSleepResponse",
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cleaningUp",
      },
    },
    waitingForSleepResponse: {
      on: {
        DATA_RECEIVED: {
          target: "sendingWake",
          actions: "appendData",
        },
        CANCEL: "cleaningUp",
      },
    },
    sendingWake: {
      entry: "clearData",
      invoke: {
        src: "sendCommand",
        input: ({ context }) => {
          if (!context.device) {
            throw new Error("Device not available for WAKE command");
          }
          return {
            device: context.device,
            command: "WAKE",
          };
        },
        onDone: "waitingForWakeResponse",
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cleaningUp",
      },
    },
    waitingForWakeResponse: {
      on: {
        DATA_RECEIVED: [
          {
            target: "promptingWifiConnection",
            guard: "hasWifiCredentials",
            actions: ["appendData", "parseAndSetWifiCredentials"],
          },
          {
            actions: "appendData",
          },
        ],
        CANCEL: "cleaningUp",
      },
    },
    promptingWifiConnection: {
      on: {
        USER_CONFIRM_WIFI: "connectingToWifi",
        USER_CANCEL_WIFI: "cleaningUp",
        CANCEL: "cleaningUp",
      },
    },
    connectingToWifi: {
      invoke: {
        src: "connectToWifi",
        input: ({ context }) => ({
          ssid: context.wifiSsid!,
          password: context.wifiPassword!,
        }),
        onDone: "listingFiles",
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cleaningUp",
      },
    },
    listingFiles: {
      invoke: {
        src: "listFiles",
        input: ({ context }) => ({
          deviceIpAddress: context.deviceIpAddress,
        }),
        onDone: [
          {
            target: "downloadingFile",
            guard: "hasFiles",
            actions: "setFiles",
          },
          {
            target: "error",
            actions: assign({
              error: "No files found in DCIM/100NIKON",
            }),
          },
        ],
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cleaningUp",
      },
    },
    downloadingFile: {
      invoke: {
        src: "downloadFile",
        input: ({ context }) => {
          if (!context.files || context.files.length === 0) {
            throw new Error("No files available to download");
          }
          return {
            deviceIpAddress: context.deviceIpAddress,
            file: context.files[0],
          };
        },
        onDone: {
          target: "sendingFinalSleep",
          actions: "setDownloadedFile",
        },
        onError: {
          target: "error",
          actions: "setError",
        },
      },
      on: {
        CANCEL: "cleaningUp",
      },
    },
    sendingFinalSleep: {
      entry: "clearData",
      invoke: {
        src: "sendCommand",
        input: ({ context }) => {
          if (!context.device) {
            throw new Error("Device not available for final SLEEP command");
          }
          return {
            device: context.device,
            command: "SLEEP",
          };
        },
        onDone: "cleaningUp",
        onError: "cleaningUp", // Continue cleanup even if sleep fails
      },
    },
    cleaningUp: {
      invoke: {
        src: "cleanup",
        input: ({ context }) => ({
          device: context.device!,
        }),
        onDone: "completed",
        onError: "completed",
      },
    },
    completed: {
      type: "final",
    },
    cancelled: {
      type: "final",
    },
    error: {
      on: {
        RETRY: "idle",
        CANCEL: "cancelled",
      },
    },
  },
});

export const useFileSyncMachine = () => {
  console.log("useFileSyncMachine called");
  try {
    console.log("useFileSyncMachine: Creating refs...");
    const bleManagerRef = useRef<BleManager | null>(null);
    const [initError, setInitError] = React.useState<string | null>(null);
    console.log("useFileSyncMachine: Refs created");

    // Initialize BLE Manager
    console.log("useFileSyncMachine: Checking BLE Manager initialization...");
    if (!bleManagerRef.current && !initError) {
      try {
        console.log("useFileSyncMachine: Creating BLE Manager...");
        bleManagerRef.current = new BleManager();
        console.log("useFileSyncMachine: BLE Manager created");
        logger.info("BLE Manager initialized");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error("useFileSyncMachine: BLE Manager initialization failed:", errorMsg);
        logger.error(`Failed to initialize BLE Manager: ${errorMsg}`);
        setInitError(`BLE initialization failed: ${errorMsg}`);
      }
    } else {
      console.log("useFileSyncMachine: BLE Manager already exists or has init error");
    }

    // Create a safe machine instance with error handling
    console.log("useFileSyncMachine: Creating state machine...");
    let state: any;
    let send: any;

    try {
      if (!bleManagerRef.current) {
        console.error("useFileSyncMachine: BLE Manager not initialized, throwing error");
        throw new Error("BLE Manager not initialized");
      }

      console.log("useFileSyncMachine: Calling useMachine...");
      const machineResult = useMachine(fileSyncMachine, {
        input: {
          bleManager: bleManagerRef.current,
          deviceName: DEVICE_NAME,
        },
      });
      console.log("useFileSyncMachine: useMachine completed");

      state = machineResult[0];
      send = machineResult[1];
      console.log("useFileSyncMachine: State machine initialized successfully");
    } catch (error) {
      console.error("useFileSyncMachine: State machine initialization error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to initialize state machine: ${errorMsg}`);

      // Return a safe default state
      return {
        state: "error",
        context: { error: initError || errorMsg },
        isIdle: false,
        isScanningAndConnecting: false,
        isConnected: false,
        isSendingSleep: false,
        isWaitingForSleepResponse: false,
        isSendingWake: false,
        isWaitingForWakeResponse: false,
        isPromptingWifiConnection: false,
        isConnectingToWifi: false,
        isListingFiles: false,
        isDownloadingFile: false,
        isSendingFinalSleep: false,
        isCleaningUp: false,
        isCompleted: false,
        isCancelled: false,
        isError: true,
        startSync: () => logger.error("Cannot start sync: machine not initialized"),
        confirmWifiConnection: () => logger.error("Cannot confirm WiFi: machine not initialized"),
        cancelWifiConnection: () => logger.error("Cannot cancel WiFi: machine not initialized"),
        cancelSync: () => logger.error("Cannot cancel sync: machine not initialized"),
        retry: () => logger.error("Cannot retry: machine not initialized"),
      };
    }

    const startSync = () => {
      try {
        if (!bleManagerRef.current) {
          logger.error("Cannot start sync: BLE Manager not initialized");
          return;
        }
        logger.info("Starting sync...");
        send({ type: "START" });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to start sync: ${errorMsg}`);
      }
    };

    const confirmWifiConnection = () => {
      try {
        logger.info("Confirming WiFi connection...");
        send({ type: "USER_CONFIRM_WIFI" });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to confirm WiFi: ${errorMsg}`);
      }
    };

    const cancelWifiConnection = () => {
      try {
        logger.info("Cancelling WiFi connection...");
        send({ type: "USER_CANCEL_WIFI" });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to cancel WiFi: ${errorMsg}`);
      }
    };

    const cancelSync = () => {
      try {
        logger.info("Cancelling sync...");
        send({ type: "CANCEL" });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to cancel sync: ${errorMsg}`);
      }
    };

    const retry = () => {
      try {
        logger.info("Retrying...");
        send({ type: "RETRY" });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to retry: ${errorMsg}`);
      }
    };

    // Safely get state values with fallbacks
    const safeMatches = (stateName: string) => {
      try {
        return state?.matches ? state.matches(stateName) : false;
      } catch (error) {
        return false;
      }
    };

    return {
      state: state?.value || "error",
      context: state?.context || { error: initError || "Machine not initialized" },
      isIdle: safeMatches("idle"),
      isScanningAndConnecting: safeMatches("scanningAndConnecting"),
      isConnected: safeMatches("connected"),
      isSendingSleep: safeMatches("sendingSleep"),
      isWaitingForSleepResponse: safeMatches("waitingForSleepResponse"),
      isSendingWake: safeMatches("sendingWake"),
      isWaitingForWakeResponse: safeMatches("waitingForWakeResponse"),
      isPromptingWifiConnection: safeMatches("promptingWifiConnection"),
      isConnectingToWifi: safeMatches("connectingToWifi"),
      isListingFiles: safeMatches("listingFiles"),
      isDownloadingFile: safeMatches("downloadingFile"),
      isSendingFinalSleep: safeMatches("sendingFinalSleep"),
      isCleaningUp: safeMatches("cleaningUp"),
      isCompleted: safeMatches("completed"),
      isCancelled: safeMatches("cancelled"),
      isError: safeMatches("error") || !!initError,
      startSync,
      confirmWifiConnection,
      cancelWifiConnection,
      cancelSync,
      retry,
    };
  } catch (error) {
    // Root level catch-all - if ANYTHING goes wrong, return a safe error state
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("FATAL: useFileSyncMachine crashed:", errorMsg, error);
    logger.error(`FATAL: useFileSyncMachine crashed: ${errorMsg}`);

    return {
      state: "error",
      context: {
        error: `Fatal error: ${errorMsg}`,
        wifiSsid: null,
        wifiPassword: null,
        deviceIpAddress: "192.168.4.1",
        files: [],
        downloadedFileUri: null,
        device: null,
        receivedData: "",
      },
      isIdle: false,
      isScanningAndConnecting: false,
      isConnected: false,
      isSendingSleep: false,
      isWaitingForSleepResponse: false,
      isSendingWake: false,
      isWaitingForWakeResponse: false,
      isPromptingWifiConnection: false,
      isConnectingToWifi: false,
      isListingFiles: false,
      isDownloadingFile: false,
      isSendingFinalSleep: false,
      isCleaningUp: false,
      isCompleted: false,
      isCancelled: false,
      isError: true,
      startSync: () => {
        console.error("Cannot start sync: Fatal error occurred");
        logger.error("Cannot start sync: Fatal error occurred");
      },
      confirmWifiConnection: () => {
        console.error("Cannot confirm WiFi: Fatal error occurred");
        logger.error("Cannot confirm WiFi: Fatal error occurred");
      },
      cancelWifiConnection: () => {
        console.error("Cannot cancel WiFi: Fatal error occurred");
        logger.error("Cannot cancel WiFi: Fatal error occurred");
      },
      cancelSync: () => {
        console.error("Cannot cancel sync: Fatal error occurred");
        logger.error("Cannot cancel sync: Fatal error occurred");
      },
      retry: () => {
        console.error("Cannot retry: Fatal error occurred");
        logger.error("Cannot retry: Fatal error occurred");
      },
    };
  }
};
