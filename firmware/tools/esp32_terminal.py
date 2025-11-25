#!/usr/bin/env python3
"""
ESP32 Bluetooth & Serial Terminal
Interactive terminal for ESP32-SD-WiFi device with dual monitoring

Requirements:
    pip install bleak textual
    platformio (for serial monitoring)

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
import subprocess
import threading
from datetime import datetime
from collections import deque
from bleak import BleakClient, BleakScanner
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Header, Footer, Static, Input, RichLog
from textual.binding import Binding

# BLE UART Service UUIDs
SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  # Write to ESP32
TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  # Receive from ESP32

# Defaults
DEFAULT_DEVICE_NAME = "digicam-001"
DEFAULT_BAUD_RATE = 115200
MAX_LOG_LINES = 500

class ESP32Terminal(App):
    """Textual app for ESP32 terminal"""
    
    CSS = """
    #bt_log {
        border: solid cyan;
        height: 100%;
    }
    
    #serial_log {
        border: solid magenta;
        height: 100%;
    }
    
    #logs_container {
        height: 1fr;
    }
    
    #input_container {
        height: auto;
        padding: 1;
    }
    """
    
    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit"),
    ]
    
    def __init__(self, device_name=DEFAULT_DEVICE_NAME):
        super().__init__()
        # Bluetooth
        self.client = None
        self.bt_connected = False
        self.device_name = device_name
        
        # Serial (via platformio)
        self.serial_process = None
        self.serial_connected = False
        
        # UI state
        self.running = False
        self.bt_log_widget = None
        self.serial_log_widget = None
        self.input_widget = None
        
        # Message queues for thread-safe logging
        self.bt_message_queue = asyncio.Queue()
        self.serial_message_queue = asyncio.Queue()
        
        # Buffers for periodic updates (reduces render frequency)
        self.bt_buffer = []
        self.serial_buffer = []
        
    def compose(self) -> ComposeResult:
        """Create child widgets"""
        yield Header()
        with Vertical(id="logs_container"):
            with Horizontal():
                yield RichLog(id="bt_log", highlight=True, markup=True, max_lines=1000)
                yield RichLog(id="serial_log", highlight=True, markup=True, max_lines=1000)
        with Container(id="input_container"):
            yield Input(placeholder="Type command and press Enter (or 'quit' to exit)")
        yield Footer()
    
    def on_mount(self) -> None:
        """Called when app starts"""
        self.bt_log_widget = self.query_one("#bt_log", RichLog)
        self.serial_log_widget = self.query_one("#serial_log", RichLog)
        self.input_widget = self.query_one(Input)
        
        self.bt_log_widget.border_title = "Bluetooth"
        self.serial_log_widget.border_title = "Serial Monitor"
        
        self.input_widget.focus()
        
        # Get event loop for thread-safe operations
        self.loop = asyncio.get_event_loop()
        
        # Start connections
        self.running = True
        asyncio.create_task(self.connect_devices())
        
        # Start message collectors (collect messages into buffers)
        asyncio.create_task(self.collect_bt_messages())
        asyncio.create_task(self.collect_serial_messages())
        
        # Start periodic renderers (update UI on timer, not on every message)
        self.set_interval(0.1, self.render_bt_buffer)  # Update BT every 100ms
        self.set_interval(0.2, self.render_serial_buffer)  # Update Serial every 200ms
    
    async def connect_devices(self):
        """Connect to Bluetooth and start serial monitor"""
        await self.connect_bluetooth()
        self.start_serial_monitor()
        
        if self.bt_connected:
            await self.send_command("HELP")
    
    def notification_handler(self, sender, data):
        """Handle incoming data from ESP32 via Bluetooth"""
        try:
            message = data.decode('utf-8').rstrip('\n\r')
            if message:
                timestamp = datetime.now().strftime("%H:%M:%S")
                # Queue message for processing in main loop
                asyncio.run_coroutine_threadsafe(
                    self.bt_message_queue.put(f"[dim]{timestamp}[/] {message}"),
                    self.loop
                )
        except UnicodeDecodeError:
            timestamp = datetime.now().strftime("%H:%M:%S")
            asyncio.run_coroutine_threadsafe(
                self.bt_message_queue.put(f"[dim]{timestamp}[/] [yellow][Binary: {data.hex()}][/]"),
                self.loop
            )
    
    async def collect_bt_messages(self):
        """Collect Bluetooth messages into buffer without rendering"""
        while self.running:
            try:
                message = await self.bt_message_queue.get()
                self.bt_buffer.append(message)
                # Limit buffer size
                if len(self.bt_buffer) > 100:
                    self.bt_buffer = self.bt_buffer[-100:]
            except Exception:
                pass
    
    async def collect_serial_messages(self):
        """Collect Serial messages into buffer without rendering"""
        while self.running:
            try:
                message = await self.serial_message_queue.get()
                self.serial_buffer.append(message)
                # Limit buffer size
                if len(self.serial_buffer) > 100:
                    self.serial_buffer = self.serial_buffer[-100:]
            except Exception:
                pass
    
    def render_bt_buffer(self):
        """Render buffered BT messages (called on timer)"""
        if self.bt_buffer:
            with self.batch_update():
                for msg in self.bt_buffer:
                    self.bt_log_widget.write(msg)
            self.bt_buffer = []
    
    def render_serial_buffer(self):
        """Render buffered Serial messages (called on timer)"""
        if self.serial_buffer:
            with self.batch_update():
                for msg in self.serial_buffer:
                    self.serial_log_widget.write(msg)
            self.serial_buffer = []
    
    async def connect_bluetooth(self):
        """Scan for and connect to ESP32 device via Bluetooth"""
        self.bt_log_widget.write(f"[yellow]Scanning for '{self.device_name}'...[/]")
        device = await BleakScanner.find_device_by_name(self.device_name, timeout=10.0)
        
        if not device:
            self.bt_log_widget.write(f"[red]❌ Device '{self.device_name}' not found![/]")
            return False
        
        self.bt_log_widget.write(f"[green]✓ Found: {device.name} ({device.address})[/]")
        
        try:
            self.client = BleakClient(device)
            await self.client.connect()
            await self.client.start_notify(TX_UUID, self.notification_handler)
            
            self.bt_connected = True
            self.bt_log_widget.write("[green bold]✓ Bluetooth connected![/]")
            self.sub_title = "BT: Connected"
            return True
            
        except Exception as e:
            self.bt_log_widget.write(f"[red]❌ Connection failed: {e}[/]")
            return False
    
    def start_serial_monitor(self):
        """Start platformio serial monitor"""
        try:
            self.serial_log_widget.write("[yellow]Starting platformio serial monitor...[/]")
            self.serial_process = subprocess.Popen(
                ['platformio', 'device', 'monitor', '--baud', '115200'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
                universal_newlines=True
            )
            self.serial_connected = True
            self.serial_log_widget.write("[green bold]✓ Serial monitor started![/]")
            
            # Start reading in thread
            serial_thread = threading.Thread(target=self.read_serial_thread, daemon=True)
            serial_thread.start()
            return True
        except FileNotFoundError:
            self.serial_log_widget.write("[red]❌ platformio not found. Install it first.[/]")
            return False
        except Exception as e:
            self.serial_log_widget.write(f"[red]❌ Failed to start serial monitor: {e}[/]")
            return False
    
    def read_serial_thread(self):
        """Read from platformio serial monitor in thread with throttling"""
        import time
        last_update = time.time()
        buffer = []
        
        while self.running and self.serial_connected and self.serial_process:
            try:
                line = self.serial_process.stdout.readline()
                if line:
                    message = line.rstrip('\n\r')
                    if message and not message.startswith('---'):  # Skip platformio headers
                        buffer.append(message)
                        
                        # Throttle: only send to queue every 100ms or when buffer has 20 lines
                        current_time = time.time()
                        if (current_time - last_update) >= 0.1 or len(buffer) >= 20:
                            timestamp = datetime.now().strftime("%H:%M:%S")
                            # Send all buffered lines as one message
                            combined = "\n".join(buffer)
                            asyncio.run_coroutine_threadsafe(
                                self.serial_message_queue.put(f"[dim]{timestamp}[/] {combined}"),
                                self.loop
                            )
                            buffer = []
                            last_update = current_time
                            
                elif self.serial_process.poll() is not None:
                    # Flush remaining buffer
                    if buffer:
                        timestamp = datetime.now().strftime("%H:%M:%S")
                        combined = "\n".join(buffer)
                        asyncio.run_coroutine_threadsafe(
                            self.serial_message_queue.put(f"[dim]{timestamp}[/] {combined}"),
                            self.loop
                        )
                    
                    # Process ended
                    self.serial_connected = False
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    asyncio.run_coroutine_threadsafe(
                        self.serial_message_queue.put(f"[dim]{timestamp}[/] [yellow]Serial monitor stopped[/]"),
                        self.loop
                    )
                    break
            except Exception as e:
                timestamp = datetime.now().strftime("%H:%M:%S")
                asyncio.run_coroutine_threadsafe(
                    self.serial_message_queue.put(f"[dim]{timestamp}[/] [red]Error: {e}[/]"),
                    self.loop
                )
    
    async def send_command(self, command):
        """Send command to ESP32 via Bluetooth"""
        if not self.bt_connected or not self.client:
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.bt_log_widget.write(f"[dim]{timestamp}[/] [red]Not connected![/]")
            return False
        
        try:
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.bt_log_widget.write(f"[dim]{timestamp}[/] [green]> {command}[/]")
            await self.client.write_gatt_char(RX_UUID, command.encode('utf-8'))
            
            # Don't wait for response - let it come asynchronously
            # The notification handler will display the response
            
            return True
        except Exception as e:
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.bt_log_widget.write(f"[dim]{timestamp}[/] [red]Error: {e}[/]")
            return False
    
    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Handle command submission"""
        command = event.value.strip()
        self.input_widget.value = ""
        
        if command.lower() in ['quit', 'exit', 'q']:
            self.exit()
            return
        
        if command and self.bt_connected:
            # Run in background to not block UI
            asyncio.create_task(self.send_command(command))
    
    async def on_unmount(self) -> None:
        """Called when app is closing"""
        self.running = False
        
        if self.client and self.bt_connected:
            await self.client.disconnect()
            self.bt_connected = False
        
        if self.serial_process and self.serial_connected:
            self.serial_process.terminate()
            try:
                self.serial_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.serial_process.kill()
            self.serial_connected = False
    

    


def main():
    # Get device name from command line argument or use default
    device_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DEVICE_NAME
    
    # Create and run the app
    app = ESP32Terminal(device_name)
    app.title = "ESP32 Terminal"
    app.sub_title = f"Device: {device_name}"
    app.run()

if __name__ == "__main__":
    main()
