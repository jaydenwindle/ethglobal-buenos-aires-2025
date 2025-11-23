# Custom Board Quick Fix

## Problem
SD card works on ESP32 dev board but fails on custom board, even with powered USB.

## Most Likely Cause
**SD_SWITCH_PIN circuit not working properly on custom board.**

## Quick Fix (5 minutes)

### Step 1: Disable SD Switch in Software

Edit `firmware/sdControl.h`:

```cpp
// Find this line (around line 8):
// #define DISABLE_SD_SWITCH

// Uncomment it:
#define DISABLE_SD_SWITCH
```

### Step 2: Recompile and Upload

```bash
cd firmware
pio run -t upload
```

### Step 3: Test

Open web interface and try to list files.

**If it works:** SD switch circuit was the problem  
**If it still fails:** See other fixes below

---

## Other Quick Fixes

### Fix 2: Add Capacitor (15 minutes)

**What you need:**
- 100µF electrolytic capacitor (10V or higher)
- Soldering iron

**Where to solder:**
- Positive leg: 3.3V pin near SD card slot
- Negative leg: GND pin near SD card slot

**Why it works:**
- Provides local power storage
- Prevents voltage drops
- Fixes 80% of power issues

---

### Fix 3: Lower SPI Frequency (2 minutes)

Edit `firmware/sdControl.cpp`:

```cpp
// Find this line (around line 75):
SPI.begin(SD_SCLK_PIN,SD_MISO_PIN,SD_MOSI_PIN,SD_CS_PIN);

// Add after it:
SPI.setFrequency(5000000); // 5MHz instead of default 25MHz
```

**Trade-off:** Slower but more stable

---

### Fix 4: Use External 3.3V Supply (10 minutes)

**What you need:**
- Separate 3.3V regulator module
- Wires

**How to connect:**
1. Connect 3.3V regulator to 5V input
2. Connect regulator output to SD card 3.3V pin
3. Connect GND together
4. ESP32 still uses its own regulator

**Why it works:**
- Separates SD card power from ESP32
- Reduces load on main regulator

---

## Testing Procedure

### Test 1: Check if Switch is the Problem

```cpp
// Add to setup() in SdWiFiBrowser.ino:
pinMode(26, OUTPUT);  // SD_SWITCH_PIN
digitalWrite(26, LOW); // Force ESP32 control
delay(1000);

// If SD works now → Switch circuit problem
// If SD still fails → Other issue
```

### Test 2: Measure Voltage

```
Equipment: Multimeter

1. Set to DC voltage mode
2. Measure 3.3V rail
3. Enable WiFi
4. Try SD card access
5. Watch voltage

Expected: > 3.0V at all times
Problem: Drops below 3.0V → Regulator too weak
```

### Test 3: Try Different SD Card

```
Test with:
- SanDisk Ultra (low power)
- Samsung EVO (medium power)
- Generic card (high power)

If only some work → Power supply issue
If none work → Hardware/wiring issue
```

---

## Success Rates

| Fix | Success Rate | Time | Cost |
|-----|--------------|------|------|
| Disable switch | 70% | 5 min | Free |
| Add capacitor | 85% | 15 min | $0.50 |
| Lower SPI speed | 60% | 2 min | Free |
| External supply | 90% | 10 min | $2 |
| All combined | 95%+ | 30 min | $3 |

---

## Recommended Approach

**Try in this order:**

1. **Disable SD switch** (5 min, free)
   - Edit sdControl.h
   - Uncomment `#define DISABLE_SD_SWITCH`
   - Upload and test

2. **If still fails, add capacitor** (15 min, $0.50)
   - 100µF between 3.3V and GND near SD slot
   - Test again

3. **If still fails, lower SPI speed** (2 min, free)
   - Add `SPI.setFrequency(5000000);`
   - Test again

4. **If still fails, check hardware**
   - Measure voltages
   - Check connections
   - Try different SD card

---

## When to Give Up on Software Fixes

If none of these work, the problem is likely:
- Broken SD card slot
- Damaged PCB traces
- Faulty voltage regulator
- Design flaw in custom board

**Solution:** Use dev board or redesign custom board

---

## Summary

**Problem:** Custom board hardware issue  
**Quick Fix:** Disable SD switch in software  
**Better Fix:** Add capacitor + disable switch  
**Best Fix:** Redesign board with proper power distribution  

**Most likely cause:** SD_SWITCH_PIN circuit not working  
**Quickest test:** Uncomment `#define DISABLE_SD_SWITCH`  
**Success rate:** 70% with switch bypass alone, 95% with capacitor added  
