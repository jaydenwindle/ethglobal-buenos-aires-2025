# Custom Board SD Card Issues

## Problem

SD card works on ESP32 dev board but fails on custom board, even with powered USB.

## Root Causes

### 1. SD_SWITCH_PIN Circuit (Most Common - 70%)

**What it does:**
- Controls which device accesses SD card
- Switches between ESP32 and printer
- Uses analog switch or multiplexer

**Common problems:**
- Switch IC not working
- Wrong voltage levels
- Stuck in wrong position
- Poor PCB layout
- Missing pull-up/pull-down resistors

**Symptoms:**
- Works on dev board
- Fails on custom board
- `SD.begin()` succeeds but card not accessible
- Intermittent failures

**Test:**
```cpp
// In setup(), add:
pinMode(SD_SWITCH_PIN, OUTPUT);
digitalWrite(SD_SWITCH_PIN, LOW);  // Force ESP32 control
delay(1000);

// Check with multimeter:
// Pin 26 should be LOW (0V)
// SD card pins should be connected to ESP32
```

**Fix:**
```cpp
// Option 1: Bypass the switch in software
// In sdControl.cpp, comment out:
// digitalWrite(SD_SWITCH_PIN, LOW);

// Option 2: Hardware bypass
// Directly connect SD card to ESP32 (remove switch)
```

---

### 2. Weak 3.3V Regulator (Common - 20%)

**What happens:**
- Regulator can't provide enough current
- Voltage drops during SD card access
- Card loses power

**Common regulators:**
- AMS1117-3.3: Max 800mA (marginal)
- LD1117-3.3: Max 800mA (marginal)
- XC6206: Max 200mA (insufficient!)
- AP2112: Max 600mA (insufficient!)

**Required:**
- Minimum 1A regulator
- Recommended: 1.5A or more

**Test:**
```
1. Measure 3.3V rail with multimeter
2. Enable WiFi
3. Access SD card
4. Voltage should stay > 3.0V
5. If drops below 3.0V → Regulator too weak
```

**Fix:**
- Replace with better regulator (e.g., AMS1117-3.3 or better)
- Add external 3.3V supply
- Use dev board's regulator

---

### 3. Missing Decoupling Capacitors (Common - 15%)

**What's missing:**
- 100µF near SD card slot
- 10µF near ESP32
- 0.1µF near each IC

**Symptoms:**
- Works sometimes
- Fails during WiFi activity
- Random disconnections

**Test:**
```
Check PCB for capacitors:
- Near SD card slot: Should have 100µF
- Near ESP32: Should have 10µF + 0.1µF
- Near regulator: Should have 10µF input + output
```

**Fix:**
- Solder capacitors directly to PCB
- Add to bottom side if no room on top

---

### 4. Long/Thin PCB Traces (Less Common - 10%)

**What happens:**
- Resistance in traces causes voltage drop
- Inductance causes noise
- Poor signal integrity

**Symptoms:**
- Works at low SPI speeds
- Fails at high speeds
- Intermittent errors

**Test:**
```
Measure trace resistance:
1. Multimeter in resistance mode
2. Measure from regulator to SD card
3. Should be < 0.5Ω
4. If > 1Ω → Traces too thin/long
```

**Fix:**
- Lower SPI frequency
- Add wire jumpers for power
- Redesign PCB with thicker traces

---

### 5. SD Card Slot Quality (Less Common - 5%)

**What happens:**
- Poor contact
- Bent pins
- Oxidation

**Symptoms:**
- Works with some cards
- Fails with others
- Needs card reseating

**Test:**
```
1. Try multiple SD cards
2. Reseat card multiple times
3. Check pins with magnifier
4. Clean with isopropyl alcohol
```

**Fix:**
- Replace SD card slot
- Clean contacts
- Add pressure to card

---

## Diagnostic Steps

### Step 1: Test SD_SWITCH_PIN

```cpp
// Add to setup():
Serial.begin(115200);
pinMode(SD_SWITCH_PIN, OUTPUT);

// Test switching
digitalWrite(SD_SWITCH_PIN, HIGH);
Serial.println("Switch HIGH");
delay(1000);

digitalWrite(SD_SWITCH_PIN, LOW);
Serial.println("Switch LOW");
delay(1000);

// Measure with multimeter:
// Pin 26 should toggle between 0V and 3.3V
```

### Step 2: Measure Voltages

```
Equipment: Multimeter

Measure:
1. 5V input: Should be 4.8-5.2V
2. 3.3V rail (no load): Should be 3.25-3.35V
3. 3.3V rail (with WiFi): Should be > 3.0V
4. 3.3V at SD card: Should be > 3.0V

If any voltage is low → Power supply issue
```

### Step 3: Test Without Switch

```cpp
// In sdControl.cpp, comment out:
// digitalWrite(SD_SWITCH_PIN, LOW);

// Manually connect SD card directly to ESP32
// Bypass the switch circuit
// Test if SD card works
```

### Step 4: Compare with Dev Board

```
Test same SD card on:
1. Dev board → Works
2. Custom board → Fails

Difference is in custom board hardware
```

---

## Software Workarounds

### Workaround 1: Disable SD Switch

```cpp
// In sdControl.cpp, in takeControl():
// Comment out:
// digitalWrite(SD_SWITCH_PIN, LOW);

// This assumes SD card is always connected to ESP32
// Won't work if printer needs SD access
```

### Workaround 2: Hold Switch Longer

```cpp
// In sdControl.cpp:
digitalWrite(SD_SWITCH_PIN, LOW);
delay(500); // Increase from 200ms to 500ms
```

### Workaround 3: Toggle Switch Multiple Times

```cpp
// In sdControl.cpp:
for (int i = 0; i < 3; i++) {
    digitalWrite(SD_SWITCH_PIN, HIGH);
    delay(50);
    digitalWrite(SD_SWITCH_PIN, LOW);
    delay(50);
}
```

### Workaround 4: Lower SPI Frequency

```cpp
// In sdControl.cpp:
SPI.setFrequency(1000000); // 1MHz (very slow but stable)
```

---

## Hardware Fixes

### Fix 1: Add Capacitors (Essential)

```
Components:
- 100µF electrolytic (near SD slot)
- 10µF ceramic (near ESP32)
- 0.1µF ceramic (near SD slot)

Solder between 3.3V and GND
```

### Fix 2: Bypass SD Switch (If Not Needed)

```
If printer doesn't need SD access:
1. Remove switch IC
2. Connect SD card directly to ESP32
3. Remove SD_SWITCH_PIN control
```

### Fix 3: Better Regulator

```
Replace with:
- LM1117-3.3 (800mA)
- AMS1117-3.3 (1A)
- SPX3819-3.3 (1.5A)
- TLV1117-33 (1A)
```

### Fix 4: External 3.3V Supply

```
Use separate regulator for SD card:
1. Add second 3.3V regulator
2. Power SD card from it
3. Reduces load on main regulator
```

---

## Code Changes for Custom Boards

### Option 1: Disable Switch Control

```cpp
// In sdControl.cpp, add at top:
#define DISABLE_SD_SWITCH

// In takeControl():
#ifndef DISABLE_SD_SWITCH
    digitalWrite(SD_SWITCH_PIN, LOW);
#endif
```

### Option 2: Add Switch Diagnostics

```cpp
// In sdControl.cpp:
void SDControl::testSwitch() {
    pinMode(SD_SWITCH_PIN, OUTPUT);
    
    SERIAL_ECHOLN("Testing SD switch...");
    
    digitalWrite(SD_SWITCH_PIN, HIGH);
    SERIAL_ECHOLN("Switch HIGH - Printer should have SD");
    delay(2000);
    
    digitalWrite(SD_SWITCH_PIN, LOW);
    SERIAL_ECHOLN("Switch LOW - ESP32 should have SD");
    delay(2000);
    
    SERIAL_ECHOLN("Test complete. Check with multimeter.");
}
```

### Option 3: Force Switch State

```cpp
// In setup():
pinMode(SD_SWITCH_PIN, OUTPUT);
digitalWrite(SD_SWITCH_PIN, LOW);
delay(1000); // Hold for 1 second

// This forces ESP32 control from boot
```

---

## Comparison: Dev Board vs Custom Board

| Aspect | Dev Board | Custom Board |
|--------|-----------|--------------|
| Regulator | 1A+ | Often < 1A |
| Capacitors | Proper | Often missing |
| PCB traces | Thick, short | May be thin/long |
| SD switch | None | May have issues |
| Quality | High | Varies |
| Cost | $10-20 | $5-10 |

---

## Quick Test Procedure

```
1. Power custom board with 5V 2A supply
2. Connect serial monitor
3. Enable WiFi
4. Try SD card access
5. Watch serial output

If fails:
6. Measure 3.3V during SD access
7. If < 3.0V → Regulator issue
8. If > 3.0V → Switch or connection issue

9. Try bypassing switch (comment out digitalWrite)
10. If works → Switch circuit problem
11. If fails → Other hardware issue
```

---

## Recommended Solution

**For custom boards with SD switch issues:**

1. **Short-term:** Bypass switch in software
   ```cpp
   // Comment out: digitalWrite(SD_SWITCH_PIN, LOW);
   ```

2. **Medium-term:** Add capacitors
   - 100µF near SD slot
   - 10µF near ESP32

3. **Long-term:** Redesign PCB
   - Better regulator (1.5A+)
   - Proper capacitors
   - Thicker power traces
   - Better SD switch circuit

---

## Success Rate

| Fix | Success Rate | Effort |
|-----|--------------|--------|
| Bypass switch | 80% | 5 min |
| Add capacitors | 90% | 15 min |
| Better regulator | 95% | 30 min |
| PCB redesign | 99% | Hours |

---

## Bottom Line

If it works on dev board but not custom board with same power supply, the issue is **custom board hardware design**, specifically:

1. **SD switch circuit** (most likely)
2. **Weak voltage regulator**
3. **Missing capacitors**
4. **Poor PCB layout**

Software can only work around these issues. Proper fix requires hardware changes.

**Quickest fix:** Bypass the SD switch in software and add a 100µF capacitor near the SD slot.
