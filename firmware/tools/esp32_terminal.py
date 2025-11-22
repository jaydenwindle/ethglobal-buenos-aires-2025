#!/usr/bin/env python3
"""
ESP32 Bluetooth Terminal
Simple interactive terminal for ESP32-SD-WiFi device

Requirements:
    pip install bleak

Usage:
    python esp32_terminal.py [device_name]
    
    device_name: Optional Bluetooth device name (default: digicam-001)
    
Examples:
    python esp32_terminal.py                    # Connect to digicam-001
    python esp32_terminal.py ESP32-SD-WiFi      # Connect to ESP32-SD-WiFi
    python esp32_terminal.py my-device          # Connect to my-device

Commands:
    HELP                              - Show available commands
    STATUS                            - Show device status
    WIFI ON/OFF                       - Enable/disable WiFi
    WIFI SCAN                         - Scan for networks
    WIFI CONNECT <ssid> <password>    - Connect to WiFi
    WIFI AP                           - Start Access Point mode
    SLEEP                             - Enter sleep mode
    WAKE                              - Wake from sleep mode
    RESTART                           - Restart device
"""

import asyncio
import sys
from bleak import BleakClient, BleakScanner

# BLE UART Service UUIDs
SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  # Write to ESP32
TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  # Receive from ESP32

# Default device name (can be overridden by command line argument)
DEFAULT_DEVICE_NAME = "digicam-001"

class ESP32Terminal:
    def __init__(self, device_name=DEFAULT_DEVICE_NAME):
        self.client = None
        self.connected = False
        self.device_name = device_name
        
    def notification_handler(self, sender, data):
        """Handle incoming data from ESP32"""
        try:
            message = data.decode('utf-8')
            print(message, end='')
        except UnicodeDecodeError:
            print(f"[Binary data: {data.hex()}]")
    
    async def connect(self):
        """Scan for and connect to ESP32 device"""
        print(f"Scanning for '{self.device_name}'...")
        device = await BleakScanner.find_device_by_name(self.device_name, timeout=10.0)
        
        if not device:
            print(f"\n❌ Device '{self.device_name}' not found!")
            print("Make sure:")
            print("  1. Device is powered on")
            print("  2. Bluetooth is enabled on your computer")
            print("  3. Device is within range")
            print(f"  4. Device name matches '{self.device_name}' (check SETUP.INI BT_SSID)")
            return False
        
        print(f"✓ Found device: {device.name} ({device.address})")
        print("Connecting...")
        
        try:
            self.client = BleakClient(device)
            await self.client.connect()
            
            # Enable notifications
            await self.client.start_notify(TX_UUID, self.notification_handler)
            
            self.connected = True
            print("✓ Connected!\n")
            return True
            
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False
    
    async def send_command(self, command):
        """Send command to ESP32"""
        if not self.connected or not self.client:
            print("Not connected!")
            return False
        
        try:
            await self.client.write_gatt_char(RX_UUID, command.encode('utf-8'))
            
            # Wait longer for commands that need more time
            command_upper = command.upper().strip()
            if command_upper in ['WAKE', 'WIFI ON', 'WIFI AP', 'WIFI CONNECT']:
                await asyncio.sleep(2.0)  # Wait 2 seconds for WiFi operations
            elif command_upper in ['STATUS', 'WIFI SCAN']:
                await asyncio.sleep(0.5)  # Wait 0.5 seconds for status/scan
            else:
                await asyncio.sleep(0.3)  # Default wait
            
            return True
        except Exception as e:
            print(f"Error sending command: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from ESP32"""
        if self.client and self.connected:
            await self.client.disconnect()
            self.connected = False
            print("\n✓ Disconnected")
    
    async def interactive_mode(self):
        """Run interactive terminal"""
        print("=" * 60)
        print("ESP32 Bluetooth Terminal")
        print("=" * 60)
        print("\nType commands and press Enter")
        print("Commands: HELP, STATUS, WIFI SCAN, etc.")
        print("Type 'quit' or press Ctrl+C to exit\n")
        
        # Send initial HELP command
        await self.send_command("HELP")
        print()
        
        while self.connected:
            try:
                # Get user input
                command = input("> ")
                
                if command.lower() in ['quit', 'exit', 'q']:
                    break
                
                if command.strip():
                    await self.send_command(command)
                    
            except KeyboardInterrupt:
                print("\n")
                break
            except EOFError:
                break

async def main():
    # Get device name from command line argument or use default
    device_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DEVICE_NAME
    
    print(f"ESP32 Bluetooth Terminal")
    print(f"Target device: {device_name}")
    print("-" * 60)
    
    terminal = ESP32Terminal(device_name)
    
    try:
        # Connect to device
        if await terminal.connect():
            # Run interactive mode
            await terminal.interactive_mode()
    finally:
        # Always disconnect
        await terminal.disconnect()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
        sys.exit(0)
