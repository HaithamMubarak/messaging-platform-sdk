package com.hmdev.sdk.local;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

import lombok.extern.slf4j.Slf4j;

@SpringBootApplication
@Slf4j
public class SdkLocalServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(SdkLocalServiceApplication.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        log.info("╔══════════════════════════════════════════════════╗");
        log.info("║  SDK Local Service (SLS) v1.0.0                  ║");
        log.info("║  Port: 8088                                      ║");
        log.info("║  Status: Ready                                   ║");
        log.info("║  Database: H2 (sls-data.mv.db)                   ║");
        log.info("╚══════════════════════════════════════════════════╝");
    }
}

