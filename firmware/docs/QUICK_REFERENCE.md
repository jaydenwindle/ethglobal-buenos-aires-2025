# Quick Reference Card

## 🚀 What Changed?

1. **Removed upload** - Simpler interface
2. **Fixed SD init** - Better reliability  
3. **Better errors** - Helpful messages
4. **Longer timeout** - 20 seconds
5. **Page size: 20** - Faster loading

---

## 🔧 Quick Fixes

### BADPATH Error
```
1. Check SD card inserted
2. Format as FAT32
3. Power cycle ESP32
4. Wait 30 seconds
5. Try refresh
```

### Timeout Error
```
1. Use Class 10 SD card
2. Check WiFi signal
3. Reduce files in directory
4. Try refresh
```

### No Files Showing
```
1. Check SD has files
2. Check files readable on PC
3. Try test file
4. Check serial monitor
```

---

## 📊 Key Settings

| Setting | Value |
|---------|-------|
| Page size | 20 items |
| Max page size | 50 items |
| Timeout | 20 seconds |
| SD init delay | 100ms |
| Yield frequency | Every 5 items |

---

## ✅ Testing Steps

1. Upload firmware
2. Upload web files  
3. Insert SD card
4. Power on
5. Wait 30 seconds
6. Open web interface
7. Click Refresh
8. Should see files!

---

## 📁 SD Card Requirements

✅ FAT32 format  
✅ Class 10 or better  
✅ 2-32GB size  
✅ Works on computer  

❌ exFAT  
❌ NTFS  
❌ > 128GB  
❌ Corrupted  

---

## 🐛 Debug

**Serial Monitor (115200 baud):**
```
SD card initialized on attempt 1  ← Good!
takeControl                       ← Good!
Opening path: '/'                 ← Good!
```

**Bad:**
```
SD init attempt 1 failed
SD init attempt 2 failed
...
```
→ SD card problem

---

## 📞 Help

See full docs:
- `SD_CARD_TROUBLESHOOTING.md`
- `FINAL_CHANGES_SUMMARY.md`
- `AGGRESSIVE_OPTIMIZATIONS.md`

---

## 🎯 Success = No Errors!

✅ Page loads fast  
✅ Files show in 1-2s  
✅ No BADPATH error  
✅ No timeout error  
✅ Download works  
✅ Delete works  
