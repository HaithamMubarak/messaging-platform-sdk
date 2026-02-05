package com.hmdev.messaging.sdk;

import com.hmdev.messaging.common.util.EnvLoader;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Web Demos Server Application
 *
 * Serves interactive web demos including:
 * - Mini-Games: Reaction Speed Battle, Quiz Battle, Real-Time Whiteboard,
 *               Babyfoot (3D Foosball), Bounce Ball (Physics-based), 4-Player Reactor
 * - Chat Examples: Basic connection, WebRTC examples
 * - WebRTC Demos: Peer-to-peer communication examples
 *
 * Configuration is loaded from .env file:
 * - First checks current project root for .env
 * - Falls back to messaging-platform-services/.env (sibling repo)
 * - Falls back to system properties/environment variables
 */
@SpringBootApplication
public class WebDemosApplication {

    public static void main(String[] args) {
        // Load environment variables from .env file
        // Searches: current project → services repo → system props → env vars → built-in defaults
        EnvLoader.load("MESSAGING_API_URL", "DEFAULT_API_KEY");

        SpringApplication.run(WebDemosApplication.class, args);
    }
}
