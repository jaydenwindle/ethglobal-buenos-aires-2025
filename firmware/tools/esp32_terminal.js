#!/usr/bin/env node
/**
 * ESP32 Bluetooth & Serial Terminal
 * Node.js version with blessed TUI
 */

const blessed = require('blessed');
const noble = require('@abandonware/noble');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

// BLE UART Service UUIDs
const SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e';
const RX_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';
const TX_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';

const DEFAULT_DEVICE_NAME = 'digicam-001';

class ESP32Terminal {
  constructor(deviceName = DEFAULT_DEVICE_NAME) {
    this.deviceName = deviceName;
    this.blePeripheral = null;
    this.bleCharacteristics = {};
    this.serialProcess = null;
    this.screen = null;
    this.btLog = null;
    this.serialLog = null;
    this.input = null;
    this.statusBox = null;
    
    // Serial data buffer for handling \r properly
    this.serialBuffer = '';
    this.serialFlushTimer = null;
    
    // ESP32 status data
    this.esp32Status = {
      power: 'Unknown',
      wifi: 'Unknown',
      ap: 'Unknown',
      ip: 'Unknown',
      lastUpdate: null
    };
    
    // Log file setup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.btLogFile = path.join(logDir, `bt_${timestamp}.txt`);
    this.serialLogFile = path.join(logDir, `serial_${timestamp}.txt`);
    
    // Create log files
    fs.writeFileSync(this.btLogFile, `ESP32 Bluetooth Log - ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`);
    fs.writeFileSync(this.serialLogFile, `ESP32 Serial Log - ${new Date().toISOString()}\n${'='.repeat(60)}\n\n`);
  }

  createUI() {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'ESP32 Terminal',
      mouse: true,  // Enable mouse support
      sendFocus: true,
      warnings: true
    });
    
    // Enable raw mode to capture all keys including Ctrl-C
    this.screen.program.key('C-c', () => {
      this.exit();
    });

    // Header
    const header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}{bold}ESP32 Bluetooth & Serial Terminal{/bold}{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });

    // Status panel
    this.statusBox = blessed.box({
      top: 3,
      left: 0,
      width: '100%',
      height: 5,
      border: { type: 'line' },
      label: ' ESP32 Status ',
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'yellow' }
      }
    });

    // Bluetooth log (left pane)
    this.btLog = blessed.log({
      top: 8,
      left: 0,
      width: '50%',
      height: '100%-11',
      border: { type: 'line' },
      label: ' Bluetooth ',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,  // Enable mouse for this widget
      keys: true,   // Enable keyboard scrolling
      vi: true,     // Enable vi-style scrolling (j/k)
      scrollbar: {
        ch: ' ',
        style: { bg: 'cyan' }
      },
      style: {
        fg: 'cyan',
        border: { fg: 'cyan' }
      }
    });

    // Serial log (right pane)
    this.serialLog = blessed.log({
      top: 8,
      left: '50%',
      width: '50%',
      height: '100%-11',
      border: { type: 'line' },
      label: ' Serial Monitor ',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,  // Enable mouse for this widget
      keys: true,   // Enable keyboard scrolling
      vi: true,     // Enable vi-style scrolling (j/k)
      scrollbar: {
        ch: ' ',
        style: { bg: 'magenta' }
      },
      style: {
        fg: 'white',
        border: { fg: 'magenta' }
      }
    });

    // Input box
    this.input = blessed.textbox({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      label: ' Command (type and press Enter, or "q/quit/esc/ctrl+c" to exit) ',
      style: {
        fg: 'white',
        border: { fg: 'green' }
      },
      inputOnFocus: true
    });

    // Append to screen
    this.screen.append(header);
    this.screen.append(this.statusBox);
    this.screen.append(this.btLog);
    this.screen.append(this.serialLog);
    this.screen.append(this.input);
    
    // Initial status display
    this.updateStatusDisplay();

    // Focus input
    this.input.focus();

    // Handle input submission
    this.input.on('submit', (value) => {
      const command = value.trim();
      this.input.clearValue();
      
      if (command.toLowerCase() === 'quit' || command.toLowerCase() === 'exit' || command.toLowerCase() === 'q') {
        this.exit();
        return;
      }
      
      if (command) {
        this.sendBLECommand(command);
      }
      
      this.input.focus();
      this.screen.render();
    });

    // Quit on Escape, q, or Ctrl-C
    this.screen.key(['escape', 'C-c', 'q'], (ch, key) => {
      this.exit();
    });

    // Also bind to raw Ctrl-C
    this.screen.key(['C-c'], (ch, key) => {
      this.exit();
    });

    this.screen.render();
  }

  updateStatusDisplay() {
    const status = this.esp32Status;
    const lastUpdate = status.lastUpdate ? status.lastUpdate.toLocaleTimeString() : 'Never';
    const btStatus = this.blePeripheral ? '{green-fg}Connected{/green-fg}' : '{red-fg}Disconnected{/red-fg}';
    
    const content = 
      `  {yellow-fg}BLE:{/yellow-fg} ${btStatus}     ` +
      `{yellow-fg}WiFi:{/yellow-fg} ${status.wifi}     ` +
      `{yellow-fg}AP:{/yellow-fg} ${status.ap}\n` +
      `  {yellow-fg}IP:{/yellow-fg} ${status.ip}     ` +
      `{yellow-fg}Power:{/yellow-fg} ${status.power}     ` +
      `{dim}Updated: ${lastUpdate}{/dim}`;
    
    this.statusBox.setContent(content);
    this.screen.render();
  }

  parseStatusResponse(message) {
    // Parse STATUS command responses to update status display
    let updated = false;
    
    // WiFi status - look for "WiFi: ON/OFF" or "WiFi ON/OFF"
    if (/wifi[:\s]+(on|off|enabled|disabled|connected)/i.test(message)) {
      const match = message.match(/wifi[:\s]+(on|off|enabled|disabled|connected)/i);
      if (match) {
        this.esp32Status.wifi = match[1].toUpperCase();
        updated = true;
      }
    }
    
    // AP/SSID - look for "AP: name" or "SSID: name"
    if (/(?:ap|ssid)[:\s]+([^\s,\n]+)/i.test(message)) {
      const match = message.match(/(?:ap|ssid)[:\s]+([^\s,\n]+)/i);
      if (match) {
        this.esp32Status.ap = match[1];
        updated = true;
      }
    }
    
    // IP address
    if (/ip[:\s]+([\d.]+)/i.test(message)) {
      const match = message.match(/ip[:\s]+([\d.]+)/i);
      if (match) {
        this.esp32Status.ip = match[1];
        updated = true;
      }
    }
    
    // Power/Battery/Voltage
    if (/([\d.]+)\s*(v|mw|ma|mah|%)/i.test(message)) {
      const match = message.match(/([\d.]+)\s*(v|mw|ma|mah|%)/i);
      if (match) {
        this.esp32Status.power = match[0];
        updated = true;
      }
    }
    
    if (updated) {
      this.esp32Status.lastUpdate = new Date();
      this.updateStatusDisplay();
    }
  }

  exit() {
    // Destroy screen first to restore terminal
    if (this.screen) {
      this.screen.destroy();
    }
    this.cleanup();
    process.exit(0);
  }

  async connectBluetooth() {
    return new Promise((resolve, reject) => {
      const timestamp = new Date().toLocaleTimeString();
      const scanMsg = `[${timestamp}] Scanning for '${this.deviceName}'...`;
      this.btLog.log(`{yellow-fg}${scanMsg}{/yellow-fg}`);
      fs.appendFileSync(this.btLogFile, scanMsg + '\n');
      this.screen.render();

      let connected = false;
      let timeoutHandle = null;

      const onDiscover = async (peripheral) => {
        if (peripheral.advertisement.localName === this.deviceName) {
          noble.stopScanning();
          
          // Clear timeout since we found the device
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          
          const timestamp = new Date().toLocaleTimeString();
          const foundMsg = `[${timestamp}] ✓ Found: ${peripheral.advertisement.localName}`;
          this.btLog.log(`{green-fg}${foundMsg}{/green-fg}`);
          fs.appendFileSync(this.btLogFile, foundMsg + '\n');
          this.screen.render();

          try {
            await peripheral.connectAsync();
            this.blePeripheral = peripheral;
            
            const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
              [SERVICE_UUID],
              [RX_UUID, TX_UUID]
            );

            characteristics.forEach(char => {
              this.bleCharacteristics[char.uuid] = char;
            });

            // Subscribe to notifications
            const txChar = this.bleCharacteristics[TX_UUID];
            if (txChar) {
              await txChar.subscribeAsync();
              txChar.on('data', (data) => {
                const message = data.toString('utf-8').trim();
                if (message) {
                  const timestamp = new Date().toLocaleTimeString();
                  this.btLog.log(`{cyan-fg}[${timestamp}] ${message}{/cyan-fg}`);
                  // Save to log file
                  fs.appendFileSync(this.btLogFile, `[${timestamp}] ${message}\n`);
                  
                  // Parse for status information
                  this.parseStatusResponse(message);
                  
                  this.screen.render();
                }
              });
            }

            const timestamp = new Date().toLocaleTimeString();
            const connectedMsg = `[${timestamp}] ✓ Bluetooth connected!`;
            this.btLog.log(`{green-fg}{bold}${connectedMsg}{/bold}{/green-fg}`);
            fs.appendFileSync(this.btLogFile, connectedMsg + '\n');
            
            // Update status display to show BLE connected
            this.updateStatusDisplay();
            
            this.screen.render();
            
            connected = true;
            noble.removeListener('discover', onDiscover);
            resolve(true);
          } catch (err) {
            const timestamp = new Date().toLocaleTimeString();
            const errorMsg = `[${timestamp}] ❌ Connection failed: ${err.message}`;
            this.btLog.log(`{red-fg}${errorMsg}{/red-fg}`);
            fs.appendFileSync(this.btLogFile, errorMsg + '\n');
            this.screen.render();
            
            noble.removeListener('discover', onDiscover);
            reject(err);
          }
        }
      };

      noble.on('discover', onDiscover);
      noble.startScanning([], false);

      // Timeout after 10 seconds
      timeoutHandle = setTimeout(() => {
        if (!connected) {
          noble.stopScanning();
          noble.removeListener('discover', onDiscover);
          const timestamp = new Date().toLocaleTimeString();
          const timeoutMsg = `[${timestamp}] ❌ Device '${this.deviceName}' not found!`;
          this.btLog.log(`{red-fg}${timeoutMsg}{/red-fg}`);
          fs.appendFileSync(this.btLogFile, timeoutMsg + '\n');
          this.screen.render();
          reject(new Error('Device not found'));
        }
      }, 10000);
    });
  }

  async sendBLECommand(command) {
    if (!this.blePeripheral || !this.bleCharacteristics[RX_UUID]) {
      const timestamp = new Date().toLocaleTimeString();
      const msg = `[${timestamp}] Not connected!`;
      this.btLog.log(`{red-fg}${msg}{/red-fg}`);
      fs.appendFileSync(this.btLogFile, msg + '\n');
      this.screen.render();
      return;
    }

    try {
      const timestamp = new Date().toLocaleTimeString();
      const msg = `[${timestamp}] > ${command}`;
      this.btLog.log(`{green-fg}${msg}{/green-fg}`);
      fs.appendFileSync(this.btLogFile, msg + '\n');
      
      const rxChar = this.bleCharacteristics[RX_UUID];
      await rxChar.writeAsync(Buffer.from(command, 'utf-8'), false);
      
      this.screen.render();
    } catch (err) {
      const timestamp = new Date().toLocaleTimeString();
      const msg = `[${timestamp}] Error: ${err.message}`;
      this.btLog.log(`{red-fg}${msg}{/red-fg}`);
      fs.appendFileSync(this.btLogFile, msg + '\n');
      this.screen.render();
    }
  }

  startSerialMonitor() {
    const timestamp = new Date().toLocaleTimeString();
    const startMsg = `[${timestamp}] Starting platformio serial monitor...`;
    this.serialLog.log(`{yellow-fg}${startMsg}{/yellow-fg}`);
    fs.appendFileSync(this.serialLogFile, startMsg + '\n');
    this.screen.render();

    try {
      // Use PTY to provide a pseudo-terminal for platformio
      this.serialProcess = pty.spawn('platformio', ['device', 'monitor', '--baud', '115200'], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: process.env,
        handleFlowControl: false  // Don't let PTY handle Ctrl-C
      });

      // Handle data from PTY
      this.serialProcess.onData((data) => {
        // Remove ANSI escape codes first
        const cleaned = data.replace(/\x1b\[[0-9;]*m/g, '');
        
        // Add to buffer
        this.serialBuffer += cleaned;
        
        // Clear existing flush timer
        if (this.serialFlushTimer) {
          clearTimeout(this.serialFlushTimer);
        }
        
        // Look for complete lines (ending with \n or \r\n)
        let processedSomething = false;
        while (this.serialBuffer.includes('\n')) {
          const newlineIndex = this.serialBuffer.indexOf('\n');
          let line = this.serialBuffer.substring(0, newlineIndex);
          this.serialBuffer = this.serialBuffer.substring(newlineIndex + 1);
          
          // Remove any trailing \r
          line = line.replace(/\r$/, '').trim();
          
          if (line && !line.startsWith('---')) {
            const timestamp = new Date().toLocaleTimeString();
            this.serialLog.log(`{cyan-fg}[${timestamp}] ${line}{/cyan-fg}`);
            fs.appendFileSync(this.serialLogFile, `[${timestamp}] ${line}\n`);
            processedSomething = true;
          }
        }
        
        // Set timer to flush incomplete buffer after 200ms of no new data
        this.serialFlushTimer = setTimeout(() => {
          if (this.serialBuffer.trim()) {
            const line = this.serialBuffer.trim();
            if (line && !line.startsWith('---')) {
              const timestamp = new Date().toLocaleTimeString();
              this.serialLog.log(`{cyan-fg}[${timestamp}] ${line}{/cyan-fg}`);
              fs.appendFileSync(this.serialLogFile, `[${timestamp}] ${line}\n`);
              this.screen.render();
            }
            this.serialBuffer = '';
          }
        }, 200);
        
        if (processedSomething) {
          this.screen.render();
        }
      });

      this.serialProcess.onExit(({ exitCode, signal }) => {
        const timestamp = new Date().toLocaleTimeString();
        const msg = `[${timestamp}] Serial monitor stopped (exit code: ${exitCode}, signal: ${signal})`;
        this.serialLog.log(`{yellow-fg}${msg}{/yellow-fg}`);
        fs.appendFileSync(this.serialLogFile, msg + '\n');
        this.screen.render();
      });

      const successTimestamp = new Date().toLocaleTimeString();
      const successMsg = `[${successTimestamp}] ✓ Serial monitor started!`;
      this.serialLog.log(`{green-fg}{bold}${successMsg}{/bold}{/green-fg}`);
      fs.appendFileSync(this.serialLogFile, successMsg + '\n');
      this.screen.render();
    } catch (err) {
      const timestamp = new Date().toLocaleTimeString();
      const errorMsg = `[${timestamp}] ❌ Failed to start serial monitor: ${err.message}`;
      this.serialLog.log(`{red-fg}${errorMsg}{/red-fg}`);
      fs.appendFileSync(this.serialLogFile, errorMsg + '\n');
      this.screen.render();
    }
  }

  cleanup() {
    if (this.serialProcess) {
      try {
        this.serialProcess.kill();
      } catch (err) {
        // Ignore errors on cleanup
      }
    }
    if (this.blePeripheral) {
      try {
        this.blePeripheral.disconnect();
      } catch (err) {
        // Ignore errors on cleanup
      }
    }
    
    // Print log file locations
    console.log('\nLogs saved to:');
    console.log(`  Bluetooth: ${this.btLogFile}`);
    console.log(`  Serial:    ${this.serialLogFile}`);
  }

  async start() {
    this.createUI();
    
    try {
      await this.connectBluetooth();
    } catch (err) {
      // Continue even if BT fails
    }

    this.startSerialMonitor();
  }
}

// Main
const deviceName = process.argv[2] || DEFAULT_DEVICE_NAME;
const terminal = new ESP32Terminal(deviceName);

// Handle Ctrl-C at process level
let exiting = false;
process.on('SIGINT', () => {
  if (exiting) return;
  exiting = true;
  
  if (terminal.screen) {
    terminal.exit();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  if (exiting) return;
  exiting = true;
  
  if (terminal.screen) {
    terminal.exit();
  } else {
    process.exit(0);
  }
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  if (terminal.screen) {
    terminal.screen.destroy();
  }
  console.error('Error:', err.message);
  process.exit(1);
});

terminal.start();
