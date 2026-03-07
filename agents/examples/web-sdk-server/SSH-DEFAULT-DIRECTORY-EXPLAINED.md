# ✅ SSH DEFAULT DIRECTORY - HOW IT WORKS

**Date:** February 27, 2026  
**Question:** "When I connect using SSH, how can it know default directory from backend?"  
**Answer:** Backend automatically returns it in the first response!  
**Status:** ✅ **FIXED & DOCUMENTED**

---

## 🎯 How It Works

### SSH Connection Flow:

```
1. User opens SSH terminal → SshTerminalSession created
2. User clicks "File Explorer" → Frontend calls connect()
3. Frontend requests: GET /filesystem/{terminalId}/list?path=.
4. Backend creates SftpFileSystem → Opens SFTP channel
5. SftpFileSystem calls: sftpChannel.pwd()
   ✅ This returns the SSH user's home directory (e.g., /root, /home/username)
6. Backend lists files in that directory
7. Backend returns: { files: [...], currentDirectory: "/root" }
8. Frontend uses currentDirectory as initial path ✅
```

---

## 🔧 Backend Code (SftpFileSystem.java)

### Constructor - Gets Default Directory:

```java
public SftpFileSystem(Session sshSession, ChannelSftp sftpChannel) {
    this.sshSession = sshSession;
    this.sftpChannel = sftpChannel;
    
    try {
        // ✅ Get default directory from SSH server
        this.currentDirectory = sftpChannel.pwd();  // Returns /root or /home/username
        this.connected = true;
        log.info("[SftpFS] Initialized (current dir: {})", currentDirectory);
    } catch (SftpException e) {
        throw new FileSystemException("Failed to get current directory", ...);
    }
}
```

### listFiles() - Returns Current Directory:

```java
@Override
public List<FileInfo> listFiles(String path) {
    // ... list files ...
    
    // ✅ Update and return current directory
    this.currentDirectory = targetPath;
    return fileList;
}
```

### Controller - Returns in Response:

```java
@GetMapping("/{terminalSessionId}/list")
public ResponseEntity<FileSystemResponse> listFiles(...) {
    IFileSystem fs = fileSystemService.getOrCreateFileSystem(terminalSessionId);
    List<FileInfo> files = fs.listFiles(path);
    
    // ✅ Include current directory in response
    return ResponseEntity.ok(FileSystemResponse.builder()
        .success(true)
        .files(files)
        .currentDirectory(fs.getCurrentDirectory())  // ← Returns the default directory!
        .build());
}
```

---

## 🔧 Frontend Code (file-explorer.js)

### BEFORE (❌ Wrong - Made 2 requests):

```javascript
async connect() {
    // First request - but didn't use the returned currentDirectory
    await this.loadDirectory('.');  
    
    this.isConnected = true;
    
    // Second request - unnecessary!
    await this.loadDirectory();  
}
```

**Problems:**
- ❌ Made 2 requests to backend
- ❌ Ignored `currentDirectory` from first response
- ❌ Used frontend's default `currentPath = '/'` instead

---

### AFTER (✅ Fixed - Single request):

```javascript
async connect() {
    this.showLoading('Loading files...');
    
    // ✅ Single request to backend
    const response = await fetch(
        `${this.mlsUrl}/filesystem/${this.terminalSessionId}/list?path=.`
    );
    
    const result = await response.json();
    
    // ✅ Use backend's default directory!
    const defaultPath = result.currentDirectory || '/';
    const files = result.files || [];
    
    console.log('[FileExplorer] Backend default directory:', defaultPath);
    
    // ✅ Set state from backend response
    this.currentPath = defaultPath;  // e.g., "/root" for SSH
    this.files = mappedFiles;
    this.isConnected = true;
    
    // Update UI
    this.updatePathBar();
    this.renderFileList();
}
```

**Improvements:**
- ✅ Single request to backend
- ✅ Uses `currentDirectory` from backend response
- ✅ Respects SSH server's default directory
- ✅ No assumptions about path

---

## 📊 What Gets Returned

### For SSH Connection:

**Backend:**
```java
// SSH server determines home directory
sftpChannel.pwd()  → "/root"  (for root user)
                   → "/home/john"  (for john user)
```

**Response:**
```json
{
    "success": true,
    "currentDirectory": "/root",
    "files": [
        { "name": ".bashrc", "path": "/root/.bashrc", ... },
        { "name": "Documents", "path": "/root/Documents", ... }
    ]
}
```

**Frontend:**
```javascript
this.currentPath = "/root";  // ✅ Uses backend's value
// Path bar shows: /root
// File list shows: .bashrc, Documents, etc.
```

---

### For Local Connection:

**Backend:**
```java
// Java determines user home
Paths.get(System.getProperty("user.home"))  
    → "C:\\Users\\admin"  (Windows)
    → "/home/admin"  (Linux)
```

**Response:**
```json
{
    "success": true,
    "currentDirectory": "C:\\Users\\admin",
    "files": [
        { "name": "Desktop", "path": "C:\\Users\\admin\\Desktop", ... },
        { "name": "Documents", "path": "C:\\Users\\admin\\Documents", ... }
    ]
}
```

**Frontend:**
```javascript
this.currentPath = "C:\\Users\\admin";  // ✅ Uses backend's value
// Path bar shows: C:\Users\admin
// File list shows: Desktop, Documents, etc.
```

---

## 🔍 Key Points

### 1. **Backend is Source of Truth**
```
Backend knows:
- SSH user's home directory (from SSH server)
- Local user's home directory (from Java)
- Current navigation state (persisted in session)

Frontend just displays what backend tells it! ✅
```

### 2. **No Hardcoded Paths**
```
❌ BAD:
this.currentPath = '/';  // Assumes root

✅ GOOD:
this.currentPath = result.currentDirectory;  // Uses backend's value
```

### 3. **SSH Server Controls Default**
```
SSH User: root
├── Server decides: /root
└── Backend returns: /root
    └── Frontend shows: /root ✅

SSH User: john
├── Server decides: /home/john
└── Backend returns: /home/john
    └── Frontend shows: /home/john ✅
```

---

## 🧪 Testing

### Test SSH Connection:

**Steps:**
1. Open SSH terminal (user: root)
2. Click File Explorer
3. Observe initial directory

**Expected:**
```
Backend logs:
[SftpFS] Initialized (current dir: /root)

Frontend logs:
[FileExplorer] Backend default directory: /root

UI shows:
Path bar: /root
Files: Contents of /root directory
```

**Result:** ✅ Shows /root (SSH server's default for root user)

---

### Test Different SSH User:

**Steps:**
1. SSH as user "john"
2. Click File Explorer

**Expected:**
```
Path bar: /home/john
Files: Contents of /home/john
```

**Result:** ✅ Shows /home/john (SSH server's default for john)

---

### Test Local Terminal:

**Steps:**
1. Open local CMD/PowerShell terminal
2. Click File Explorer

**Expected:**
```
Path bar: C:\Users\YourName
Files: Desktop, Documents, Downloads, etc.
```

**Result:** ✅ Shows user's home directory

---

## 🎯 Summary

### Question: "How does it know default directory from backend?"

**Answer:**

1. **Backend determines default:**
   - **SSH:** Calls `sftpChannel.pwd()` → Returns SSH user's home
   - **Local:** Uses `System.getProperty("user.home")` → Returns OS user's home

2. **Backend returns it:**
   ```json
   { "currentDirectory": "/root", "files": [...] }
   ```

3. **Frontend uses it:**
   ```javascript
   this.currentPath = result.currentDirectory;
   ```

**That's it!** The backend automatically provides the default directory in every response, and the frontend simply uses that value. No guessing, no hardcoding - just trust the backend! ✅

---

## 📝 Code Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    SSH Connection Flow                       │
└─────────────────────────────────────────────────────────────┘

Frontend                  Backend                   SSH Server
   │                         │                           │
   │  1. Click File Explorer │                           │
   ├────────────────────────►│                           │
   │  GET /filesystem/.../   │                           │
   │      list?path=.        │                           │
   │                         │                           │
   │                         │  2. Create SftpFileSystem │
   │                         ├──────────────────────────►│
   │                         │  Open SFTP channel        │
   │                         │                           │
   │                         │  3. Get default dir       │
   │                         │◄──────────────────────────┤
   │                         │  pwd() → "/root"          │
   │                         │                           │
   │                         │  4. List files            │
   │                         │◄──────────────────────────┤
   │                         │  ls /root                 │
   │                         │                           │
   │  5. Response            │                           │
   │◄────────────────────────┤                           │
   │  {                      │                           │
   │    currentDirectory:    │                           │
   │      "/root",           │                           │
   │    files: [...]         │                           │
   │  }                      │                           │
   │                         │                           │
   │  6. Display /root       │                           │
   │     and files ✅        │                           │
   │                         │                           │
```

---

**Status:** ✅ **WORKING AS DESIGNED**  
**Default Directory:** ✅ **AUTOMATICALLY DETECTED**  
**Source of Truth:** ✅ **BACKEND (SSH SERVER)**

