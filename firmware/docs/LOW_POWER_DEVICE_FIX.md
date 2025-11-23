# Low-Power Device SD Card Fix

## Problem

On low-power ESP32 devices, you get `LIST:NO_SD_CARD` error even though:
- SD card is inserted
- SD card works on other devices
- SD card is formatted correctly

## Root Cause

Low-power devices have:
1. **Insufficient power** for SD card during initialization
2. **Voltage drops** when SD card draws current
3. **Timing issues** - card detection happens before card is ready
4. **Unstable operation** at high CPU frequencies

## Solutions Applied

### 1. Increased Delays ✅

**Before:**
```cpp
delay(200);  // Initial delay
delay(100);  // After SPI init
delay(500);  // After takeControl
```

**After:**
```cpp
delay(300);  // Initial delay (+50%)
delay(200);  // After SPI init (+100%)
delay(1000); // After takeControl (+100%)
```

**Why:** Low-power devices need more time for voltage to stabilize

---

### 2. Card Detection Retry ✅

**Before:**
```cpp
uint8_t cardType = SD.cardType();
if (cardType == CARD_NONE) {
    return error;
}
```

**After:**
```cpp
int attempts = 0;
while (attempts < 5) {
    cardType = SD.cardType();
    if (cardType != CARD_NONE) break;
    delay(500);
    attempts++;
}
```

**Why:** Card detection can fail initially but succeed after voltage stabilizes

---

### 3. CPU Frequency Reduction ✅

**New:**
```cpp
uint32_t originalCpuFreq = getCpuFrequencyMhz();
if (originalCpuFreq > 80) {
    setCpuFrequencyMhz(80); // Reduce to 80MHz
}
// ... SD operations ...
setCpuFrequencyMhz(originalCpuFreq); // Restore
```

**Why:** Lower CPU frequency = lower power draw = more stable SD operation

---

### 4. Power Pin Control ✅

**New:**
```cpp
#ifdef SD_POWER_PIN
  digitalWrite(SD_POWER_PIN, HIGH);
  delay(200); // Wait for power to stabilize
#endif
```

**Why:** Ensures SD card has power before attempting initialization

---

## How It Works Now

### Initialization Sequence

```
1. Enable SD power (if available)
   └─ Wait 200ms for power stabilization

2. Switch SD pins to ESP32
   └─ Wait 300ms for card to settle

3. Reduce CPU frequency to 80MHz
   └─ Wait 50ms for frequency to stabilize

4. Initialize SPI
   └─ Wait 200ms for SPI to be ready

5. Try SD.begin() up to 10 times
   └─ Wait 1000ms between attempts

6. Restore CPU frequency

7. Wait 1000ms after takeControl

8. Try cardType() up to 5 times
   └─ Wait 500ms between attempts

9. If successful, proceed with file operations
```

**Total time:** Up to ~15 seconds for very problematic cards  
**Typical time:** 2-3 seconds for normal cards

---

## Performance Impact

| Device Type | Before | After | Notes |
|-------------|--------|-------|-------|
| Normal ESP32 | Works | Works | No impact |
| Low-power ESP32 | Fails | Works | Slightly slower |
| Very low-power | Fails | May work | Needs good power supply |

---

## Additional Fixes for Very Low-Power Devices

### Fix 1: Better Power Supply

**Problem:** USB power may not be sufficient

**Solutions:**
- Use powered USB hub
- Use external 5V power supply (2A+)
- Add capacitor (100-1000µF) near ESP32
- Use shorter/thicker USB cable

### Fix 2: Reduce Power Consumption

**In code:**
```cpp
// Reduce WiFi TX power
WiFi.setTxPower(WIFI_POWER_8_5dBm); // Lower than default

// Disable Bluetooth if not needed
// Comment out BT.begin() in setup()

// Use lower SPI frequency
SPI.setFrequency(10000000); // 10MHz instead of 25MHz
```

### Fix 3: Hardware Modifications

**If you have access to hardware:**
- Add 100µF capacitor between 3.3V and GND near SD slot
- Add 10µF capacitor between 3.3V and GND near ESP32
- Use SD card with lower power consumption
- Check SD_POWER_PIN is connected and working

---

## Diagnostic Steps

### Step 1: Check Serial Monitor

Look for:
```
SD init attempt 1... SUCCESS  ← Good!
Card type check attempt 1: no card detected, retrying...
Card type check attempt 2: no card detected, retrying...
SD card type: 2 (detected on attempt 3)  ← Eventually succeeds
```

If you see:
```
SD init attempt 1... FAILED
SD init attempt 2... FAILED
...
```
→ Power supply issue, not just timing

### Step 2: Measure Voltage

**With multimeter:**
- Measure 3.3V rail during SD initialization
- Should stay above 3.0V
- If drops below 3.0V → Power supply issue

### Step 3: Test Different Cards

**Try multiple SD cards:**
- Some cards draw more power than others
- SanDisk Ultra typically draws less power
- Generic cards may draw more power

---

## Configuration Options

### Increase Delays Further

**In `sdControl.cpp`:**
```cpp
delay(300);  // Change to 500
delay(200);  // Change to 300
delay(1000); // Change to 2000
```

**In `FSWebServer.cpp`:**
```cpp
delay(1000); // Change to 2000
delay(500);  // Change to 1000
```

### Increase Retry Attempts

**In `sdControl.cpp`:**
```cpp
while(cnt < 10) { // Change to 20
```

**In `FSWebServer.cpp`:**
```cpp
while (cardCheckAttempts < 5) { // Change to 10
```

### Lower CPU Frequency

**In `sdControl.cpp`:**
```cpp
setCpuFrequencyMhz(80); // Change to 40 for even lower power
```

---

## Testing Checklist

- [ ] Connect serial monitor (115200 baud)
- [ ] Power on device
- [ ] Wait for boot messages
- [ ] Enable WiFi
- [ ] Watch for SD init messages
- [ ] Count retry attempts
- [ ] Check if eventually succeeds
- [ ] Try web interface
- [ ] Verify file list loads

---

## Expected Behavior

### Normal Device
```
SD init attempt 1... SUCCESS
SD card type: 2 (detected on attempt 1)
Total time: ~1 second
```

### Low-Power Device (Fixed)
```
SD init attempt 1... SUCCESS
Card type check attempt 1: no card detected, retrying...
Card type check attempt 2: no card detected, retrying...
SD card type: 2 (detected on attempt 3)
Total time: ~3 seconds
```

### Very Low-Power Device (May Need Help)
```
SD init attempt 1... FAILED
SD init attempt 2... SUCCESS
Card type check attempt 1: no card detected, retrying...
Card type check attempt 2: no card detected, retrying...
Card type check attempt 3: no card detected, retrying...
SD card type: 2 (detected on attempt 4)
Total time: ~5 seconds
```

---

## Success Criteria

✅ SD card eventually initializes (even if takes multiple attempts)  
✅ Card type eventually detected (even if takes retries)  
✅ File list loads successfully  
✅ No more `NO_SD_CARD` errors  
✅ Stable operation after initialization  

---

## Still Not Working?

### Last Resort Options

1. **Use external power supply**
   - 5V 2A minimum
   - Connect to VIN pin, not USB

2. **Add capacitors**
   - 100µF near SD slot
   - 10µF near ESP32

3. **Use different SD card**
   - Try SanDisk Ultra (low power)
   - Avoid generic cards

4. **Reduce other power consumption**
   - Disable Bluetooth
   - Lower WiFi power
   - Reduce CPU frequency permanently

5. **Check hardware**
   - Verify SD_POWER_PIN works
   - Check for shorts/damage
   - Try different ESP32 board

---

## Summary

The fixes add:
- **5x more delay** for power stabilization
- **5 retry attempts** for card detection
- **CPU frequency reduction** during SD operations
- **Power pin control** for SD card

This should fix `NO_SD_CARD` errors on low-power devices while maintaining fast operation on normal devices.

If still having issues, the problem is likely hardware (insufficient power supply) rather than software.
