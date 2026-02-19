package com.hmdev.sdk.local;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.beans.factory.annotation.Autowired;

import lombok.extern.slf4j.Slf4j;

@SpringBootApplication
@Slf4j
public class SdkLocalServiceApplication {

    @Autowired
    private Environment environment;

    public static void main(String[] args) {
        SpringApplication.run(SdkLocalServiceApplication.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        String port = environment.getProperty("server.port", "8088");
        String address = environment.getProperty("server.address", "127.0.0.1");

        log.info("╔══════════════════════════════════════════════════════════╗");
        log.info("║  SDK Local Service (SLS) v1.0.0                          ║");
        log.info("║  Address: {}:{}                                      ║", address, port);
        log.info("║  Status: Ready ✓                                         ║");
        log.info("║  Database: H2 (sls-data.mv.db)                           ║");
        log.info("║  Security: ENABLED (Token required)                      ║");
        log.info("║                                                          ║");
        log.info("║  🔐 Get Token: POST http://{}:{}/auth/token  ║", address, port);
        log.info("║  💚 Health: http://{}:{}/health                  ║", address, port);
        log.info("║  🌐 Terminal: http://{}:{}                       ║", address, port);
        log.info("╚══════════════════════════════════════════════════════════╝");
    }
}

