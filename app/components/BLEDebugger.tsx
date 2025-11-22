import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useBLE } from "../hooks/useBLE";
import { useTheme } from "../theme/ThemeContext";
import { FileBrowser } from "./FileBrowser";

export const BLEDebugger = () => {
  const {
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
  } = useBLE();

  const { colors } = useTheme();
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [hasNetworkPermission, setHasNetworkPermission] = useState(false);

  const handleStatusCommand = () => {
    sendCommand("STATUS");
  };

  const handleWakeCommand = () => {
    sendCommand("WAKE");
  };

  const handleSleepCommand = () => {
    sendCommand("SLEEP");
  };

  const handleConnectWifi = () => {
    if (wifiCredentials) {
      connectToWifi(wifiCredentials.ssid, wifiCredentials.password);
    }
  };

  const requestNetworkPermission = async () => {
    if (!deviceIpAddress) {
      Alert.alert("Error", "No device IP address available. Please connect to WiFi first.");
      return;
    }

    try {
      // Make a test request to trigger the local network permission prompt on iOS
      // This will show the "Allow app to find and connect to devices on your local network" dialog
      const testUrl = `http://${deviceIpAddress}/wifistatus`;

      await fetch(testUrl, {
        method: 'GET',
      });

      // If we got here, we have network permission
      setHasNetworkPermission(true);
      setShowFileBrowser(true);
    } catch (error) {
      // Even if request fails, still show the file browser
      // The user may have granted permission but device isn't responding yet
      setHasNetworkPermission(true);
      setShowFileBrowser(true);
    }
  };

  const handleBrowseFiles = async () => {
    // Trigger local network permission prompt before showing file browser
    await requestNetworkPermission();
  };

  const handleCloseBrowser = () => {
    setShowFileBrowser(false);
  };

  // Extract IP address from WiFi credentials SSID if connected
  // Assuming the ESP32 AP has a known IP (typically 192.168.4.1 for ESP32 AP mode)
  const deviceIpAddress = wifiConnected ? "192.168.4.1" : null;

  const createStyles = () =>
    StyleSheet.create({
      container: {
        flex: 1,
      },
      scrollContainer: {
        flexGrow: 1,
        padding: 20,
      },
      header: {
        marginBottom: 20,
      },
      title: {
        fontSize: 24,
        fontWeight: "bold",
        color: colors.text,
        marginBottom: 8,
      },
      stateText: {
        fontSize: 16,
        color: colors.textSecondary,
        marginBottom: 4,
      },
      statusIndicator: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 8,
      },
      statusDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
      },
      statusText: {
        fontSize: 16,
        fontWeight: "600",
        color: colors.text,
      },
      buttonContainer: {
        gap: 12,
        marginBottom: 20,
      },
      button: {
        backgroundColor: colors.accent,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 48,
      },
      buttonDisabled: {
        backgroundColor: colors.textSecondary,
        opacity: 0.6,
      },
      buttonDanger: {
        backgroundColor: "#dc3545",
      },
      buttonSecondary: {
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.border,
      },
      buttonSuccess: {
        backgroundColor: "#28a745",
      },
      buttonWarning: {
        backgroundColor: "#ffc107",
      },
      buttonText: {
        color: "#ffffff",
        fontSize: 16,
        fontWeight: "600",
      },
      buttonTextSecondary: {
        color: colors.text,
      },
      section: {
        marginBottom: 20,
      },
      sectionTitle: {
        fontSize: 18,
        fontWeight: "bold",
        color: colors.text,
        marginBottom: 12,
      },
      receivedDataContainer: {
        backgroundColor: colors.cardBackground,
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        minHeight: 100,
      },
      receivedDataText: {
        fontFamily: "monospace",
        fontSize: 14,
        color: colors.text,
        lineHeight: 20,
      },
      receivedDataEmpty: {
        color: colors.textSecondary,
        fontStyle: "italic",
      },
      logsContainer: {
        minHeight: 200,
        backgroundColor: colors.cardBackground,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
      },
      logsHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      logsTitle: {
        fontSize: 16,
        fontWeight: "600",
        color: colors.text,
      },
      clearButton: {
        paddingVertical: 4,
        paddingHorizontal: 12,
        backgroundColor: colors.border,
        borderRadius: 4,
      },
      clearButtonText: {
        color: colors.text,
        fontSize: 14,
        fontWeight: "500",
      },
      logsScrollView: {
        maxHeight: 300,
      },
      logEntry: {
        marginBottom: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 4,
        borderLeftWidth: 3,
      },
      logInfo: {
        backgroundColor: colors.background,
        borderLeftColor: "#6c757d",
      },
      logSuccess: {
        backgroundColor: colors.background,
        borderLeftColor: "#28a745",
      },
      logError: {
        backgroundColor: colors.background,
        borderLeftColor: "#dc3545",
      },
      logData: {
        backgroundColor: colors.background,
        borderLeftColor: "#007bff",
      },
      logText: {
        fontFamily: "monospace",
        fontSize: 12,
        color: colors.text,
        lineHeight: 18,
      },
      logTimestamp: {
        color: colors.textSecondary,
        fontWeight: "600",
      },
      wifiStatusContainer: {
        backgroundColor: colors.cardBackground,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 12,
      },
      wifiStatusText: {
        fontSize: 14,
        color: colors.text,
        marginBottom: 4,
      },
      wifiStatusLabel: {
        fontWeight: "600",
      },
      buttonRow: {
        flexDirection: "row",
        gap: 12,
      },
      buttonHalf: {
        flex: 1,
      },
    });

  const styles = createStyles();

  const getStatusColor = () => {
    if (isConnected) return "#28a745";
    if (isScanning) return "#ffc107";
    if (bluetoothState === "PoweredOn") return "#6c757d";
    return "#dc3545";
  };

  const getStatusText = () => {
    if (isConnected) return "Connected";
    if (isScanning) return "Scanning...";
    if (bluetoothState === "PoweredOn") return "Ready";
    return `Bluetooth ${bluetoothState}`;
  };

  // Show file browser if WiFi is connected and user requested it
  if (showFileBrowser && deviceIpAddress) {
    return (
      <View style={styles.container}>
        <View style={styles.scrollContainer}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleCloseBrowser} style={{ marginRight: 12 }}>
              <Text style={{ fontSize: 18, color: colors.accent, fontWeight: "600" }}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>SD Card Files</Text>
          </View>
          <View style={{ flex: 1 }}>
            <FileBrowser ipAddress={deviceIpAddress} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContainer}
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.header}>
        <Text style={styles.title}>ESP32 SD Card</Text>
        <Text style={styles.stateText}>Bluetooth State: {bluetoothState}</Text>
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.statusText}>{getStatusText()}</Text>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        {!isConnected ? (
          <TouchableOpacity
            style={[styles.button, isScanning && styles.buttonDisabled]}
            onPress={scanForDevices}
            disabled={isScanning || bluetoothState !== "PoweredOn"}
          >
            {isScanning ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Scan & Connect</Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.buttonSuccess, styles.buttonHalf]}
                onPress={handleWakeCommand}
                disabled={wifiConnecting}
              >
                {wifiConnecting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>Wake Device</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonWarning, styles.buttonHalf]}
                onPress={handleSleepCommand}
              >
                <Text style={styles.buttonText}>Sleep Device</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.button} onPress={handleStatusCommand}>
              <Text style={styles.buttonText}>Get STATUS</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDanger]}
              onPress={disconnect}
            >
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {wifiCredentials && (
        <View style={styles.wifiStatusContainer}>
          <Text style={styles.wifiStatusText}>
            <Text style={styles.wifiStatusLabel}>WiFi Network: </Text>
            {wifiCredentials.ssid}
          </Text>
          <Text style={styles.wifiStatusText}>
            <Text style={styles.wifiStatusLabel}>Password: </Text>
            {wifiCredentials.password}
          </Text>
          <Text style={styles.wifiStatusText}>
            <Text style={styles.wifiStatusLabel}>Status: </Text>
            {wifiConnecting ? "Connecting..." : wifiConnected ? "Connected ✓" : "Not connected"}
          </Text>
          {!wifiConnected ? (
            <TouchableOpacity
              style={[styles.button, { marginTop: 12 }]}
              onPress={handleConnectWifi}
              disabled={wifiConnecting}
            >
              {wifiConnecting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Connect to WiFi</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.buttonSuccess, { marginTop: 12 }]}
              onPress={handleBrowseFiles}
            >
              <Text style={styles.buttonText}>Browse SD Card Files</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {isConnected && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Device Response</Text>
          <View style={styles.receivedDataContainer}>
            <Text
              style={[
                styles.receivedDataText,
                !receivedData && styles.receivedDataEmpty,
              ]}
            >
              {receivedData || "No data received yet. Send a command to see the response."}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.logsContainer}>
          <View style={styles.logsHeader}>
            <Text style={styles.logsTitle}>Debug Logs ({logs.length})</Text>
            <TouchableOpacity style={styles.clearButton} onPress={clearLogs}>
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.logsScrollView}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {logs.map((log, index) => (
              <View
                key={index}
                style={[
                  styles.logEntry,
                  log.type === "info" && styles.logInfo,
                  log.type === "success" && styles.logSuccess,
                  log.type === "error" && styles.logError,
                  log.type === "data" && styles.logData,
                ]}
              >
                <Text style={styles.logText}>
                  <Text style={styles.logTimestamp}>[{log.timestamp}]</Text> {log.message}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </ScrollView>
  );
};
