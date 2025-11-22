# digicam.eth - the onchain digital camera

digicam.eth is a Nikon Coolpix L3 digital camera that has been modified to mint tokens onchain using a wifi/bluetooth enabled SD card.

Built at ETHGlobal Buenos Aires 2025

### Repo Guide

```
.
├── app       # react native app (initialized with create-cdp-app)
├── firmware  # SD card firmware (fork of https://github.com/FYSETC/SdWiFiBrowser.git) 
└── README.md
```


# Bluetooth API
- toggle wifi + server on/off
- get photo count

# Web API
- /ls?path=/DCIM
- /cat?path=/DCIM/IMG_1001.JPG
- /dd?path=/DCIM/IMG_1001.JPG&bs=1024&skip=0&count=1
