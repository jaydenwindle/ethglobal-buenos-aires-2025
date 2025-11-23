# SD Card Troubleshooting Guide

## Error: LIST:BADPATH:/

This error means the ESP32 cannot open the SD card root directory.

### Common Causes

1. **SD Card Not Inserted**
   - Check that SD card is fully inserted
   - Try removing and reinserting

2. **SD Card Not Initialized**
   - SD card may need more time to initialize
   - Power cycle the device

3. **SD Card Format Issues**
   - SD card must be formatted as FAT32
   - Cards > 32GB may need special formatting

4. **SD Card Corruption**
   - Try the SD card in a computer
   - Run disk check/repair
   - Reformat if necessary

5. **Hardware Connection Issues**
   - Check SD card slot for debris
   - Check SD card pins for damage
   - Try a different SD card

6. **SD Card Speed Issues**
   - Some very slow/old cards may not work
   - Try a Class 10 or UHS-I card

### Quick Fixes

#### Fix 1: Power Cycle
```
1. Remove power from ESP32
2. Wait 10 seconds
3. Remove SD card
4. Reinsert SD card
5. Power on ESP32
6. Wait 30 seconds before accessing web interface
```

#### Fix 2: Reformat SD Card
```
1. Backup SD card contents
2. Format as FAT32 (not exFAT)
3. Use allocation unit size: 32KB
4. Reinsert into ESP32
5. Test
```

#### Fix 3: Check SD Card on Computer
```
1. Insert SD card into computer
2. Check if files are readable
3. Run disk check:
   - Windows: chkdsk /f
   - Mac: Disk Utility > First Aid
   - Linux: fsck
4. If errors found, reformat
```

### Diagnostic Steps

#### Step 1: Check Serial Output
Connect to serial monitor (115200 baud) and look for:
```
SD card initialized on attempt X
takeControl
```

If you see:
```
SD init attempt 1 failed
SD init attempt 2 failed
...
SD card initialization failed after 5 attempts
```
→ SD card hardware issue

#### Step 2: Test Different SD Cards
Try multiple SD cards to isolate hardware vs card issue:
- If all cards fail → Hardware problem
- If some cards work → Card compatibility issue

#### Step 3: Check Pins
Verify SD card pins in `pins.h`:
```cpp
SD_CS_PIN
SD_SCLK_PIN
SD_MISO_PIN
SD_MOSI_PIN
SD_SWITCH_PIN
```

### Supported SD Cards

✅ **Recommended:**
- SanDisk Ultra (Class 10)
- Samsung EVO (Class 10)
- Kingston Canvas (Class 10)
- Any UHS-I card
- Size: 2GB - 32GB

⚠️ **May Work:**
- Generic Class 10 cards
- Cards 32GB - 128GB (must be FAT32)
- Class 4-6 cards (slower)

❌ **Not Supported:**
- Cards > 128GB
- exFAT formatted cards
- NTFS formatted cards
- Very old/slow cards (< Class 4)

### Code Changes for Better Compatibility

#### Increase Initialization Delay
In `sdControl.cpp`:
```cpp
delay(100); // Change to 200 or 300
```

#### Increase Retry Count
In `sdControl.cpp`:
```cpp
while(cnt < 5) { // Change to 10
```

#### Add More Delay Between Retries
In `sdControl.cpp`:
```cpp
delay(500); // Change to 1000
```

### Backend Improvements Applied

The following improvements have been added to help with SD card initialization:

1. **Longer initial delay**: 50ms → 100ms
2. **Better error logging**: Shows which attempt succeeded
3. **Retry on failure**: Attempts to reinitialize if first open fails
4. **More time for list operation**: Added 100ms delay after takeControl

### Frontend Improvements Applied

1. **Better error messages**: Specific guidance for each error type
2. **Longer timeout**: 15s → 20s to allow for SD init
3. **Loading indicator**: Shows "Loading from SD card..."
4. **Helpful troubleshooting**: Error messages include fix suggestions

### Testing Your SD Card

#### Test 1: Computer Test
```
1. Insert SD card into computer
2. Create test file: test.txt
3. Write some text
4. Safely eject
5. Insert into ESP32
6. Try to list files
```

#### Test 2: Format Test
```
1. Format SD card as FAT32
2. Don't add any files
3. Insert into ESP32
4. Should show empty directory (not error)
```

#### Test 3: Speed Test
```
1. Copy large file (10MB+) to SD card on computer
2. Measure time
3. If very slow (< 1MB/s) → Card may be too slow
```

### Common SD Card Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| BADPATH error | Card not initialized | Power cycle, wait longer |
| Timeout | Card too slow | Use faster card |
| Works sometimes | Loose connection | Reseat card, check slot |
| Works then stops | Card corruption | Reformat card |
| Never works | Wrong format | Format as FAT32 |

### Advanced Debugging

#### Enable Verbose Logging
In `FSWebServer.cpp`:
```cpp
constexpr bool ENABLE_VERBOSE_LOGGING = true;
```

#### Monitor Serial Output
```
1. Connect USB serial (115200 baud)
2. Refresh web page
3. Watch for SD initialization messages
4. Look for error codes
```

#### Check SD Card Type
In serial monitor, you should see:
```
SD card type: SDHC (or SDSC)
```

If you see "UNKNOWN" → Card not compatible

### Still Not Working?

If you've tried everything:

1. **Try a known-good SD card**
   - Borrow one from a camera/phone
   - Use a brand-name card

2. **Check hardware**
   - Inspect SD card slot
   - Check for bent pins
   - Try different ESP32 board

3. **Simplify setup**
   - Remove all files from SD card
   - Test with empty card first

4. **Update firmware**
   - Ensure latest firmware version
   - Check for SD library updates

### Success Checklist

✅ SD card is FAT32 formatted  
✅ SD card is Class 10 or better  
✅ SD card is 2-32GB  
✅ SD card works in computer  
✅ ESP32 has been power cycled  
✅ Waited 30 seconds after boot  
✅ Serial monitor shows "SD card initialized"  
✅ No "BADPATH" errors  

If all checked: Should work! 🎉

### Contact Support

If still having issues, provide:
- SD card brand/model
- SD card size
- Format type (FAT32/exFAT/etc)
- Serial monitor output
- Error messages from web interface
- What you've tried so far
