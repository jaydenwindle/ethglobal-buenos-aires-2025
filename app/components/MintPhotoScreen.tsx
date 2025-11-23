import { View, Text, Button, Image, StyleSheet, ActivityIndicator } from "react-native"
import { useEffect } from "react"

import { createMachine, fromPromise, fromCallback, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import { BleManager, State, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import WifiManager from "react-native-wifi-reborn";
import { SDCardAPI, FileEntry } from "../services/sdcard";
import { useTheme } from "../theme/ThemeContext";
import { createMetadataBuilder, createZoraUploaderForCreator, setApiKey } from "@zoralabs/coins-sdk";
import { Address } from "viem";

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
  base64Data?: string;
  imageIpfsUri?: string;
  metadataIpfsUri?: string;
  creatorAddress?: string;
};

type MintPhotoEvents =
  | { type: 'retry' }
  | { type: 'start' }
  | { type: 'dataReceived'; data: string }
  | { type: 'retryWifi' }
  | { type: 'downloadProgress'; progress: number }
  | { type: 'downloadComplete'; localUri: string; base64Data: string }
  | { type: 'downloadError'; error: string }
  | { type: 'generateMetadata' };

const DEVICE_NAME = "digicam-001";
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
const RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
const TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";
// TODO: Replace with actual creator address from wallet/user
const CREATOR_ADDRESS = "0x17cd072cBd45031EFc21Da538c783E0ed3b25DCc";

// Persistent BLE Manager instance
const bleManager = new BleManager();

setApiKey(process.env.EXPO_PUBLIC_ZORA_API_KEY)

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

// Callback actor to download a file from camera with progress tracking
const downloadFile = fromCallback<
  { type: 'downloadProgress'; progress: number } | { type: 'downloadComplete'; localUri: string; base64Data: string } | { type: 'downloadError'; error: string },
  { file: FileEntry }
>(({ sendBack, input }) => {
  console.log(`Downloading file: ${input.file.name}`);

  const api = new SDCardAPI('192.168.4.1');

  // Start the download
  (async () => {
    try {
      const { localUri, base64Data } = await api.downloadFileToLocal(
        input.file.path,
        input.file.size,
        (progress, totalBytes, downloadedBytes) => {
          console.log(`Download progress: ${Math.round(progress * 100)}% (${downloadedBytes}/${totalBytes} bytes)`);
          // Send progress update to the machine
          sendBack({ type: 'downloadProgress', progress });
        },
        8192 // 8KB chunks
      );

      console.log(`File downloaded to: ${localUri}`);
      sendBack({ type: 'downloadComplete', localUri, base64Data });

    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.log(`Download failed: ${errorMessage}`);
      sendBack({ type: 'downloadError', error: errorMessage });
    }
  })();

  // Cleanup function (not much to clean up for this actor)
  return () => {
    console.log('Download actor cleanup');
  };
});

// Promise actor to upload image to Pinata
const uploadImageToPinata = fromPromise<string, { localFileUri: string; fileName: string }>(async ({ input }) => {
  console.log(`Uploading image to Pinata: ${input.fileName}`);

  try {
    // Create FormData for Pinata API
    const formData = new FormData();
    formData.append('file', {
      uri: input.localFileUri,
      name: input.fileName,
      type: 'image/jpg',
    } as any);

    console.log('Uploading to Pinata API...');

    // Upload to Pinata API
    const uploadResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.EXPO_PUBLIC_PINATA_JWT}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Pinata API error (${uploadResponse.status}): ${errorText}`);
    }

    const result = await uploadResponse.json();
    const ipfsUri = `ipfs://${result.IpfsHash}`;

    console.log(`Image uploaded to IPFS: ${ipfsUri}`);
    return ipfsUri;

  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.log(`Image upload failed: ${errorMessage}`);
    throw new Error(`Failed to upload image: ${errorMessage}`);
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
      initial: 'WaitingForUserInput',
      states: {
        WaitingForUserInput: {
          on: {
            start: 'SendingSleepCommand',
          },
        },
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
          },
          on: {
            downloadProgress: {
              actions: assign({
                downloadProgress: ({ event }) => event.progress,
              }),
            },
            downloadComplete: {
              target: 'FileDownloaded',
              actions: assign({
                error: undefined,
                localFileUri: ({ event }) => event.localUri,
                base64Data: ({ event }) => event.base64Data,
                downloadProgress: 1,
              }),
            },
            downloadError: {
              target: 'DownloadFailed',
              actions: assign({
                error: ({ event }) => event.error,
              }),
            },
          },
        },
        DownloadFailed: {
          // Could add retry logic here
        },
        FileDownloaded: {
          on: {
            generateMetadata: {
              target: 'SendingSleepBeforeUpload',
            },
          },
        },
        SendingSleepBeforeUpload: {
          invoke: {
            src: sendCommand,
            input: ({ context }) => ({
              device: context.connectedDevice!,
              command: 'SLEEP',
            }),
            onDone: {
              target: 'AwaitingSleepResponseBeforeUpload',
            },
            onError: {
              target: 'AwaitingSleepResponseBeforeUpload',
              actions: assign({
                error: ({ event }) => `Failed to send SLEEP command: ${event.error instanceof Error ? event.error.message : 'Unknown error'}`,
              }),
            },
          },
        },
        AwaitingSleepResponseBeforeUpload: {
          on: {
            dataReceived: {
              target: 'UploadingImage',
              guard: ({ event }) => {
                const data = event.data.toLowerCase();
                return data.includes('zzz') || data.includes('wake');
              },
            },
          },
        },
        UploadingImage: {
          invoke: {
            src: uploadImageToPinata,
            input: ({ context }) => ({
              localFileUri: context.localFileUri!,
              fileName: context.downloadingFile?.name || 'photo.jpg',
            }),
            onDone: {
              target: 'ImageUploaded',
              actions: assign({
                error: undefined,
                imageIpfsUri: ({ event }) => event.output,
              }),
            },
            onError: {
              target: 'ImageUploadFailed',
              actions: assign({
                error: ({ event }) => event.error instanceof Error ? event.error.message : 'Unknown error',
              }),
            },
          },
        },
        ImageUploadFailed: {
          // Could add retry logic here
        },
        ImageUploaded: {
          // Final state - image is uploaded to IPFS
        },
      },
    },
  },
});



export const MintPhotoScreen = () => {
  const [snapshot, send] = useMachine(bluetoothMachine)
  const { colors } = useTheme()

  // Cleanup BLE manager on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up BLE Manager...');
      bleManager.destroy();
    };
  }, []);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: colors.background,
    },
    loadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    loadingText: {
      fontSize: 18,
      fontWeight: 'bold',
      marginTop: 16,
      textAlign: 'center',
      color: colors.text,
    },
    loadingSubtext: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
    },
    errorContainer: {
      alignItems: 'center',
      padding: 20,
      backgroundColor: colors.errorBackground,
      borderRadius: 8,
      margin: 10,
    },
    errorText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.accent,
      marginBottom: 8,
    },
    errorDetail: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
    },
    successContainer: {
      alignItems: 'center',
      padding: 20,
    },
    successText: {
      fontSize: 20,
      fontWeight: 'bold',
      color: colors.accent,
      marginBottom: 16,
      textAlign: 'center',
    },
    progressText: {
      fontSize: 24,
      fontWeight: 'bold',
      marginTop: 16,
      color: colors.accent,
    },
    progressBarContainer: {
      width: 300,
      height: 20,
      backgroundColor: colors.border,
      borderRadius: 10,
      marginTop: 10,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: colors.accent,
      borderRadius: 10,
    },
    downloadedImage: {
      width: 300,
      height: 300,
      marginTop: 20,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });

  return (
    <View style={styles.container}>
      {snapshot.value === 'CheckingBluetooth' && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Checking Bluetooth...</Text>
        </View>
      )}

      {snapshot.value === 'BluetoothNotReady' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Bluetooth is not ready</Text>
          <Text style={{ color: colors.text }}>Please enable bluetooth.</Text>
          {snapshot.context.error && (
            <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
          )}
          <Button onPress={() => send({ type: 'retry' })} title="Retry" />
        </View>
      )}

      {snapshot.value === 'ScanningAndConnecting' && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Scanning for {DEVICE_NAME}...</Text>
          <Text style={styles.loadingSubtext}>Connecting to device</Text>
        </View>
      )}

      {snapshot.value === 'ConnectionFailed' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Connection Failed</Text>
          <Text style={{ color: colors.text }}>Failed to connect to {DEVICE_NAME}</Text>
          {snapshot.context.error && (
            <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
          )}
          <Button onPress={() => send({ type: 'retry' })} title="Retry Connection" />
        </View>
      )}

      {snapshot.matches('DeviceConnected') && (
        <>
          {snapshot.matches('DeviceConnected.WaitingForUserInput') && (
            <View style={styles.successContainer}>
              <Text style={styles.successText}>✓ Connected to {snapshot.context.deviceName}!</Text>
              <Button onPress={() => send({ type: 'start' })} title="Start Photo Transfer" />
            </View>
          )}

          {snapshot.matches('DeviceConnected.SendingSleepCommand') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Sending SLEEP command...</Text>
              <Text style={styles.loadingSubtext}>Preparing device</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.AwaitingSleepResponse') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Waiting for device response...</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.SendingWakeCommand') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Sending WAKE command...</Text>
              <Text style={styles.loadingSubtext}>Requesting WiFi credentials</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.AwaitingWakeResponse') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Receiving WiFi credentials...</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.Connected') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>WiFi credentials received!</Text>
              {snapshot.context.wifiSSID && (
                <Text style={styles.loadingSubtext}>SSID: {snapshot.context.wifiSSID}</Text>
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.ConnectingToWifi') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Connecting to WiFi...</Text>
              <Text style={styles.loadingSubtext}>{snapshot.context.wifiSSID}</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.WifiConnectionFailed') && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>WiFi Connection Failed</Text>
              <Text style={{ color: colors.text }}>SSID: {snapshot.context.wifiSSID}</Text>
              {snapshot.context.error && (
                <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
              )}
              <Button onPress={() => send({ type: 'retryWifi' })} title="Retry WiFi Connection" />
            </View>
          )}

          {snapshot.matches('DeviceConnected.WifiConnected') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>✓ Connected to WiFi</Text>
              <Text style={styles.loadingSubtext}>{snapshot.context.wifiSSID}</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.WaitBeforeListing') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Preparing to list files...</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.ListingFiles') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Listing files from camera...</Text>
              <Text style={styles.loadingSubtext}>Searching DCIM/100NIKON</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.FileListingFailed') && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>File Listing Failed</Text>
              {snapshot.context.error && (
                <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.FilesListed') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Files found!</Text>
              <Text style={styles.loadingSubtext}>Preparing to download...</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.DownloadingFile') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Downloading photo...</Text>
              {snapshot.context.downloadingFile && (
                <Text style={styles.loadingSubtext}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.downloadProgress !== undefined && (
                <>
                  <Text style={styles.progressText}>{Math.round(snapshot.context.downloadProgress * 100)}%</Text>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[
                        styles.progressBar,
                        { width: `${snapshot.context.downloadProgress * 100}%` }
                      ]}
                    />
                  </View>
                </>
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.DownloadFailed') && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Download Failed</Text>
              {snapshot.context.downloadingFile && (
                <Text style={{ color: colors.text }}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.error && (
                <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.FileDownloaded') && (
            <View style={styles.successContainer}>
              <Text style={styles.successText}>✓ Photo Downloaded!</Text>
              {snapshot.context.downloadingFile && (
                <Text style={styles.loadingSubtext}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.localFileUri && (
                <Image
                  source={{ uri: snapshot.context.localFileUri }}
                  style={styles.downloadedImage}
                  resizeMode="cover"
                />
              )}
              <Button
                onPress={() => send({ type: 'generateMetadata' })}
                title="Upload Image to IPFS"
              />
            </View>
          )}

          {snapshot.matches('DeviceConnected.SendingSleepBeforeUpload') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Preparing SD card for upload...</Text>
              <Text style={styles.loadingSubtext}>Sending SLEEP command</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.AwaitingSleepResponseBeforeUpload') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Waiting for SD card response...</Text>
              <Text style={styles.loadingSubtext}>Confirming sleep mode</Text>
            </View>
          )}

          {snapshot.matches('DeviceConnected.UploadingImage') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.loadingText}>Uploading image to IPFS...</Text>
              {snapshot.context.downloadingFile && (
                <Text style={styles.loadingSubtext}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.localFileUri && (
                <Image
                  source={{ uri: snapshot.context.localFileUri }}
                  style={styles.downloadedImage}
                  resizeMode="cover"
                />
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.ImageUploadFailed') && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Image Upload Failed</Text>
              {snapshot.context.downloadingFile && (
                <Text style={{ color: colors.text }}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.error && (
                <Text style={styles.errorDetail}>{snapshot.context.error}</Text>
              )}
              {snapshot.context.localFileUri && (
                <Image
                  source={{ uri: snapshot.context.localFileUri }}
                  style={styles.downloadedImage}
                  resizeMode="cover"
                />
              )}
            </View>
          )}

          {snapshot.matches('DeviceConnected.ImageUploaded') && (
            <View style={styles.successContainer}>
              <Text style={styles.successText}>✓ Image Uploaded to IPFS!</Text>
              {snapshot.context.downloadingFile && (
                <Text style={styles.loadingSubtext}>{snapshot.context.downloadingFile.name}</Text>
              )}
              {snapshot.context.imageIpfsUri && (
                <Text style={styles.loadingSubtext}>IPFS URI: {snapshot.context.imageIpfsUri}</Text>
              )}
              {snapshot.context.localFileUri && (
                <Image
                  source={{ uri: snapshot.context.localFileUri }}
                  style={styles.downloadedImage}
                  resizeMode="cover"
                />
              )}
            </View>
          )}
        </>
      )}
    </View>
  )
}
