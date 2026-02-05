package com.hmdev.messaging.agent.api.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Persistent UDP client for real-time agents (e.g. gaming, chat).
 * Keeps one socket open for the agent lifetime and handles send/receive concurrently.
 */
public class UdpClient implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(UdpClient.class);

    private final InetAddress serverAddr;
    private final int serverPort;
    private final ObjectMapper mapper;
    private final DatagramSocket socket;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // controls background listener
    private volatile boolean running = false;

    // Optional listener for incoming messages
    private Consumer<JsonNode> messageListener;

    public UdpClient(String host, int port, ObjectMapper mapper) {
        try {
            this.serverAddr = InetAddress.getByName(host);
            this.serverPort = port;
            this.mapper = mapper;
            this.socket = new DatagramSocket(); // binds to an ephemeral local port
            this.socket.setSoTimeout(0); // block indefinitely on receive
        } catch (UnknownHostException | SocketException e) {
            throw new RuntimeException("Unable to initialize UdpClient", e);
        }
    }

    /** Start background listener thread (non-blocking). */
    public void start(Consumer<JsonNode> listener) {
        if (this.messageListener != null) {
            return;
        }
        this.messageListener = listener;
        this.running = true;
        executor.submit(this::listenLoop);
    }

    /** Stop listener and release resources. */
    @Override
    public void close() {
        this.messageListener = null;
        this.running = false;
        socket.close();
        executor.shutdownNow();
    }

    /** Fire-and-forget send (no waiting for reply). */
    public boolean send(UdpEnvelope envelope) {
        try {
            byte[] payload = mapper.writeValueAsBytes(envelope);
            DatagramPacket packet = new DatagramPacket(payload, payload.length, serverAddr, serverPort);
            socket.send(packet);
            return true;
        } catch (IOException e) {
            logger.error("UDP send error: {}", e.getMessage());
            return false;
        }
    }

    /** Blocking send + wait for reply once. */
    public JsonNode sendAndWait(UdpEnvelope envelope, int timeoutMs) {
        try {
            byte[] payload = mapper.writeValueAsBytes(envelope);
            DatagramPacket packet = new DatagramPacket(payload, payload.length, serverAddr, serverPort);
            socket.send(packet);

            socket.setSoTimeout(timeoutMs);
            byte[] buf = new byte[64 * 1024];
            DatagramPacket resp = new DatagramPacket(buf, buf.length);
            socket.receive(resp);
            String respStr = new String(resp.getData(), 0, resp.getLength(), StandardCharsets.UTF_8);
            return mapper.readTree(respStr);
        } catch (SocketTimeoutException ste) {
            return null;
        } catch (IOException e) {
            logger.error("UDP sendAndWait error: {}", e.getMessage());
            return null;
        }
    }

    /** Compatibility method expected by HTTPChannelApi */
    public JsonNode sendAndReceive(UdpEnvelope envelope, int timeoutMs) {
        return sendAndWait(envelope, timeoutMs);
    }

    /** Background listener loop for real-time updates from server. */
    private void listenLoop() {
        byte[] buf = new byte[64 * 1024];
        DatagramPacket packet = new DatagramPacket(buf, buf.length);
        while (this.messageListener != null && !socket.isClosed() && running) {
            try {
                socket.receive(packet);
                String msg = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                if (messageListener != null) {
                    JsonNode node = mapper.readTree(msg);
                    messageListener.accept(node);
                } else {
                    logger.info("Received UDP message: {}", msg);
                }
            } catch (SocketException exception) {
                logger.debug("UDP sendAndReceive SocketException: {}", exception.getMessage());
                break;
            } catch (IOException exception) {
                logger.debug("UDP sendAndReceive IOException: {}", exception.getMessage());
            }
        }
    }
}
