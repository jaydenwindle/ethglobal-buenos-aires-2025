#!/bin/bash

# SD WiFi Pro - Upload Script
# This script uploads both SPIFFS filesystem and firmware to ESP32

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_msg() {
    echo -e "${2}${1}${NC}"
}

print_msg "╔════════════════════════════════════════╗" "$BLUE"
print_msg "║   SD WiFi Pro - Upload Script         ║" "$BLUE"
print_msg "╚════════════════════════════════════════╝" "$BLUE"
echo ""

# Check if platformio is installed
if ! command -v platformio &> /dev/null; then
    print_msg "❌ Error: PlatformIO is not installed!" "$RED"
    echo ""
    echo "Install with: brew install platformio"
    echo "Or visit: https://platformio.org/install"
    exit 1
fi

print_msg "✓ PlatformIO found" "$GREEN"
echo ""

# Check if platformio.ini exists
if [ ! -f "platformio.ini" ]; then
    print_msg "❌ Error: platformio.ini not found!" "$RED"
    echo "Make sure you're in the project directory."
    exit 1
fi

# Function to upload SPIFFS
upload_spiffs() {
    print_msg "📁 Uploading SPIFFS filesystem..." "$YELLOW"
    echo ""
    
    if platformio run --target uploadfs; then
        print_msg "✓ SPIFFS uploaded successfully!" "$GREEN"
        return 0
    else
        print_msg "❌ SPIFFS upload failed!" "$RED"
        return 1
    fi
}

# Function to upload firmware
upload_firmware() {
    print_msg "🔧 Compiling and uploading firmware..." "$YELLOW"
    echo ""
    
    if platformio run --target upload; then
        print_msg "✓ Firmware uploaded successfully!" "$GREEN"
        return 0
    else
        print_msg "❌ Firmware upload failed!" "$RED"
        return 1
    fi
}

# Function to open serial monitor
open_monitor() {
    print_msg "📡 Opening serial monitor..." "$YELLOW"
    echo "Press Ctrl+C to exit monitor"
    echo ""
    sleep 2
    platformio device monitor --baud 115200
}

# Main menu
echo "What would you like to do?"
echo ""
echo "  1) Upload SPIFFS only"
echo "  2) Upload Firmware only"
echo "  3) Upload SPIFFS + Firmware"
echo "  4) Upload All + Open Monitor"
echo "  5) Clean build and upload all"
echo "  6) Exit"
echo ""
read -p "Enter choice [1-6]: " choice

case $choice in
    1)
        echo ""
        upload_spiffs
        ;;
    2)
        echo ""
        upload_firmware
        ;;
    3)
        echo ""
        upload_spiffs
        if [ $? -eq 0 ]; then
            echo ""
            print_msg "⏳ Waiting 3 seconds before firmware upload..." "$YELLOW"
            sleep 3
            echo ""
            upload_firmware
        fi
        ;;
    4)
        echo ""
        upload_spiffs
        if [ $? -eq 0 ]; then
            echo ""
            print_msg "⏳ Waiting 3 seconds before firmware upload..." "$YELLOW"
            sleep 3
            echo ""
            upload_firmware
            if [ $? -eq 0 ]; then
                echo ""
                print_msg "⏳ Waiting 3 seconds before opening monitor..." "$YELLOW"
                sleep 3
                echo ""
                open_monitor
            fi
        fi
        ;;
    5)
        echo ""
        print_msg "🧹 Cleaning build..." "$YELLOW"
        platformio run --target clean
        echo ""
        upload_spiffs
        if [ $? -eq 0 ]; then
            echo ""
            print_msg "⏳ Waiting 3 seconds before firmware upload..." "$YELLOW"
            sleep 3
            echo ""
            upload_firmware
        fi
        ;;
    6)
        print_msg "👋 Goodbye!" "$BLUE"
        exit 0
        ;;
    *)
        print_msg "❌ Invalid choice!" "$RED"
        exit 1
        ;;
esac

echo ""
print_msg "╔════════════════════════════════════════╗" "$GREEN"
print_msg "║          Upload Complete! ✓            ║" "$GREEN"
print_msg "╚════════════════════════════════════════╝" "$GREEN"
echo ""
print_msg "💡 Tip: Connect to WiFi SSID 'PERMA' and visit http://192.168.4.1" "$BLUE"
echo ""
