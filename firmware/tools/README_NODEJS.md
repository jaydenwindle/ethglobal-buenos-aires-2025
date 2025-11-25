# ESP32 Terminal - Node.js Version

This is a Node.js implementation that solves the input lag issues present in the Python/Textual version.

## Why Node.js?

Node.js handles high-volume subprocess I/O much better than Python because:
- Subprocess streams are truly non-blocking (don't block the event loop)
- Event loop is optimized for I/O operations
- No GIL (Global Interpreter Lock) issues

## Installation

```bash
cd firmware/tools

# Install dependencies
npm install

# Make executable (optional)
chmod +x esp32_terminal.js
```

## Usage

```bash
# Run with default device (digicam-001)
node esp32_terminal.js

# Or with custom device name
node esp32_terminal.js ESP32-SD-WiFi

# Or if you made it executable
./esp32_terminal.js
```

## Requirements

- Node.js (v14 or higher)
- platformio (for serial monitoring)
- Bluetooth adapter

## Features

- Split-pane UI: Bluetooth (left) and Serial (right)
- Color-coded output
- Responsive input even with high-volume serial data
- Auto-scrolling logs
- Keyboard shortcuts: Ctrl+C or ESC to quit

## Troubleshooting

### Bluetooth permissions (Linux)
```bash
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

### Bluetooth permissions (macOS)
No special permissions needed, but you may need to grant terminal app Bluetooth access in System Preferences.
