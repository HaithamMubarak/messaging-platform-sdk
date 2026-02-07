# WebRTC ICE/TURN Server Configuration for Java Agent

This guide explains how to configure your own STUN and TURN servers for the Java agent's WebRTC functionality.

## Configuration File

The ICE server configuration is stored in:
```
src/main/resources/webrtc.properties
```

## Configuration Properties

### STUN Servers
```properties
ice.stun.servers=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
```
- Comma-separated list of STUN server URLs
- Format: `stun:hostname:port`
- Multiple servers can be specified for redundancy

### TURN Servers
```properties
ice.turn.servers=turn:your-turn-server.com:3478,turns:your-turn-server.com:5349
ice.turn.username=your-username
ice.turn.credential=your-password
```
- Comma-separated list of TURN server URLs
- Format: `turn:hostname:port` (TCP/UDP) or `turns:hostname:port` (TLS)
- Username and credential are optional but required for authenticated TURN servers
- All TURN servers share the same username and credential

## Example Configurations

### Using Only Public STUN Servers (Default)
```properties
ice.stun.servers=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
ice.turn.servers=
ice.turn.username=
ice.turn.credential=
```

### Using Your Own TURN Server (Coturn)
```properties
ice.stun.servers=stun:your-domain.com:3478
ice.turn.servers=turn:your-domain.com:3478,turns:your-domain.com:5349
ice.turn.username=testuser
ice.turn.credential=testpassword
```

### Using Multiple TURN Servers
```properties
ice.stun.servers=stun:stun.l.google.com:19302
ice.turn.servers=turn:turn1.example.com:3478,turn:turn2.example.com:3478
ice.turn.username=myusername
ice.turn.credential=mypassword
```

### Using Xirsys or Similar Service
```properties
ice.stun.servers=stun:global.stun.twilio.com:3478
ice.turn.servers=turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:3478?transport=tcp
ice.turn.username=your-xirsys-username
ice.turn.credential=your-xirsys-credential
```

## Setting Up Your Own TURN Server

If you want to run your own TURN server, the easiest option is Coturn:

### Using the Included Docker Setup
The messaging platform includes a Coturn Docker setup:

1. Navigate to the docker directory:
   ```bash
   cd docker
   ```

2. Configure your TURN server (refer to your TURN server documentation)

3. Update `webrtc.properties` with your server details:
   ```properties
   ice.stun.servers=stun:your-server-ip:3478
   ice.turn.servers=turn:your-server-ip:3478
   ice.turn.username=testuser
   ice.turn.credential=testpassword
   ```

See `docker/coturn/README.md` for more details.

## Testing Your Configuration

After configuring your ICE servers, test them using:

1. **Web-based test**: Open `agents/web-agent/examples/test-turn-stun.html` in your browser

2. **Java agent logs**: When you run the Java agent, it will log the configured ICE servers:
   ```
   INFO  NativeWebRtcFactory - Loaded WebRTC configuration from webrtc.properties
   DEBUG NativeWebRtcFactory - STUN servers: stun:stun.l.google.com:19302
   DEBUG NativeWebRtcFactory - TURN servers: turn:your-server.com:3478
   INFO  NativeWebRtcFactory - Added TURN server: turn:your-server.com:3478 (username: testuser)
   ```

## Troubleshooting

### No TURN Server Specified
If no TURN servers are specified, WebRTC will still work but may fail in restrictive network environments (behind corporate firewalls, symmetric NAT, etc.).

### Authentication Failures
If you see ICE connection failures, check:
1. TURN server is running and accessible
2. Username and credential are correct
3. Firewall allows UDP/TCP traffic on the configured ports
4. Time-limited credentials haven't expired

### Port Requirements
- STUN: UDP port 3478 (default)
- TURN: UDP/TCP ports 3478-3479
- TURN over TLS: TCP port 5349
- Media relay: UDP ports 49152-65535 (configurable)

## Security Considerations

### Credential Management
For production environments:
1. Use time-limited credentials (REST API authentication)
2. Don't commit credentials to version control
3. Use environment variables or external configuration management
4. Rotate credentials regularly

### TLS/DTLS
Always use `turns:` (TURN over TLS) in production for encrypted signaling.

## Related Documentation

- [COTURN.md](../../COTURN.md) - Setting up Coturn server
- [docker/coturn/README.md](../../docker/coturn/README.md) - Docker Coturn setup
- [docs/webrtc.md](../../docs/webrtc.md) - WebRTC integration overview
- [test-turn-stun.html](../../agents/web-agent/examples/test-turn-stun.html) - Test your configuration

## Implementation Details

The Java agent loads the configuration at startup from `webrtc.properties`. The configuration is applied to all WebRTC peer connections created by the agent.

See `NativeWebRtcFactory.java` for implementation details.

