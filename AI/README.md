# 📁 AI-Generated Documentation - SDK Repository

**Last Updated**: February 18, 2026  
**Purpose:** Central repository for AI-generated SDK documentation

---

## 🎯 Purpose

This `AI/` folder contains **all AI-generated documentation specific to the SDK repository**.

For general messaging platform documentation, see:  
`../messaging-platform-services/AI/`

---

## 📂 Organization

```
AI/
├── README.md           ← This file
├── features/           ← SDK feature implementations
├── examples/           ← Example code and tutorials
├── guides/             ← SDK usage guides
└── stress-testing/     ← Testing tools and results
```

---

## 📝 File Naming Convention

**Format:** `<CATEGORY>-<DESCRIPTION>-<DATE>.md`

**Examples:**
- `FEATURE-WEB-SDK-SERVER-FEB18-2026.md`
- `GUIDE-STRESS-TESTING-TOOL-FEB18-2026.md`
- `EXAMPLE-CHANNEL-OPERATIONS-FEB18-2026.md`

---

## 📚 Current Documentation

### Stress Testing (February 18, 2026)
- **Tool Location:** `agents/examples/web-sdk-server/src/main/resources/static/stress-test.html`
- **Controller:** `agents/examples/web-sdk-server/src/main/java/.../StressTestController.java`
- **Documentation:** `stress-testing/STRESS-TEST-README-FEB18-2026.md`

The stress testing tool validates:
- Channel connect/pull/disconnect operations
- Redis lock handling (45s TTL)
- Kafka consumer pool behavior
- Overall system performance

---

## 🔗 Related Locations

### Main AI Documentation
```
messaging-platform-services/AI/
└── (Main repository for platform-wide AI documentation)
```

### SDK-Specific Code
```
messaging-platform-sdk/
├── agents/examples/web-sdk-server/  ← Web SDK server with stress test
├── agents/java-agent/               ← Java agent SDK
└── agents/cpp-agent/                ← C++ agent SDK
```

---

## 📋 Guidelines

### For AI Assistants

1. **SDK-specific docs** → Put in THIS folder
2. **Platform-wide docs** → Put in `messaging-platform-services/AI/`
3. **Tool documentation** → Put in `stress-testing/` subfolder
4. **Usage guides** → Put in `guides/` subfolder

### For Developers

1. Check here for SDK-specific AI documentation
2. Check `messaging-platform-services/AI/` for platform docs
3. Tool-specific READMEs stay with the tool
4. Cross-reference between repos when needed

---

## 🚀 Quick Start

### Using the Stress Test Tool

1. Start web SDK server
2. Open `http://localhost:8083/stress-test.html`
3. Run tests to validate performance

See: `stress-testing/STRESS-TEST-README-FEB18-2026.md`

---

## 📊 Statistics

As of February 18, 2026:
- SDK AI Documentation Files: 5+
- Categories: 2 (Stress Testing, Guides)
- Tools Created: 1 (Stress Test Tool)

---

## 📞 Contact

For SDK-specific questions:
- Check this folder first
- Create issue with `sdk` label
- Reference specific documentation

For platform questions:
- See `messaging-platform-services/AI/`

---

**This folder serves as the SDK-specific complement to the main AI documentation repository.**

