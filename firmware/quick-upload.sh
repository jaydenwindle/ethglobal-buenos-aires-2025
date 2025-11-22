#!/bin/bash

# Quick Upload - SPIFFS + Firmware (no prompts)
# Usage: ./quick-upload.sh

set -e

echo "🚀 Quick Upload: SPIFFS + Firmware"
echo ""

echo "📁 Uploading SPIFFS..."
platformio run --target uploadfs

echo ""
echo "⏳ Waiting 3 seconds..."
sleep 3

echo ""
echo "🔧 Uploading Firmware..."
platformio run --target upload

echo ""
echo "✅ Done! Device should restart automatically."
echo "💡 Connect to WiFi SSID 'PERMA' and visit http://192.168.4.1"
