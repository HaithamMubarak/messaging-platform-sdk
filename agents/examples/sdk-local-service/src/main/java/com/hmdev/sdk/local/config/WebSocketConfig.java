package com.hmdev.sdk.local.config;

import com.hmdev.sdk.local.terminal.websocket.TerminalWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * WebSocket configuration for terminal streaming.
 *
 * Security Note:
 * WebSocket doesn't require token authentication because:
 * 1. Service is localhost-only (127.0.0.1) - main security layer
 * 2. Terminal sessions must be created via token-protected REST API first
 * 3. SessionId in WebSocket URL acts as access control
 * 4. Simpler for browser clients (no header workarounds needed)
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final TerminalWebSocketHandler terminalWebSocketHandler;
    private final SecurityProperties securityProperties;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Use same allowed origins as REST API - no wildcards
        String[] allowedOrigins = securityProperties.getAllowedOrigins()
                .toArray(new String[0]);

        registry.addHandler(terminalWebSocketHandler, "/terminal/stream/*")
                .setAllowedOriginPatterns(allowedOrigins);
    }
}

