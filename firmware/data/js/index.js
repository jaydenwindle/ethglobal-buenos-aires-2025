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
    if (debugLogs.length > 20) {
        debugLogs.shift(); // Keep only last 20 logs
    }
    updateDebugPanel();
}

function updateDebugPanel() {
    var panel = document.getElementById('debugPanel');
    var info = document.getElementById('debugInfo');
    if (debugLogs.length > 0) {
        panel.style.display = 'block';
        info.textContent = debugLogs.join('\n');
    }
}

function clearDebugLog() {
    debugLogs = [];
    document.getElementById('debugPanel').style.display = 'none';
}

function updateWifiStatus() {
    var xhr = new XMLHttpRequest();
    xhr.timeout = 5000; // 5 second timeout
    
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4) {
            var statusDiv = document.getElementById('wifiStatus');
            var statusText = document.getElementById('wifiStatusText');
            
            if (xhr.status == 200) {
                var resp = xhr.responseText;
                addDebugLog('WiFi status: ' + resp);
                
                if (resp.startsWith('WIFI:')) {
                    var status = resp.substring(5); // Remove "WIFI:" prefix
                    
                    if (status.includes('Connected:')) {
                        var ip = status.split(':')[1];
                        statusText.innerHTML = 'Connected - IP: ' + ip;
                        statusDiv.className = 'alert alert-success';
                    } else if (status.includes('Connecting')) {
                        statusText.innerHTML = 'Connecting...';
                        statusDiv.className = 'alert alert-warning';
                    } else if (status.includes('Failed')) {
                        statusText.innerHTML = 'Connection Failed - AP Mode';
                        statusDiv.className = 'alert alert-danger';
                    } else if (status.includes('AP_Mode')) {
                        statusText.innerHTML = 'AP Mode - SSID: PERMA';
                        statusDiv.className = 'alert alert-info';
                    } else {
                        statusText.innerHTML = 'Unknown';
                        statusDiv.className = 'alert alert-secondary';
                    }
                } else {
                    statusText.innerHTML = 'Unknown';
                    statusDiv.className = 'alert alert-secondary';
                }
            } else {
                addDebugLog('WiFi status error: HTTP ' + xhr.status);
                statusText.innerHTML = 'Cannot reach device';
                statusDiv.className = 'alert alert-warning';
            }
        }
    };
    
    xhr.ontimeout = function() {
        addDebugLog('WiFi status timeout');
        var statusDiv = document.getElementById('wifiStatus');
        var statusText = document.getElementById('wifiStatusText');
        statusText.innerHTML = 'Request timeout';
        statusDiv.className = 'alert alert-warning';
    };
    
    xhr.onerror = function() {
        addDebugLog('WiFi status connection error');
        var statusDiv = document.getElementById('wifiStatus');
        var statusText = document.getElementById('wifiStatusText');
        statusText.innerHTML = 'Connection error';
        statusDiv.className = 'alert alert-warning';
    };
    
    try {
        xhr.open('GET', '/wifistatus', true);
        xhr.send(null);
    } catch(e) {
        addDebugLog('WiFi status exception: ' + e.message);
    }
}

function updateBTStatus() {
    var xhr = new XMLHttpRequest();
    xhr.timeout = 5000;
    
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4) {
            var statusDiv = document.getElementById('btStatus');
            var statusText = document.getElementById('btStatusText');
            
            if (xhr.status == 200) {
                var resp = xhr.responseText;
                addDebugLog('BT status: ' + resp);
                
                if (resp.startsWith('BT:')) {
                    var status = resp.substring(3);
                    
                    if (status === 'Connected') {
                        statusText.innerHTML = 'Connected';
                        statusDiv.className = 'alert alert-success';
                    } else if (status === 'Ready') {
                        statusText.innerHTML = 'Ready (No client)';
                        statusDiv.className = 'alert alert-info';
                    } else if (status === 'Disabled') {
                        statusText.innerHTML = 'Disabled';
                        statusDiv.className = 'alert alert-secondary';
                    } else {
                        statusText.innerHTML = 'Unknown';
                        statusDiv.className = 'alert alert-secondary';
                    }
                } else {
                    statusText.innerHTML = 'Unknown';
                    statusDiv.className = 'alert alert-secondary';
                }
            } else {
                statusText.innerHTML = 'Error';
                statusDiv.className = 'alert alert-warning';
            }
        }
    };
    
    xhr.ontimeout = function() {
        var statusDiv = document.getElementById('btStatus');
        var statusText = document.getElementById('btStatusText');
        statusText.innerHTML = 'Timeout';
        statusDiv.className = 'alert alert-warning';
    };
    
    xhr.onerror = function() {
        var statusDiv = document.getElementById('btStatus');
        var statusText = document.getElementById('btStatusText');
        statusText.innerHTML = 'Error';
        statusDiv.className = 'alert alert-warning';
    };
    
    try {
        xhr.open('GET', '/btstatus', true);
        xhr.send(null);
    } catch(e) {
        addDebugLog('BT status exception: ' + e.message);
    }
}

function httpPost(filename, data, type) {
    xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = httpPostProcessRequest;
    var formData = new FormData();
    formData.append("data", new Blob([data], { type: type }), filename);
    xmlHttp.open("POST", "/edit");
    xmlHttp.send(formData);
}

function httpGetList(path) {
    addDebugLog('Requesting file list for: ' + path);
    xmlHttp = new XMLHttpRequest();
    xmlHttp.timeout = 10000; // 10 second timeout
    
    xmlHttp.onload = function () {
        sdbusy = false;
    }
    
    xmlHttp.onreadystatechange = function () {
        if (xmlHttp.readyState == 4) {
            var resp = xmlHttp.responseText;
            addDebugLog('List response status: ' + xmlHttp.status);
            addDebugLog('Response length: ' + resp.length + ' chars');
            addDebugLog('Response preview: ' + resp.substring(0, 100));

            if (xmlHttp.status == 200) {
                if (resp.startsWith('LIST:')) {
                    if(resp.includes('SDBUSY')) {
                        addDebugLog('SD card busy');
                        alert("Printer is busy, wait for 10s and try again");
                        sdbusy = false;
                    } else if(resp.includes('BADARGS') || 
                                resp.includes('BADPATH') ||
                                resp.includes('NOTDIR')) {
                        addDebugLog('Bad request: ' + resp);
                        alert("Bad args, please try again or reset the module");
                        sdbusy = false;
                    }
                } else {
                    // Valid JSON response
                    addDebugLog('Parsing JSON response...');
                    onHttpList(resp);
                }
            } else {
                addDebugLog('HTTP error: ' + xmlHttp.status);
                $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Error loading files (HTTP " + xmlHttp.status + ")</div>");
                sdbusy = false;
            }
        }
    };
    
    xmlHttp.ontimeout = function() {
        addDebugLog('Request timeout');
        alert("Request timeout - SD card may be busy");
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Request timeout</div>");
        sdbusy = false;
    };
    
    xmlHttp.onerror = function() {
        addDebugLog('Request error');
        alert("Error loading file list");
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Connection error</div>");
        sdbusy = false;
    };
    
    try {
        xmlHttp.open('GET', '/list?dir=' + path, true);
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
    xmlHttp.open('GET', '/download?dir=' + path, true);
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
    xmlHttp.open('GET', '/delete?path=' + filename, true);
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
    let urlData = "/download?path=/" + filename;
    let xhr = new XMLHttpRequest();
    xhr.open('GET', urlData, true);
    xhr.setRequestHeader("Content-Type", type + ';charset=utf-8');
    xhr.responseType = 'blob';
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
    xmlHttp.open('POST', '/upload');
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

function createFileListItem(item, level) {
    level = level || 0;
    var indent = level * 20;
    var isDir = item.type === 'dir';
    var icon = isDir ? '📁' : '📄';
    var cleanPath = item.path || item.name;
    
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
        data += "<button class=\"btn-small\" onclick=\"onClickDownload('" + cleanPath + "')\">Download</button>\n";
        data += "</div>\n";
    } else {
        data += "<span class=\"file-size\">Folder</span>\n";
    }
    
    data += "</div>\n";
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
    
    // Load folder contents
    addDebugLog('Loading folder: ' + requestPath);
    folderContents.innerHTML = '<div style="padding: 10px 10px 10px ' + ((level + 1) * 20 + 10) + 'px; color: #999;">Loading...</div>';
    folderContents.style.display = 'block';
    toggleElement.textContent = '▼';
    
    var xhr = new XMLHttpRequest();
    xhr.timeout = 10000;
    
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
                    var items = JSON.parse(resp);
                    addDebugLog('Loaded ' + items.length + ' items from ' + requestPath);
                    
                    if (items.length === 0) {
                        folderContents.innerHTML = '<div style="padding: 10px 10px 10px ' + ((level + 1) * 20 + 10) + 'px; color: #999;">Empty folder</div>';
                    } else {
                        var html = '';
                        for (var i = 0; i < items.length; i++) {
                            html += createFileListItem(items[i], level + 1);
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
        folderContents.innerHTML = '<div style="padding: 10px; color: red;">Timeout</div>';
    };
    
    xhr.onerror = function() {
        addDebugLog('Folder load error');
        folderContents.innerHTML = '<div style="padding: 10px; color: red;">Connection error</div>';
    };
    
    xhr.open('GET', '/list?dir=' + encodeURIComponent(requestPath), true);
    xhr.send(null);
}



function onHttpList(response) {
    try {
        var list = JSON.parse(response);
        addDebugLog('Parsed ' + list.length + ' items');
        
        if (list.length === 0) {
            $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: #666;'>No files found on SD card</div>");
            return;
        }
        
        var html = "";
        for (var i = 0; i < list.length; i++) {
            html += createFileListItem(list[i]);
        }
        
        $("#filelistbox").html(html);
        addDebugLog('File list rendered successfully');
    } catch (e) {
        addDebugLog('Error: ' + e.message);
        $("#filelistbox").html("<div style='padding: 20px; text-align: center; color: red;'>Error: " + e.message + "</div>");
    }
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