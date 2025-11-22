# Server API Documentation

This document details the HTTP APIs available for the SPIFFS frontend to interact with the SD card filesystem. The APIs are designed with Linux terminal command naming conventions for intuitive usage.

## Overview

All APIs follow RESTful principles and return appropriate HTTP status codes. The server runs on port 80 and provides file system operations similar to Linux terminal commands.

## SD Card Control

### Relinquish Control
Release control of the SD card back to the printer.

**Endpoint:** `GET /relinquish`

**Response:**
- `200 OK` - "ok"

**Example:**
```
GET /relinquish
```

---

## File System Operations

### ls - List Directory
Lists files and directories in the specified path (non-recursive).

**Endpoint:** `GET /ls?dir={directory_path}`

**Legacy Endpoint:** `GET /list?dir={directory_path}` (maintained for backward compatibility)

**Parameters:**
- `dir` (required) - Directory path to list (e.g., "/", "/gcodes")

**Response:**
- `200 OK` - JSON array of directory entries
- `500 Internal Server Error` - Error messages:
  - "LIST:SDBUSY" - SD card is being used by printer
  - "LIST:BADARGS" - Missing path parameter
  - "LIST:BADPATH:{path}" - Invalid or non-existent path
  - "LIST:NOTDIR" - Path is not a directory

**Response Format:**
```json
[
  {
    "type": "dir|file",
    "name": "filename.gcode",
    "path": "/full/path/to/file",
    "size": 12345
  },
  ...
]
```

**Response Fields:**
- `type`: Either "dir" for directories or "file" for files
- `name`: Display name (filename only, without parent path)
- `path`: Full absolute path from root (e.g., "/DCIM/NIKON100/image.jpg")
- `size`: File size in bytes (0 for directories)

**Path Construction:**
The `path` field is constructed by combining the requested directory path with the entry name:
- If listing `/`: returns paths like `/DCIM`, `/file.txt`
- If listing `/DCIM`: returns paths like `/DCIM/NIKON100`, `/DCIM/image.jpg`
- If listing `/DCIM/NIKON100`: returns paths like `/DCIM/NIKON100/photo.jpg`

**Notes:**
- Maximum 200 items per request
- Only lists immediate children (non-recursive)
- Request path parameter (`dir`) must start with "/"
- Response `path` field always contains the full absolute path
- Use the `path` field for subsequent operations (download, delete, nested list)

**Examples:**

List root directory:
```
GET /ls?dir=/

Response:
[
  {"type":"dir","name":"DCIM","path":"/DCIM","size":0},
  {"type":"file","name":"readme.txt","path":"/readme.txt","size":1234}
]
```

List subdirectory:
```
GET /ls?dir=/DCIM

Response:
[
  {"type":"dir","name":"NIKON100","path":"/DCIM/NIKON100","size":0},
  {"type":"file","name":"photo.jpg","path":"/DCIM/photo.jpg","size":54321}
]
```

List nested subdirectory:
```
GET /ls?dir=/DCIM/NIKON100

Response:
[
  {"type":"file","name":"IMG_001.jpg","path":"/DCIM/NIKON100/IMG_001.jpg","size":2048576},
  {"type":"file","name":"IMG_002.jpg","path":"/DCIM/NIKON100/IMG_002.jpg","size":1987654}
]
```

---

### cat - Display File Content
Downloads/displays the content of a file.

**Endpoint:** `GET /cat?path={file_path}`

**Legacy Endpoint:** `GET /download?path={file_path}` (maintained for backward compatibility)

**Parameters:**
- `path` (required) - Full path to the file (e.g., "/config.txt")

**Response:**
- `200 OK` - File content with appropriate Content-Type header
- `404 Not Found` - "DOWNLOAD:FileNotFound"
- `500 Internal Server Error` - Error messages:
  - "DOWNLOAD:SDBUSY" - SD card is being used by printer
  - "DOWNLOAD:BADARGS" - Missing path parameter

**Headers:**
- `Content-Type` - Automatically detected based on file extension
- `Connection: close`
- `Access-Control-Allow-Origin: *`
- `Content-Encoding: gzip` - If .gz file is served

**Supported Content Types:**
- `.htm`, `.html` → text/html
- `.css` → text/css
- `.js` → application/javascript
- `.json` → application/json
- `.png` → image/png
- `.gif` → image/gif
- `.jpg` → image/jpeg
- `.ico` → image/x-icon
- `.xml` → text/xml
- `.pdf` → application/x-pdf
- `.zip` → application/x-zip
- `.gz` → application/x-gzip
- Default → text/plain

**Examples:**

Download file from root:
```
GET /cat?path=/readme.txt

Response: (file content)
```

Download file from subdirectory:
```
GET /cat?path=/DCIM/photo.jpg

Response: (binary image data)
```

Download file from nested subdirectory:
```
GET /cat?path=/DCIM/NIKON100/IMG_001.jpg

Response: (binary image data)
```

**Important:** The `path` parameter must be the full absolute path as returned by the `/ls` endpoint's `path` field.

---

### dd - Upload File (Chunked)
Uploads a file to the SD card with support for chunked/streaming uploads.

**Endpoint:** `POST /dd`

**Legacy Endpoint:** `POST /upload` (maintained for backward compatibility)

**Content-Type:** `multipart/form-data`

**Parameters:**
- File data in multipart form

**Response:**
- `200 OK` - "ok" (empty response during upload, final response on completion)
- `500 Internal Server Error` - Error messages:
  - "UPLOAD:SDBUSY" - SD card is being used by printer
  - "UPLOAD:BADARGS" - Invalid request format
  - "UPLOAD:OPENFAILED" - Failed to open file for writing

**Upload Process:**
1. **Start** (index=0): Takes SD control, removes existing file, opens new file
2. **Continue** (index>0): Writes data chunks to file
3. **Final**: Closes file and relinquishes SD control

**Notes:**
- Automatically overwrites existing files
- Supports streaming/chunked uploads for large files
- SD card control is held for the entire upload duration

**Examples:**

Upload to root directory:
```javascript
const formData = new FormData();
formData.append('data', fileBlob, '/readme.txt');

fetch('/dd', {
  method: 'POST',
  body: formData
});
```

Upload to subdirectory:
```javascript
const formData = new FormData();
formData.append('data', fileBlob, '/DCIM/photo.jpg');

fetch('/dd', {
  method: 'POST',
  body: formData
});
```

**Important:** The filename in the FormData must include the full path with leading "/"

---

### rm - Delete File/Directory
Deletes a file or directory from the SD card.

**Endpoint:** `GET /rm?path={file_path}`

**Legacy Endpoint:** `GET /delete?path={file_path}` (maintained for backward compatibility)

**Parameters:**
- `path` (required) - Path to file/directory to delete (without leading "/")

**Response:**
- `200 OK` - "ok"
- `500 Internal Server Error` - Error messages:
  - "DELETE:SDBUSY" - SD card is being used by printer
  - "DELETE:BADARGS" - Missing path parameter
  - "DELETE:BADPATH" - Invalid path or root directory

**Notes:**
- Cannot delete root directory ("/")
- Path parameter should NOT include leading "/"
- Automatically adds "/" prefix to path

**Examples:**

Delete file from root:
```
GET /rm?path=readme.txt

Response: ok
```

Delete file from subdirectory:
```
GET /rm?path=DCIM/photo.jpg

Response: ok
```

Delete file from nested subdirectory:
```
GET /rm?path=DCIM/NIKON100/IMG_001.jpg

Response: ok
```

**Important:** 
- The `path` parameter should NOT include the leading "/" (it's added automatically)
- Use the path from the `/ls` response but remove the leading "/"
- Example: If `/ls` returns `"/DCIM/photo.jpg"`, use `path=DCIM/photo.jpg`

---

## Network Operations

### WiFi Status
Get current WiFi connection status.

**Endpoint:** `GET /wifistatus`

**Response:**
- `200 OK` - Status string in format "WIFI:{status}"

**Status Values:**
- `AP_Mode` - Device is in Access Point mode
- `Failed` - Connection failed
- `Connecting` - Currently connecting
- `Connected:{ip}` - Connected with IP address (e.g., "WIFI:Connected:192.168.1.100")

**Example:**
```
GET /wifistatus

Response: WIFI:Connected:192.168.1.100
```

---

### WiFi Connect
Connect to a WiFi network.

**Endpoint:** `POST /wificonnect`

**Parameters:**
- `ssid` (required) - WiFi network SSID
- `password` (required) - WiFi password

**Response:**
- `200 OK` - Status messages:
  - "WIFI:Starting" - Connection initiated
  - "WIFI:AlreadyCon:{ip}" - Already connected with IP
  - "WIFI:NoSSID" - Missing SSID parameter
  - "WIFI:NoPassword" - Missing password parameter
  - "WIFI:WrongPara" - Empty SSID or password

**Example:**
```
POST /wificonnect
Content-Type: application/x-www-form-urlencoded

ssid=MyNetwork&password=MyPassword123

Response: WIFI:Starting
```

---

### WiFi Scan
Initiate a WiFi network scan.

**Endpoint:** `GET /wifiscan`

**Response:**
- `200 OK` - "ok"

**Notes:**
- Scan results are retrieved via `/wifilist` endpoint

**Example:**
```
GET /wifiscan

Response: ok
```

---

### WiFi List
Get list of available WiFi networks from last scan.

**Endpoint:** `GET /wifilist`

**Response:**
- `200 OK` - Plain text list of networks

**Example:**
```
GET /wifilist

Response: (network list)
```

---

### WiFi AP Mode
Switch to Access Point mode.

**Endpoint:** `POST /wifiap`

**Response:**
- `200 OK` - Status messages:
  - "WIFI:StartAPmode" - Switching to AP mode
  - "WIFI:AlreadyAPmode" - Already in AP mode

**Example:**
```
POST /wifiap

Response: WIFI:StartAPmode
```

---

## Bluetooth Operations

### Bluetooth Status
Get current Bluetooth connection status.

**Endpoint:** `GET /btstatus`

**Response:**
- `200 OK` - Status string in format "BT:{status}"

**Status Values:**
- `Disabled` - Bluetooth is disabled
- `Ready` - Bluetooth enabled but not connected
- `Connected` - Bluetooth device connected

**Example:**
```
GET /btstatus

Response: BT:Connected
```

---

## Static File Serving

The server automatically serves static files from the SPIFFS filesystem for any unmatched routes.

**Behavior:**
- Requests ending with "/" serve `index.htm`
- Supports gzipped files (`.gz` extension)
- Automatically sets appropriate Content-Type headers
- Returns 404 if file not found

**Example:**
```
GET /css/style.css
→ Serves /css/style.css or /css/style.css.gz from SPIFFS
```

---

## Error Handling

All endpoints follow consistent error response patterns:

**HTTP Status Codes:**
- `200 OK` - Successful operation
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Operation failed

**Error Message Format:**
- `{COMMAND}:{ERROR_CODE}` - e.g., "LIST:SDBUSY", "UPLOAD:OPENFAILED"

**Common Error Codes:**
- `SDBUSY` - SD card is currently controlled by printer
- `BADARGS` - Missing or invalid parameters
- `BADPATH` - Invalid file/directory path
- `NOTDIR` - Path is not a directory
- `FileNotFound` - Requested file does not exist

---

## Implementation Notes

### SD Card Control
- All SD operations check `sdcontrol.canWeTakeControl()` before proceeding
- Operations call `sdcontrol.takeControl()` at start
- Operations call `sdcontrol.relinquishControl()` when complete or on error
- If printer is using SD card, operations return `{COMMAND}:SDBUSY` error

### Path Handling
- Most operations expect paths starting with "/"
- Delete operation automatically adds "/" prefix
- Empty paths default to root "/"

### Performance Considerations
- List operation limited to 200 items per request
- Upload uses chunked/streaming for large files
- Async web server for non-blocking operations
- Response streaming for large directory listings

### Content Type Detection
- Based on file extension
- Supports common web and document formats
- Defaults to "text/plain" for unknown types
- Gzipped files automatically handled

---

## Code Reuse Reference

The following existing functions can be reused/renamed for the Linux-style API:

| Current Function | Linux Command | New Endpoint | Legacy Endpoint | Reuse Notes |
|-----------------|---------------|--------------|-----------------|-------------|
| `onHttpList()` | `ls` | `/ls` | `/list` | Directory listing |
| `onHttpDownload()` | `cat` | `/cat` | `/download` | File reading |
| `onHttpFileUpload()` | `dd` | `/dd` | `/upload` | Chunked upload |
| `onHttpDelete()` | `rm` | `/rm` | `/delete` | File deletion |
| `handleFileReadSD()` | - | - | - | Helper for reading SD files |
| `getContentType()` | - | - | - | Helper for MIME type detection |

**Note:** The implementation now uses Linux-style command endpoints (`/ls`, `/cat`, `/dd`, `/rm`) while maintaining legacy endpoints for backward compatibility.
