var renderPage = true;
var sdbusy = false;
var debugLogs = [];

if (navigator.userAgent.indexOf('MSIE') !== -1
    || navigator.appVersion.indexOf('Trident/') > 0) {
    /* Microsoft Internet Explorer detected in. */
    alert("Please view this in a modern browser such as Chrome or Microsoft Edge.");
    renderPage = false;
}

function addDebugLog(message) {
    var timestamp = new Date().toLocaleTimeString();
    debugLogs.push('[' + timestamp + '] ' + message);
    if (debugLogs.length > 30) {
        debugLogs.shift(); // Keep only last 30 logs
    }
    updateDebugPanel();
}

function updateDebugPanel() {
    var panel = document.getElementById('debugPanel');
    var info = document.getElementById('debugInfo');
    // Always show debug panel
    panel.style.display = 'block';
    info.textContent = debugLogs.join('\n');
    // Auto-scroll to bottom
    info.scrollTop = info.scrollHeight;
}

function clearDebugLog() {
    debugLogs = [];
    document.getElementById('debugPanel').style.display = 'none';
}

// Status functions removed to reduce page load and improve performance

function httpPost(filename, data, type) {
    xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = httpPostProcessRequest;
    var formData = new FormData();
    formData.append("data", new Blob([data], { type: type }), filename);
    xmlHttp.open("POST", "/edit");
    xmlHttp.send(formData);
}

function httpGetList(path, offset, limit) {
    offset = offset || 0;
    limit = limit || 20; // Reduced default for slower devices
    
    addDebugLog('=== Starting file list request ===');
    addDebugLog('Path: ' + path + ', Offset: ' + offset + ', Limit: ' + limit);
    addDebugLog('Initializing SD card... (this may take 5-10 seconds)');
    
    // Show loading message
    $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #666;'><strong>Loading files from SD card...</strong><br><small>Initializing SD card, please wait...</small></div>");
    
    var startTime = Date.now();
    
    xmlHttp = new XMLHttpRequest();
    xmlHttp.timeout = 30000; // 30 second timeout (increased for slow SD cards)
    
    xmlHttp.onload = function () {
        sdbusy = false;
    }
    
    xmlHttp.onreadystatechange = function () {
        if (xmlHttp.readyState == 1) {
            addDebugLog('Connection opened');
        } else if (xmlHttp.readyState == 2) {
            addDebugLog('Request sent, waiting for response...');
        } else if (xmlHttp.readyState == 3) {
            addDebugLog('Receiving data...');
        } else if (xmlHttp.readyState == 4) {
            var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            addDebugLog('Request completed in ' + elapsed + ' seconds');
            
            var resp = xmlHttp.responseText;
            addDebugLog('HTTP Status: ' + xmlHttp.status);
            addDebugLog('Response length: ' + resp.length + ' chars');
            if (resp.length > 0) {
                addDebugLog('Response preview: ' + resp.substring(0, 100));
            } else {
                addDebugLog('Response is empty!');
            }

            if (xmlHttp.status == 200) {
                if (resp.startsWith('LIST:')) {
                    if(resp.includes('SDBUSY')) {
                        addDebugLog('SD card busy');
                        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>SD Card Busy</strong><br>Printer is using the SD card. Wait 10 seconds and try again.</div>");
                        sdbusy = false;
                    } else if(resp.includes('SD_INIT_FAILED')) {
                        addDebugLog('SD card initialization failed');
                        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>SD Card Error</strong><br>Failed to initialize SD card. Please check:<br>• SD card is inserted<br>• SD card is formatted (FAT32)<br>• SD card is not corrupted</div>");
                        sdbusy = false;
                    } else if(resp.includes('BADPATH')) {
                        addDebugLog('Bad path: ' + resp);
                        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>Path Error</strong><br>Cannot access SD card path. Please check:<br>• SD card is inserted<br>• SD card is readable<br>• Try refreshing the page</div>");
                        sdbusy = false;
                    } else if(resp.includes('BADARGS') || resp.includes('NOTDIR')) {
                        addDebugLog('Bad request: ' + resp);
                        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>Request Error</strong><br>" + resp + "</div>");
                        sdbusy = false;
                    }
                } else {
                    // Valid JSON response
                    addDebugLog('Parsing JSON response...');
                    onHttpList(resp, path);
                }
            } else {
                addDebugLog('HTTP error: ' + xmlHttp.status);
                $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Error loading files (HTTP " + xmlHttp.status + ")</div>");
                sdbusy = false;
            }
        }
    };
    
    xmlHttp.ontimeout = function() {
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        addDebugLog('❌ REQUEST TIMEOUT after ' + elapsed + ' seconds');
        addDebugLog('SD card initialization took too long');
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>Request Timeout</strong><br>The SD card took more than 30 seconds to respond.<br><br>Possible causes:<br>• SD card is very slow<br>• SD card has power issues<br>• SD card is not properly inserted<br><br>Check the debug log below for details.</div>");
        sdbusy = false;
    };
    
    xmlHttp.onerror = function() {
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        addDebugLog('❌ CONNECTION ERROR after ' + elapsed + ' seconds');
        addDebugLog('Cannot connect to device');
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #ff6b6b;'><strong>Connection Error</strong><br>Cannot connect to device.<br><br>Check:<br>• WiFi connection<br>• Device is powered on<br>• Correct IP address<br><br>See debug log below for details.</div>");
        sdbusy = false;
    };
    
    try {
        xmlHttp.open('GET', '/ls?dir=' + path + '&offset=' + offset + '&limit=' + limit, true);
        xmlHttp.send(null);
    } catch(e) {
        addDebugLog('Exception: ' + e.message);
        sdbusy = false;
    }
}

function httpGetGcode(path) {
    xmlHttp = new XMLHttpRequest(path);
    xmlHttp.onreadystatechange = function () {
        var resp = xmlHttp.responseText;
        if (xmlHttp.readyState == 4) {

            console.log("Get download response:");
            console.log(xmlHttp.responseText);

            if( resp.startsWith('DOWNLOAD:')) {
                if(resp.includes('SDBUSY')) {
                    alert("Printer is busy, wait for 10s and try again");
                } else if(resp.includes('BADARGS')) {
                    alert("Bad args, please try again or reset the module");
                }
            }
        }
    };
    xmlHttp.open('GET', '/cat?dir=' + path, true);
    xmlHttp.send(null);
}

function httpRelinquishSD() {
    xmlHttp = new XMLHttpRequest();
    xmlHttp.open('GET', '/relinquish', true);
    xmlHttp.send();
}

function onClickSelect() {
    var obj = document.getElementById('filelistbox').innerHTML = "";
}

function onClickDelete(filename) {
    if(sdbusy) {
        alert("SD card is busy");
        return
    }
    sdbusy = true;

    console.log('delete: %s', filename);
    xmlHttp = new XMLHttpRequest();
    xmlHttp.onload = function () {
        sdbusy = false;
        updateList();
    };
    xmlHttp.onreadystatechange = function () {
        var resp = xmlHttp.responseText;

        if( resp.startsWith('DELETE:')) {
            if(resp.includes('SDBUSY')) {
                alert("Printer is busy, wait for 10s and try again");
            } else if(resp.includes('BADARGS') || 
                        resp.includes('BADPATH')) {
                alert("Bad args, please try again or reset the module");
            }
        }
    };
    xmlHttp.open('GET', '/rm?path=' + filename, true);
    xmlHttp.send();
}

function getContentType(filename) {
	if (filename.endsWith(".htm")) return "text/html";
	else if (filename.endsWith(".html")) return "text/html";
	else if (filename.endsWith(".css")) return "text/css";
	else if (filename.endsWith(".js")) return "application/javascript";
	else if (filename.endsWith(".json")) return "application/json";
	else if (filename.endsWith(".png")) return "image/png";
	else if (filename.endsWith(".gif")) return "image/gif";
	else if (filename.endsWith(".jpg")) return "image/jpeg";
	else if (filename.endsWith(".ico")) return "image/x-icon";
	else if (filename.endsWith(".xml")) return "text/xml";
	else if (filename.endsWith(".pdf")) return "application/x-pdf";
	else if (filename.endsWith(".zip")) return "application/x-zip";
	else if (filename.endsWith(".gz")) return "application/x-gzip";
	return "text/plain";
}

function onClickDownload(filename) {
    
    if(sdbusy) {
        alert("SD card is busy");
        return
    }
    sdbusy = true;

    document.getElementById('probar').style.display="block";

    var type = getContentType(filename);
    // let urlData = '/ids/report/exportWord' + "?startTime=" + that.report.startTime + "&endTime=" + that.report.endTime +"&type="+type
    let urlData = "/cat?path=/" + filename;
    let xhr = new XMLHttpRequest();
    xhr.open('GET', urlData, true);
    xhr.setRequestHeader("Content-Type", type + ';charset=utf-8');
    xhr.responseType = 'blob';
    xhr.timeout = 120000; // 120 second timeout for large files
    xhr.addEventListener('progress', event => {
        const percent  = ((event.loaded / event.total) * 100).toFixed(2);
        console.log(`downloaded:${percent} %`);

        var progressBar = document.getElementById('progressbar');
        if (event.lengthComputable) {
          progressBar.max = event.total;
          progressBar.value = event.loaded;
        }
    }, false);
    xhr.onload = function (e) {
      if (this.status == 200) {
        let blob = this.response;
        let downloadElement = document.createElement('a');
        let url = window.URL.createObjectURL(blob);
        downloadElement.href = url;
        downloadElement.download = filename;
        downloadElement.click();
        window.URL.revokeObjectURL(url);
        sdbusy = false;
        console.log("download finished");
        document.getElementById('probar').style.display="none";
        httpRelinquishSD();
      }
    };
    xhr.onerror = function (e) {
        alert(e);
        alert('Download failed!');
        document.getElementById('probar').style.display="none";
    }
    xhr.send();
}

function onUploaded(evt) {
    $("div[role='progressbar']").css("width",0);
    $("div[role='progressbar']").attr('aria-valuenow',0);
    document.getElementById('probar').style.display="none";
    updateList();
    sdbusy = true;
    document.getElementById('uploadButton').disabled = false;
    alert('Upload done!');
}

function onUploadFailed(evt) {
    document.getElementById('probar').style.display="none";
    document.getElementById('uploadButton').disabled = false;
    alert('Upload failed!');
}

function onUploading(evt) {
    var progressBar = document.getElementById('progressbar');
    if (evt.lengthComputable) {
      progressBar.max = evt.total;
      progressBar.value = evt.loaded;
    }
}

function onClickUpload() {
    if(sdbusy) {
        alert("SD card is busy");
        return
    }

    var input = document.getElementById('Choose');
    if (input.files.length === 0) {
        alert("Please choose a file first");
        return;
    }

    sdbusy = true;

    // document.getElementById('uploadbutton').css("pointerEvents","none");
    document.getElementById('uploadButton').disabled = true;
    document.getElementById('probar').style.display="block";
    
    xmlHttp = new XMLHttpRequest();
    xmlHttp.onload = onUploaded;
    xmlHttp.onerror = onUploadFailed;
    xmlHttp.upload.onprogress = onUploading;
    var formData = new FormData();
    var savePath = '';
    savePath = '/' + input.files[0].name;
    formData.append('data', input.files[0], savePath);
    xmlHttp.open('POST', '/dd');
    xmlHttp.send(formData);
}

function niceBytes(x){
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let l = 0, n = parseInt(x, 10) || 0;

    while(n >= 1024 && ++l){
        n = n/1024;
    }
    return(n.toFixed(n < 10 && l > 0 ? 1 : 0) + ' ' + units[l]);
}

function isImageFile(filename) {
    var ext = filename.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || 
           ext.endsWith('.png') || ext.endsWith('.gif') || 
           ext.endsWith('.bmp') || ext.endsWith('.webp');
}

function createFileListItem(item, level) {
    level = level || 0;
    var indent = level * 20;
    var isDir = item.type === 'dir';
    var icon = isDir ? '📁' : '📄';
    var cleanPath = item.path || item.name;
    var isImage = !isDir && isImageFile(item.name);
    
    // Debug log the item details
    addDebugLog('Creating item: name=' + item.name + ', path=' + item.path + ', cleanPath=' + cleanPath + ', isDir=' + isDir);
    
    var data = "<div class=\"file-tree-item\" data-path=\"" + cleanPath + "\" style=\"padding-left: " + indent + "px;\">\n";
    
    if (isDir) {
        data += "<span class=\"folder-toggle\" onclick=\"loadFolder('" + cleanPath + "', this)\">▶</span>\n";
    } else {
        data += "<span class=\"file-spacer\"></span>\n";
    }
    
    data += "<span class=\"file-icon\">" + icon + "</span>\n";
    data += "<span class=\"file-name\">" + item.name + "</span>\n";
    
    if (!isDir) {
        data += "<span class=\"file-size\">" + niceBytes(item.size) + "</span>\n";
        data += "<div class=\"file-actions\">\n";
        data += "<button class=\"btn-small\" onclick=\"onClickDelete('" + cleanPath + "')\">Delete</button>\n";
        
        if (isImage) {
            data += "<button class=\"btn-small btn-show\" onclick=\"onClickShowImage('" + cleanPath + "', this)\">Show</button>\n";
        } else {
            data += "<button class=\"btn-small\" onclick=\"onClickDownload('" + cleanPath + "')\">Download</button>\n";
        }
        data += "</div>\n";
    } else {
        data += "<span class=\"file-size\">Folder</span>\n";
    }
    
    data += "</div>\n";
    
    // Add image preview container for images
    if (isImage) {
        data += "<div class=\"image-preview\" id=\"preview-" + cleanPath.replace(/[^a-zA-Z0-9]/g, '_') + "\" style=\"display: none;\"></div>\n";
    }
    
    data += "<div class=\"folder-contents\" style=\"display: none;\"></div>\n";
    
    return data;
}

function loadFolder(path, toggleElement) {
    var folderItem = toggleElement.parentElement;
    var folderContents = folderItem.nextElementSibling;
    
    if (!folderContents || !folderContents.classList.contains('folder-contents')) {
        return;
    }
    
    // If already loaded, just toggle
    if (folderContents.getAttribute('data-loaded') === 'true') {
        if (folderContents.style.display === 'none') {
            folderContents.style.display = 'block';
            toggleElement.textContent = '▼';
        } else {
            folderContents.style.display = 'none';
            toggleElement.textContent = '▶';
        }
        return;
    }
    
    // Calculate nesting level
    var level = 0;
    var parent = folderItem.parentElement;
    while (parent && parent.id !== 'filelistbox') {
        if (parent.classList.contains('folder-contents')) {
            level++;
        }
        parent = parent.parentElement;
    }
    
    // Ensure path starts with /
    var requestPath = path;
    if (!requestPath.startsWith('/')) {
        requestPath = '/' + requestPath;
    }
    
    // Load folder contents with pagination support
    addDebugLog('Loading folder: ' + requestPath);
    folderContents.innerHTML = '<div style="padding: 10px 10px 10px ' + ((level + 1) * 20 + 10) + 'px; color: #999;">Loading...</div>';
    folderContents.style.display = 'block';
    toggleElement.textContent = '▼';
    
    var xhr = new XMLHttpRequest();
    xhr.timeout = 15000; // Increased timeout
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4) {
            if (xhr.status == 200) {
                var resp = xhr.responseText;
                
                // Check for error responses
                if (resp.startsWith('LIST:')) {
                    addDebugLog('Server error: ' + resp);
                    folderContents.innerHTML = '<div style="padding: 10px; color: red;">Server error: ' + resp + '</div>';
                    return;
                }
                
                try {
                    var data = JSON.parse(resp);
                    var items = data.items || data; // Support both old and new format
                    
                    addDebugLog('Loaded ' + items.length + ' items from ' + requestPath);
                    
                    if (items.length === 0) {
                        folderContents.innerHTML = '<div style="padding: 10px 10px 10px ' + ((level + 1) * 20 + 10) + 'px; color: #999;">Empty folder</div>';
                    } else {
                        var html = '';
                        for (var i = 0; i < items.length; i++) {
                            html += createFileListItem(items[i], level + 1);
                        }
                        
                        // Add "Load More" button if there are more items
                        if (data.hasMore) {
                            var nextOffset = data.offset + data.limit;
                            html += '<div style="padding: 10px 10px 10px ' + ((level + 1) * 20 + 10) + 'px;">';
                            html += '<button class="btn-small" onclick="loadMoreInFolder(\'' + requestPath + '\', ' + nextOffset + ', this)">Load More (' + (data.total - nextOffset) + ' remaining)</button>';
                            html += '</div>';
                        }
                        
                        folderContents.innerHTML = html;
                    }
                    folderContents.setAttribute('data-loaded', 'true');
                } catch (e) {
                    addDebugLog('Error parsing folder contents: ' + e.message);
                    addDebugLog('Response was: ' + resp.substring(0, 200));
                    folderContents.innerHTML = '<div style="padding: 10px; color: red;">Error parsing response</div>';
                }
            } else {
                addDebugLog('Error loading folder: HTTP ' + xhr.status + ' - ' + xhr.responseText);
                folderContents.innerHTML = '<div style="padding: 10px; color: red;">HTTP ' + xhr.status + ': ' + xhr.responseText + '</div>';
            }
        }
    };
    
    xhr.ontimeout = function() {
        addDebugLog('Folder load timeout');
        folderContents.innerHTML = '<div style="padding: 10px; color: red;">Timeout - Try refreshing</div>';
    };
    
    xhr.onerror = function() {
        addDebugLog('Folder load error');
        folderContents.innerHTML = '<div style="padding: 10px; color: red;">Connection error</div>';
    };
    
    xhr.open('GET', '/ls?dir=' + encodeURIComponent(requestPath) + '&limit=20', true);
    xhr.send(null);
}



function onHttpList(response, path) {
    try {
        var data = JSON.parse(response);
        var list = data.items || data; // Support both old array format and new paginated format
        
        addDebugLog('Parsed ' + list.length + ' items');
        
        if (list.length === 0) {
            $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #666;'>No files found on SD card</div>");
            return;
        }
        
        var html = "";
        for (var i = 0; i < list.length; i++) {
            html += createFileListItem(list[i]);
        }
        
        // Add "Load More" button if there are more items
        if (data.hasMore) {
            var nextOffset = data.offset + data.limit;
            html += '<div style="padding: 20px; text-align: center; border-top: 1px solid #ddd; margin-top: 10px;">';
            html += '<button class="btn-small" style="padding: 10px 20px; font-size: 1rem;" onclick="loadMoreFiles(\'' + (path || '/') + '\', ' + nextOffset + ')">Load More Files (' + (data.total - nextOffset) + ' remaining)</button>';
            html += '<div style="margin-top: 10px; color: #666; font-size: 0.9rem;">Showing ' + (data.offset + list.length) + ' of ' + data.total + ' items</div>';
            html += '</div>';
        } else if (data.total) {
            html += '<div style="padding: 10px; text-align: center; color: #666; font-size: 0.9rem; border-top: 1px solid #ddd; margin-top: 10px;">Showing all ' + data.total + ' items</div>';
        }
        
        $("#filelistbox").html(html);
        addDebugLog('File list rendered successfully');
    } catch (e) {
        addDebugLog('Error: ' + e.message);
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Error: " + e.message + "</div>");
    }
}

function loadMoreFiles(path, offset) {
    if(sdbusy) {
        alert("SD card is busy");
        return;
    }
    sdbusy = true;
    
    addDebugLog('Loading more files from: ' + path + ' at offset ' + offset);
    
    var xhr = new XMLHttpRequest();
    xhr.timeout = 15000;
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4) {
            sdbusy = false;
            
            if (xhr.status == 200) {
                var resp = xhr.responseText;
                
                try {
                    var data = JSON.parse(resp);
                    var list = data.items || data;
                    
                    addDebugLog('Loaded ' + list.length + ' more items');
                    
                    // Find the "Load More" button and replace it with new items
                    var filelistbox = document.getElementById('filelistbox');
                    var loadMoreDiv = filelistbox.querySelector('div[style*="border-top"]');
                    
                    if (loadMoreDiv) {
                        loadMoreDiv.remove();
                    }
                    
                    // Append new items
                    var html = "";
                    for (var i = 0; i < list.length; i++) {
                        html += createFileListItem(list[i]);
                    }
                    
                    // Add new "Load More" button if needed
                    if (data.hasMore) {
                        var nextOffset = data.offset + data.limit;
                        html += '<div style="padding: 20px; text-align: center; border-top: 1px solid #ddd; margin-top: 10px;">';
                        html += '<button class="btn-small" style="padding: 10px 20px; font-size: 1rem;" onclick="loadMoreFiles(\'' + path + '\', ' + nextOffset + ')">Load More Files (' + (data.total - nextOffset) + ' remaining)</button>';
                        html += '<div style="margin-top: 10px; color: #666; font-size: 0.9rem;">Showing ' + (data.offset + list.length) + ' of ' + data.total + ' items</div>';
                        html += '</div>';
                    } else if (data.total) {
                        html += '<div style="padding: 10px; text-align: center; color: #666; font-size: 0.9rem; border-top: 1px solid #ddd; margin-top: 10px;">Showing all ' + data.total + ' items</div>';
                    }
                    
                    filelistbox.insertAdjacentHTML('beforeend', html);
                    
                } catch (e) {
                    addDebugLog('Error loading more: ' + e.message);
                    alert('Error loading more files: ' + e.message);
                }
            } else {
                addDebugLog('HTTP error: ' + xhr.status);
                alert('Error loading more files (HTTP ' + xhr.status + ')');
            }
        }
    };
    
    xhr.ontimeout = function() {
        sdbusy = false;
        alert('Request timeout');
    };
    
    xhr.onerror = function() {
        sdbusy = false;
        alert('Connection error');
    };
    
    xhr.open('GET', '/ls?dir=' + encodeURIComponent(path) + '&offset=' + offset + '&limit=20', true);
    xhr.send(null);
}

function updateList() {
    document.getElementById('filelistbox').innerHTML = "";
    httpGetList('/');
}

function onClickUpdateList() {
    if(sdbusy) {
        alert("SD card is busy");
        return
    }
    sdbusy = true;

    updateList();
}

function loadImageProgressive(filename, previewDiv) {
    var filePath = filename.startsWith('/') ? filename : '/' + filename;
    var chunkSize = 16384 * 4; // 16KB chunks - optimal for ESP32
    var imageElement = null;
    var currentBlobUrl = null;
    var lastUpdateChunk = -1;
    var updateInterval = 3; // Update image every N chunks to reduce flashing
    var chunks = [];
    var currentChunk = 0;
    var totalChunks = null;
    
    addDebugLog('Starting progressive load for: ' + filename);
    
    // Create progress container with image placeholder
    var safeId = filename.replace(/[^a-zA-Z0-9]/g, '_');
    previewDiv.innerHTML = '<div style="padding: 15px; text-align: center; background: #f5f5f5; border-radius: 8px; margin: 10px 0;">' +
        '<div id="img-container-' + safeId + '" style="min-height: 200px; display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">' +
        '<div style="color: #999;">Loading...</div>' +
        '</div>' +
        '<div style="background: #ddd; height: 20px; border-radius: 10px; overflow: hidden;">' +
        '<div id="progress-' + safeId + '" style="background: #4CAF50; height: 100%; width: 0%; transition: width 0.3s;"></div>' +
        '</div>' +
        '<div id="status-' + safeId + '" style="margin-top: 10px; font-size: 0.85rem; color: #666;">Chunk 0...</div>' +
        '</div>';
    previewDiv.style.display = 'block';
    
    var imgContainer = document.getElementById('img-container-' + safeId);
    var progressBar = document.getElementById('progress-' + safeId);
    var statusText = document.getElementById('status-' + safeId);
    
    function updateImageDisplay() {
        // Combine chunks loaded so far
        var totalSize = 0;
        for (var i = 0; i < chunks.length; i++) {
            totalSize += chunks[i].length;
        }
        
        var combined = new Uint8Array(totalSize);
        var offset = 0;
        for (var i = 0; i < chunks.length; i++) {
            combined.set(chunks[i], offset);
            offset += chunks[i].length;
        }
        
        // Create blob and load image
        var blob = new Blob([combined], { type: getContentType(filename) });
        var newBlobUrl = URL.createObjectURL(blob);
        
        // Create a temporary image to load the partial data
        var tempImg = new Image();
        tempImg.onload = function() {
            if (!imageElement) {
                // Create image element on first successful load
                imageElement = document.createElement('img');
                imageElement.style.maxWidth = '100%';
                imageElement.style.maxHeight = '600px';
                imageElement.style.borderRadius = '4px';
                imageElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                imageElement.style.display = 'block';
                imageElement.style.opacity = '0';
                imageElement.style.transition = 'opacity 0.3s ease-in-out';
                imgContainer.innerHTML = '';
                imgContainer.appendChild(imageElement);
                
                // Fade in on first load
                setTimeout(function() {
                    if (imageElement) imageElement.style.opacity = '1';
                }, 50);
            }
            
            // Update the displayed image smoothly
            imageElement.src = newBlobUrl;
            
            // Revoke old blob URL to free memory
            if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
            }
            currentBlobUrl = newBlobUrl;
        };
        
        tempImg.onerror = function() {
            // Not enough data yet to render, that's ok
            URL.revokeObjectURL(newBlobUrl);
        };
        
        tempImg.src = newBlobUrl;
    }
    
    function loadNextChunk() {
        var chunkUrl = '/cat?path=' + encodeURIComponent(filePath) + '&chunk=' + currentChunk + '&size=' + chunkSize;
        addDebugLog('Loading chunk ' + currentChunk);
        
        var xhr = new XMLHttpRequest();
        xhr.open('GET', chunkUrl, true);
        xhr.responseType = 'arraybuffer';
        xhr.timeout = 30000;
        
        xhr.onload = function() {
            if (xhr.status === 200 || xhr.status === 206) {
                var xTotalChunks = xhr.getResponseHeader('X-Total-Chunks');
                
                if (xTotalChunks && totalChunks === null) {
                    totalChunks = parseInt(xTotalChunks);
                    addDebugLog('Total chunks: ' + totalChunks);
                }
                
                chunks.push(new Uint8Array(xhr.response));
                
                // Update progress bar
                var progress = totalChunks ? ((currentChunk + 1) / totalChunks * 100) : 0;
                if (progressBar) progressBar.style.width = progress + '%';
                if (statusText) statusText.textContent = 'Chunk ' + (currentChunk + 1) + (totalChunks ? ' of ' + totalChunks : '') + ' (' + Math.round(progress) + '%)';
                
                // Update image display progressively (but not every single chunk to reduce flashing)
                // Update on first chunk, then every N chunks, and always on last chunk
                var shouldUpdate = (currentChunk === 0) || 
                                 ((currentChunk - lastUpdateChunk) >= updateInterval) ||
                                 (totalChunks && currentChunk + 1 >= totalChunks);
                
                if (shouldUpdate) {
                    updateImageDisplay();
                    lastUpdateChunk = currentChunk;
                }
                
                currentChunk++;
                
                if (xhr.status === 206 && (!totalChunks || currentChunk < totalChunks)) {
                    loadNextChunk();
                } else {
                    finishDisplay();
                }
            } else if (xhr.status === 416) {
                finishDisplay();
            } else {
                addDebugLog('Chunk load error: HTTP ' + xhr.status);
                previewDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: red; background: #ffe6e6; border-radius: 8px; margin: 10px 0;">' +
                    '<strong>Failed to load chunk ' + currentChunk + '</strong><br>HTTP ' + xhr.status + '</div>';
            }
        };
        
        xhr.onerror = function() {
            previewDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: red; background: #ffe6e6; border-radius: 8px; margin: 10px 0;">' +
                '<strong>Network Error</strong><br>Failed to load chunk ' + currentChunk + '</div>';
        };
        
        xhr.ontimeout = function() {
            previewDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: red; background: #ffe6e6; border-radius: 8px; margin: 10px 0;">' +
                '<strong>Timeout</strong><br>Chunk ' + currentChunk + ' took too long</div>';
        };
        
        xhr.send();
    }
    
    function finishDisplay() {
        var totalSize = 0;
        for (var i = 0; i < chunks.length; i++) {
            totalSize += chunks[i].length;
        }
        
        addDebugLog('Loading complete: ' + chunks.length + ' chunks, total: ' + totalSize + ' bytes');
        
        // Update status to show completion
        if (statusText) {
            statusText.textContent = 'Complete! ' + filename + ' (' + totalSize + ' bytes, ' + chunks.length + ' chunks)';
            statusText.style.color = '#4CAF50';
        }
        
        // Image is already displayed progressively, just clean up
        addDebugLog('Image displayed');
    }
    
    loadNextChunk();
}

function onClickShowImage(filename, buttonElement) {
    addDebugLog('onClickShowImage called with: ' + filename);
    
    if(sdbusy) {
        addDebugLog('SD card is busy');
        alert("SD card is busy");
        return;
    }
    
    var previewId = 'preview-' + filename.replace(/[^a-zA-Z0-9]/g, '_');
    var previewDiv = document.getElementById(previewId);
    
    if (!previewDiv) {
        addDebugLog('ERROR: Preview container not found');
        alert("Preview container not found");
        return;
    }
    
    if (previewDiv.style.display === 'none' || previewDiv.style.display === '') {
        buttonElement.textContent = 'Hide';
        buttonElement.classList.add('btn-active');
        
        if (previewDiv.innerHTML === '') {
            loadImageProgressive(filename, previewDiv);
        } else {
            previewDiv.style.display = 'block';
        }
    } else {
        previewDiv.style.display = 'none';
        buttonElement.textContent = 'Show';
        buttonElement.classList.remove('btn-active');
    }
}