package com.hmdev.messaging.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The protocol classes must live in one place.
 *
 * com.hmdev.messaging.common.data was copied into the Java agent and the web
 * demo server as well as living here, and both of those modules already depend
 * on this one — so their copies shadowed the shared class rather than adding
 * anything. Sixteen were byte-identical; four had quietly diverged, which is
 * the failure mode that matters: two peers can disagree about the wire format
 * while every module still compiles.
 *
 * The identical copies are gone. The four that diverged are listed below as
 * known exceptions, so they can be reconciled deliberately and nothing new
 * joins them by accident.
 */
class ProtocolDuplicationTest {

    /**
     * Copies that still differ from the shared class. Shrinking this list is
     * the work; growing it needs a reason.
     */
    private static final List<String> KNOWN_DIVERGENT = List.of(
            "AgentInfo.java",
            "ConnectRequest.java",
            "ConnectResponse.java",
            "EventMessage.java");

    private static final List<String> MODULES = List.of(
            "../agents/java-agent",
            "../agents/examples/web-sdk-server");

    private static final String DATA_PACKAGE = "src/main/java/com/hmdev/messaging/common/data";

    private Path canonicalDir() {
        return Paths.get(DATA_PACKAGE);
    }

    @Test
    @DisplayName("no module ships a byte-identical copy of a shared protocol class")
    void noRedundantCopies() throws IOException {
        List<String> redundant = new ArrayList<>();

        for (String module : MODULES) {
            Path dir = Paths.get(module, DATA_PACKAGE);
            if (!Files.isDirectory(dir)) continue;

            try (Stream<Path> copies = Files.list(dir)) {
                for (Path copy : copies.collect(Collectors.toList())) {
                    Path canonical = canonicalDir().resolve(copy.getFileName());
                    if (!Files.exists(canonical)) continue;

                    boolean identical = new String(Files.readAllBytes(copy), StandardCharsets.UTF_8)
                            .equals(new String(Files.readAllBytes(canonical), StandardCharsets.UTF_8));
                    if (identical) {
                        redundant.add(module + "/" + copy.getFileName());
                    }
                }
            }
        }

        assertTrue(redundant.isEmpty(),
                "these shadow the shared class and add nothing; delete them and depend on "
                        + "messaging-common: " + redundant);
    }

    @Test
    @DisplayName("no new protocol class diverges without being declared")
    void divergenceIsDeclared() throws IOException {
        List<String> undeclared = new ArrayList<>();

        for (String module : MODULES) {
            Path dir = Paths.get(module, DATA_PACKAGE);
            if (!Files.isDirectory(dir)) continue;

            try (Stream<Path> copies = Files.list(dir)) {
                for (Path copy : copies.collect(Collectors.toList())) {
                    String name = copy.getFileName().toString();
                    Path canonical = canonicalDir().resolve(name);
                    if (!Files.exists(canonical)) continue;
                    if (KNOWN_DIVERGENT.contains(name)) continue;

                    boolean identical = new String(Files.readAllBytes(copy), StandardCharsets.UTF_8)
                            .equals(new String(Files.readAllBytes(canonical), StandardCharsets.UTF_8));
                    if (!identical) {
                        undeclared.add(module + "/" + name);
                    }
                }
            }
        }

        assertTrue(undeclared.isEmpty(),
                "a protocol class that differs between modules lets two peers disagree about "
                        + "the wire format while everything still compiles: " + undeclared);
    }
}
