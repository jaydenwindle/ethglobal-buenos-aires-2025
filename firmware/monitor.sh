#!/bin/bash

# Serial Monitor Script
# Opens serial monitor at 115200 baud
# Press Ctrl+C to exit

echo "📡 Opening Serial Monitor (115200 baud)"
echo "Press Ctrl+C to exit"
echo ""
sleep 1

platformio device monitor --baud 115200
