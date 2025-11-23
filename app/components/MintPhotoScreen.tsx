import { View, Text, Button, Image, StyleSheet } from "react-native"
import { useEffect } from "react"

import { createMachine, fromPromise, fromCallback, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { BleManager, State, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import WifiManager from "react-native-wifi-reborn";
import { SDCardAPI, FileEntry } from "../services/sdcard";

// Types for the state machine
type MintPhotoContext = {
  error?: string;
  deviceId?: string;
  deviceName?: string;
  connectedDevice?: Device;
  receivedData?: string;
  wifiSSID?: string;
  wifiPassword?: string;
  files?: FileEntry[];
  downloadingFile?: FileEntry;
  downloadProgress?: number;
  localFileUri?: string;
};

type MintPhotoEvents =
  | { type: 'retry' }
  | { type: 'disconnect' }
  | { type: 'dataReceived'; data: string }
  | { type: 'retryWifi' }
  | { type: 'downloadProgress'; progress: number };

const DEVICE_NAME = "digicam-001";
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
const TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

// Persistent BLE Manager instance
const bleManager = new BleManager();

// Helper function to parse WiFi credentials from received data
const parseWifiCredentials = (data: string): { ssid: string; password: string } | null => {
  const lines = data.split("\n").filter(line => line.trim().length > 0);

  // Look for SSID and password (should be first two non-empty lines)
  if (lines.length >= 2) {
    const ssid = lines[0].trim();
    const password = lines[1].trim();

    // Basic validation - SSID shouldn't look like a status message
    if (ssid && password && !ssid.includes("===") && !ssid.toLowerCase().includes("device")) {
      console.log(`WiFi credentials parsed - SSID: ${ssid}`);
      return { ssid, password };
    }
  }
  return null;
};

// Promise actor to check if bluetooth is ready
const checkBluetoothReady = fromPromise<boolean, void>(async () => {
  return new Promise<boolean>((resolve, reject) => {
    const subscription = bleManager.onStateChange((state) => {
      console.log(`Bluetooth state: ${state}`);

      if (state === State.PoweredOn) {
        subscription.remove();
        resolve(true);
      } else if (state === State.PoweredOff || state === State.Unsupported) {
        subscription.remove();
        reject(new Error(`Bluetooth not ready. State: ${state}`));
      }
    }, true);

    // Timeout after 5 seconds
    setTimeout(() => {
      subscription.remove();
      reject(new Error('Bluetooth check timeout'));
    }, 5000);
  });
});

// Promise actor to scan for and connect to digicam-001
const scanAndConnectToDevice = fromPromise<{ id: string; name: string; device: Device }, void>(async () => {
  return new Promise((resolve, reject) => {
    let isScanning = true;

    console.log(`Scanning for ${DEVICE_NAME}...`);

    bleManager.startDeviceScan(
      null,
      { allowDuplicates: false },
      async (error, scannedDevice) => {
        if (error) {
          console.log(`Scan error: ${error.message}`);
          bleManager.stopDeviceScan();
          reject(new Error(`Scan error: ${error.message}`));
          return;
        }

        if (scannedDevice?.name === DEVICE_NAME) {
          console.log(`Found ${DEVICE_NAME}! ID: ${scannedDevice.id}`);
          bleManager.stopDeviceScan();
          isScanning = false;

          try {
            // Connect to device
            console.log(`Connecting to ${scannedDevice.name}...`);
            const connectedDevice = await scannedDevice.connect();
            console.log('Connected!');

            // Discover services and characteristics
            console.log('Discovering services and characteristics...');
            await connectedDevice.discoverAllServicesAndCharacteristics();
            console.log('Services discovered');

            resolve({ id: connectedDevice.id, name: scannedDevice.name, device: connectedDevice });
          } catch (connectError) {
            const errorMessage = connectError instanceof Error ? connectError.message : 'Unknown error';
            reject(new Error(`Connection failed: ${errorMessage}`));
          }
        }
      }
    );

    // Stop scanning after 10 seconds if device not found
    setTimeout(() => {
      if (isScanning) {
        bleManager.stopDeviceScan();
        reject(new Error(`Scan timeout - ${DEVICE_NAME} not found`));
      }
    }, 10000);
  });
});

// Promise actor to send a command to the device
const sendCommand = fromPromise<void, { device: Device; command: string }>(async ({ input }) => {
  console.log(`Sending command: ${input.command}`);

  // Encode command to base64
  const base64Command = Buffer.from(input.command).toString("base64");

  await input.device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    RX_CHARACTERISTIC_UUID,
    base64Command
  );

  console.log(`Command sent: ${input.command}`);
});

// Promise actor to connect to WiFi
const connectToWifi = fromPromise<void, { ssid: string; password: string }>(async ({ input }) => {
  console.log(`Connecting to WiFi: ${input.ssid}...`);

  try {
    await WifiManager.connectToProtectedSSID(input.ssid, input.password, false, false);
    console.log(`Connected to WiFi: ${input.ssid}`);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.log(`WiFi connection failed: ${errorMessage}`);

    let userMessage = 'Failed to connect to WiFi network.';
    if (errorMessage.includes('userDenied')) {
      userMessage = 'User denied WiFi connection permission.';
    } else if (errorMessage.includes('locationPermissionDenied')) {
      userMessage = 'Location permission is required for WiFi connection.';
    } else if (errorMessage.includes('invalidSSID')) {
      userMessage = 'Invalid WiFi network name.';
    } else if (errorMessage.includes('invalidPassphrase')) {
      userMessage = 'Incorrect WiFi password.';
    }

    throw new Error(userMessage);
  }
});

// Promise actor to list files from camera
const listFiles = fromPromise<FileEntry[], void>(async () => {
  console.log('Listing files from DCIM/100NIKON...');

  const api = new SDCardAPI('192.168.4.1');
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries}...`);

      const files = await api.listDirectory('/DCIM/100NIKON');
      console.log(`Files retrieved: ${files.length} items`);

      return files;

    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.log(`Attempt ${attempt} failed: ${errorMessage}`);

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${errorMessage}`);
      }

      // Wait before retrying
      console.log(`Waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Unexpected error in listFiles');
});

// Promise actor to download a file from camera
const downloadFile = fromPromise<string, { file: FileEntry }>(async ({ input }) => {
  console.log(`Downloading file: ${input.file.name}`);

  const api = new SDCardAPI('192.168.4.1');

  try {
    const localUri = await api.downloadFileToLocal(
      input.file.path,
      input.file.size,
      (progress, totalBytes, downloadedBytes) => {
        console.log(`Download progress: ${Math.round(progress * 100)}% (${downloadedBytes}/${totalBytes} bytes)`);
      }
    );

    console.log(`File downloaded to: ${localUri}`);
    return localUri;

  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.log(`Download failed: ${errorMessage}`);
    throw new Error(`Download failed: ${errorMessage}`);
  }
});

// Callback actor to monitor notifications from the device
const monitorNotifications = fromCallback<
  { type: 'dataReceived'; data: string },
  { device: Device }
>(({ sendBack, input }) => {
  console.log('Starting notifications...');

  const subscription = input.device.monitorCharacteristicForService(
    SERVICE_UUID,
    TX_CHARACTERISTIC_UUID,
    (error, characteristic) => {
      if (error) {
        console.log(`Notification error: ${error.message}`);
        return;
      }

      if (characteristic?.value) {
        // Decode base64 value
        const decodedValue = Buffer.from(characteristic.value, "base64").toString("utf-8");
        console.log(`Received: ${decodedValue}`);

        // Send event to the machine
        sendBack({ type: 'dataReceived', data: decodedValue });
      }
    }
  );

  console.log('Notifications enabled');

  // Cleanup function - called when leaving the state
  return () => {
    console.log('Stopping notifications...');
    subscription?.remove();
  };
});

const bluetoothMachine = createMachine({
  id: 'bluetooth',
  types: {} as {
    context: MintPhotoContext;
    events: MintPhotoEvents;
  },
  context: {},
  initial: 'CheckingBluetooth',
  states: {
    CheckingBluetooth: {
      invoke: {
        src: checkBluetoothReady,
        onDone: {
          target: 'ScanningAndConnecting',
          actions: assign({
            error: undefined,
          }),
        },
        onError: {
          target: 'BluetoothNotReady',
          actions: assign({
            error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
          }),
        },
      },
    },
    BluetoothNotReady: {
      on: {
        retry: 'CheckingBluetooth',
      },
    },
    ScanningAndConnecting: {
      invoke: {
        src: scanAndConnectToDevice,
        onDone: {
          target: 'DeviceConnected',
          actions: assign({
            error: undefined,
            deviceId: ({ event }) => event.output.id,
            deviceName: ({ event }) => event.output.name,
            connectedDevice: ({ event }) => event.output.device,
          }),
        },
        onError: {
          target: 'ConnectionFailed',
          actions: assign({
            error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
          }),
        },
      },
    },
    ConnectionFailed: {
      on: {
        retry: 'ScanningAndConnecting',
      },
    },
    DeviceConnected: {
      invoke: {
        src: monitorNotifications,
        input: ({ context }) => ({
          device: context.connectedDevice!,
        }),
      },
      initial: 'SendingSleepCommand',
      states: {
        SendingSleepCommand: {
          invoke: {
            src: sendCommand,
            input: ({ context }) => ({
              device: context.connectedDevice!,
              command: 'SLEEP',
            }),
            onDone: {
              target: 'AwaitingSleepResponse',
            },
            onError: {
              target: 'AwaitingSleepResponse',
              actions: assign({
                error: ({ event }) => `Failed to send SLEEP command: ${event.error instanceof Error ? event.error.message : 'Unknown error'}`,
              }),
            },
          },
        },
        AwaitingSleepResponse: {
          on: {
            dataReceived: [
              {
                target: 'SendingWakeCommand',
                guard: ({ event }) => {
                  const data = event.data.toLowerCase();
                  return data.includes('zzz') || data.includes('wake');
                },
                actions: assign({
                  receivedData: '', // Clear data after SLEEP response
                }),
              },
              {
                actions: assign({
                  receivedData: ({ context, event }) =>
                    (context.receivedData || '') + event.data,
                }),
              },
            ],
          },
        },
        SendingWakeCommand: {
          invoke: {
            src: sendCommand,
            input: ({ context }) => ({
              device: context.connectedDevice!,
              command: 'WAKE',
            }),
            onDone: {
              target: 'AwaitingWakeResponse',
            },
            onError: {
              target: 'AwaitingWakeResponse',
              actions: assign({
                error: ({ event }) => `Failed to send WAKE command: ${event.error instanceof Error ? event.error.message : 'Unknown error'}`,
              }),
            },
          },
        },
        AwaitingWakeResponse: {
          on: {
            dataReceived: [
              {
                target: 'Connected',
                guard: ({ context, event }) => {
                  // Check accumulated data for at least 2 non-empty lines
                  const allData = (context.receivedData || '') + event.data;
                  const lines = allData.split('\n').filter(line => line.trim().length > 0);
                  console.log('WAKE response check:', { allData, lines, count: lines.length });
                  return lines.length >= 2;
                },
                actions: assign({
                  receivedData: ({ context, event }) =>
                    (context.receivedData || '') + event.data,
                  wifiSSID: ({ context, event }) => {
                    const allData = (context.receivedData || '') + event.data;
                    const credentials = parseWifiCredentials(allData);
                    return credentials?.ssid || context.wifiSSID;
                  },
                  wifiPassword: ({ context, event }) => {
                    const allData = (context.receivedData || '') + event.data;
                    const credentials = parseWifiCredentials(allData);
                    return credentials?.password || context.wifiPassword;
                  },
                }),
              },
              {
                actions: assign({
                  receivedData: ({ context, event }) =>
                    (context.receivedData || '') + event.data,
                }),
              },
            ],
          },
        },
        Connected: {
          always: {
            target: 'ConnectingToWifi',
            guard: ({ context }) => !!(context.wifiSSID && context.wifiPassword),
          },
        },
        ConnectingToWifi: {
          invoke: {
            src: connectToWifi,
            input: ({ context }) => ({
              ssid: context.wifiSSID!,
              password: context.wifiPassword!,
            }),
            onDone: {
              target: 'WifiConnected',
              actions: assign({
                error: undefined,
              }),
            },
            onError: {
              target: 'WifiConnectionFailed',
              actions: assign({
                error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
              }),
            },
          },
        },
        WifiConnectionFailed: {
          on: {
            retryWifi: 'ConnectingToWifi',
          },
        },
        WifiConnected: {
          always: {
            target: 'WaitBeforeListing',
          },
        },
        WaitBeforeListing: {
          after: {
            1000: 'ListingFiles',
          },
        },
        ListingFiles: {
          invoke: {
            src: listFiles,
            onDone: {
              target: 'FilesListed',
              actions: assign({
                error: undefined,
                files: ({ event }) => event.output,
              }),
            },
            onError: {
              target: 'FileListingFailed',
              actions: assign({
                error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
              }),
            },
          },
        },
        FileListingFailed: {
          // Could add retry logic here if needed
        },
        FilesListed: {
          always: {
            target: 'DownloadingFile',
            guard: ({ context }) => {
              // Only download if we have files and at least one is a file (not directory)
              const files = context.files || [];
              return files.length > 0 && files.some(f => f.type === 'file');
            },
            actions: assign({
              downloadingFile: ({ context }) => {
                // Select the last file from the list
                const files = context.files || [];
                const fileEntries = files.filter(f => f.type === 'file');
                return fileEntries[fileEntries.length - 1];
              },
            }),
          },
        },
        DownloadingFile: {
          invoke: {
            src: downloadFile,
            input: ({ context }) => ({
              file: context.downloadingFile!,
            }),
            onDone: {
              target: 'FileDownloaded',
              actions: assign({
                error: undefined,
                localFileUri: ({ event }) => event.output,
              }),
            },
            onError: {
              target: 'DownloadFailed',
              actions: assign({
                error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
              }),
            },
          },
        },
        DownloadFailed: {
          // Could add retry logic here
        },
        FileDownloaded: {
          // Final state - file is downloaded
        },
      },
      on: {
        disconnect: {
          target: 'CheckingBluetooth',
          actions: assign({
            receivedData: undefined,
            connectedDevice: undefined,
            wifiSSID: undefined,
            wifiPassword: undefined,
          }),
        },
      },
    },
  },
});



export const MintPhotoScreen = () => {
  const [snapshot, send] = useMachine(bluetoothMachine)

  // Cleanup BLE manager on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up BLE Manager...');
      bleManager.destroy();
    };
  }, []);

  return (
    <View>
      <Text>State: {JSON.stringify(snapshot.value)}</Text>

      {snapshot.value === 'CheckingBluetooth' && (
        <Text>Checking if bluetooth is ready...</Text>
      )}

      {snapshot.value === 'BluetoothNotReady' && (
        <>
          <Text>Bluetooth is not ready. Please enable bluetooth.</Text>
          {snapshot.context.error && (
            <Text>Error: {snapshot.context.error}</Text>
          )}
          <Button onPress={() => send({ type: 'retry' })} title="Retry" />
        </>
      )}

      {snapshot.value === 'ScanningAndConnecting' && (
        <Text>Scanning for {DEVICE_NAME} and connecting...</Text>
      )}

      {snapshot.value === 'ConnectionFailed' && (
        <>
          <Text>Failed to connect to {DEVICE_NAME}</Text>
          {snapshot.context.error && (
            <Text>Error: {snapshot.context.error}</Text>
          )}
          <Button onPress={() => send({ type: 'retry' })} title="Retry Connection" />
        </>
      )}

      {snapshot.matches('DeviceConnected') && (
        <>
          <Text>Connected to {snapshot.context.deviceName}!</Text>
          <Text>Device ID: {snapshot.context.deviceId}</Text>

          {snapshot.matches('DeviceConnected.SendingSleepCommand') && (
            <Text>Sending SLEEP command...</Text>
          )}

          {snapshot.matches('DeviceConnected.AwaitingSleepResponse') && (
            <Text>Waiting for SLEEP response...</Text>
          )}

          {snapshot.matches('DeviceConnected.SendingWakeCommand') && (
            <Text>Sending WAKE command...</Text>
          )}

          {snapshot.matches('DeviceConnected.AwaitingWakeResponse') && (
            <Text>Waiting for WAKE response...</Text>
          )}

          {snapshot.matches('DeviceConnected.Connected') && (
            <>
              <Text>WiFi credentials received!</Text>
              {snapshot.context.wifiSSID && snapshot.context.wifiPassword && (
                <>
                  <Text>SSID: {snapshot.context.wifiSSID}</Text>
                  <Text>Password: {snapshot.context.wifiPassword}</Text>
                </>
              )}
            </>
          )}

          {snapshot.matches('DeviceConnected.ConnectingToWifi') && (
            <>
              <Text>Connecting to WiFi network...</Text>
              <Text>SSID: {snapshot.context.wifiSSID}</Text>
            </>
          )}

          {snapshot.matches('DeviceConnected.WifiConnectionFailed') && (
            <>
              <Text>WiFi connection failed!</Text>
              <Text>SSID: {snapshot.context.wifiSSID}</Text>
              {snapshot.context.error && (
                <Text>Error: {snapshot.context.error}</Text>
              )}
              <Button onPress={() => send({ type: 'retryWifi' })} title="Retry WiFi Connection" />
            </>
          )}

          {snapshot.matches('DeviceConnected.WifiConnected') && (
            <>
              <Text>Successfully connected to WiFi!</Text>
              <Text>Network: {snapshot.context.wifiSSID}</Text>
            </>
          )}

          {snapshot.matches('DeviceConnected.WaitBeforeListing') && (
            <Text>Preparing to list files...</Text>
          )}

          {snapshot.matches('DeviceConnected.ListingFiles') && (
            <Text>Listing files from camera (will retry up to 3 times)...</Text>
          )}

          {snapshot.matches('DeviceConnected.FileListingFailed') && (
            <>
              <Text>Failed to list files from camera</Text>
              {snapshot.context.error && (
                <Text>Error: {snapshot.context.error}</Text>
              )}
            </>
          )}

          {snapshot.matches('DeviceConnected.FilesListed') && (
            <>
              <Text>Files in DCIM/100NIKON:</Text>
              {snapshot.context.files && snapshot.context.files.length > 0 ? (
                snapshot.context.files.map((file, index) => (
                  <Text key={index}>
                    {file.type === 'dir' ? '📁' : '📄'} {file.name} ({file.size} bytes)
                  </Text>
                ))
              ) : (
                <Text>No files found</Text>
              )}
            </>
          )}

          {snapshot.matches('DeviceConnected.DownloadingFile') && (
            <>
              <Text>Downloading file...</Text>
              {snapshot.context.downloadingFile && (
                <>
                  <Text>File: {snapshot.context.downloadingFile.name}</Text>
                  <Text>Size: {snapshot.context.downloadingFile.size} bytes</Text>
                </>
              )}
            </>
          )}

          {snapshot.matches('DeviceConnected.DownloadFailed') && (
            <>
              <Text>Download failed!</Text>
              {snapshot.context.downloadingFile && (
                <Text>File: {snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.error && (
                <Text>Error: {snapshot.context.error}</Text>
              )}
            </>
          )}

          {snapshot.matches('DeviceConnected.FileDownloaded') && (
            <>
              <Text>File downloaded successfully!</Text>
              {snapshot.context.downloadingFile && (
                <Text>File: {snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.localFileUri && (
                <>
                  <Text>Saved to: {snapshot.context.localFileUri}</Text>
                  <Image
                    source={{ uri: snapshot.context.localFileUri }}
                    style={styles.downloadedImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </>
          )}

          {snapshot.context.receivedData && (
            <>
              <Text>Received Data:</Text>
              <Text>{snapshot.context.receivedData}</Text>
            </>
          )}
          <Button onPress={() => send({ type: 'disconnect' })} title="Disconnect" />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  downloadedImage: {
    width: 300,
    height: 300,
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
});
