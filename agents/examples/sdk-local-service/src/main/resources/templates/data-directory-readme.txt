═══════════════════════════════════════════════════════════════════
    Messaging Platform - SDK Local Service (SLS)
    Data Directory
═══════════════════════════════════════════════════════════════════

This directory contains all data for the SDK Local Service.

📁 Directory Structure:
───────────────────────────────────────────────────────────────────

~/.messaging-platform/sls/
├── database/          # H2 database files
│   ├── sls-data.mv.db      # Main database file
│   └── sls-data.trace.db   # Trace file (optional)
│
├── logs/              # Application logs
│   ├── sls.log             # Current log file
│   └── sls.log.*.gz        # Archived logs
│
├── notes/             # User notes (text files)
│   ├── {note-id-1}.txt     # Note file
│   └── {note-id-2}.txt     # Note file
│
├── config/            # User configuration
│   └── (future config files)
│
└── temp/              # Temporary files
    └── (temporary data)

═══════════════════════════════════════════════════════════════════
    H2 Database Console Access
═══════════════════════════════════════════════════════════════════

URL:      http://localhost:8088/h2-console
Driver:   org.h2.Driver
JDBC URL: jdbc:h2:file:~/.messaging-platform/sls/database/sls-data
Username: admin
Password: changeme (change via H2_PASSWORD env variable)

🔒 Security:
   - H2 console requires valid SLS security token
   - Only accessible from localhost
   - Remote connections disabled

═══════════════════════════════════════════════════════════════════
    Changing Database Password
═══════════════════════════════════════════════════════════════════

Option 1: Environment Variable (Recommended)
───────────────────────────────────────────────────────────────────
Set H2_PASSWORD environment variable before starting:

Windows (CMD):
    set H2_PASSWORD=your-new-password
    java -jar sdk-local-service.jar

Windows (PowerShell):
    $env:H2_PASSWORD="your-new-password"
    java -jar sdk-local-service.jar

Linux/Mac:
    export H2_PASSWORD=your-new-password
    java -jar sdk-local-service.jar

Option 2: System Property
───────────────────────────────────────────────────────────────────
Pass as JVM argument:
    java -DH2_PASSWORD=your-new-password -jar sdk-local-service.jar

Option 3: Application Properties
───────────────────────────────────────────────────────────────────
Create: ~/.messaging-platform/sls/config/application-local.properties
Add:    spring.datasource.password=your-new-password

⚠️  Important:
   - First startup uses default password: changeme
   - Change it immediately for security
   - H2 encrypts the database, can't change password of existing DB
   - To change password, must recreate database or use H2 ALTER USER

═══════════════════════════════════════════════════════════════════
    Backup & Maintenance
═══════════════════════════════════════════════════════════════════

📦 Backup:
   - Stop SLS service
   - Copy entire ~/.messaging-platform/sls/ directory
   - Restart SLS service

🧹 Clean Logs:
   - Logs auto-rotate (max 30 days)
   - Manually delete old *.gz files if needed

🗄️  Reset Database:
   - Stop SLS service
   - Delete database/ directory
   - Restart SLS (will create fresh database)

═══════════════════════════════════════════════════════════════════
    Support & Documentation
═══════════════════════════════════════════════════════════════════

Documentation: https://hmdevonline.com/docs/sls
Issues:        https://github.com/hmdev/messaging-platform/issues

Generated: {timestamp}

═══════════════════════════════════════════════════════════════════

