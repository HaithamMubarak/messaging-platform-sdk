package com.hmdev.messaging.sdk.controller;

import com.hmdev.messaging.sdk.config.WebDemosProperties;
import com.hmdev.messaging.common.data.EventMessageResult;
import com.hmdev.messaging.common.data.ReceiveConfig;
import com.hmdev.messaging.common.data.MessageReceiveRequest;
import com.hmdev.messaging.sdk.dto.JsonResponse;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Stress Test Controller for testing channel operations (connect/pull/disconnect).
 * Tests multiple channels concurrently to stress test the messaging service.
 */
@RestController
@RequestMapping("/app/api/stress-test")
@Slf4j
public class StressTestController {

    private final RestTemplate restTemplate;
    private final WebDemosProperties properties;
    private final ExecutorService executorService = Executors.newFixedThreadPool(20);

    public StressTestController(RestTemplate restTemplate, WebDemosProperties properties) {
        this.restTemplate = restTemplate;
        this.properties = properties;
    }

    /**
     * Helper method to create HTTP headers with API key
     */
    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-API-KEY", properties.getApiKey());
        return headers;
    }

    /**
     * Create a channel via REST API
     */
    private String createChannel(String channelName, String channelPassword) {
        String url = properties.getMessagingServiceUrl() + "/messaging-platform/create-channel";

        Map<String, Object> request = new HashMap<>();
        request.put("channelName", channelName);
        request.put("channelPassword", channelPassword);
        request.put("channelType", "DEFAULT");

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, createHeaders());
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);

        if (response.getBody() != null && response.getBody().get("data") != null) {
            Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
            return (String) data.get("channelId");
        }
        throw new RuntimeException("Failed to create channel");
    }

    /**
     * Connect to a channel via REST API
     */
    private String connectToChannel(String channelId, String agentName) {
        String url = properties.getMessagingServiceUrl() + "/messaging-platform/connect";

        Map<String, Object> request = new HashMap<>();
        request.put("channelId", channelId);
        request.put("agentName", agentName);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, createHeaders());
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);

        if (response.getBody() != null && response.getBody().get("data") != null) {
            Map<String, Object> data = (Map<String, Object>) response.getBody().get("data");
            return (String) data.get("sessionId");
        }
        throw new RuntimeException("Failed to connect");
    }

    /**
     * Pull messages via REST API
     */
    private void pullMessages(String sessionId) {
        String url = properties.getMessagingServiceUrl() + "/messaging-platform/pull";

        MessageReceiveRequest request = new MessageReceiveRequest();
        request.setSessionId(sessionId);

        ReceiveConfig config = new ReceiveConfig();
        config.setLimit(10L);
        request.setReceiveConfig(config);

        HttpEntity<MessageReceiveRequest> entity = new HttpEntity<>(request, createHeaders());
        restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
    }

    /**
     * Disconnect from channel via REST API
     */
    private void disconnectFromChannel(String sessionId) {
        String url = properties.getMessagingServiceUrl() + "/messaging-platform/disconnect";

        Map<String, Object> request = new HashMap<>();
        request.put("sessionId", sessionId);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, createHeaders());
        restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
    }

    /**
     * Delete a channel via REST API
     */
    private void deleteChannel(String channelId) {
        String url = properties.getMessagingServiceUrl() + "/messaging-platform/delete-channel";

        Map<String, Object> request = new HashMap<>();
        request.put("channelId", channelId);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, createHeaders());
        restTemplate.exchange(url, HttpMethod.POST, entity, Map.class);
    }

    /**
     * Execute stress test across multiple channels
     */
    @PostMapping(value = "/execute", produces = MediaType.APPLICATION_JSON_VALUE)
    public JsonResponse executeStressTest(@RequestBody StressTestRequest request) {
        log.info("Starting stress test: {} channels, {} iterations, {} concurrent",
                request.getChannelCount(), request.getIterations(), request.getConcurrentConnections());

        StressTestResult result = new StressTestResult();
        result.setStartTime(System.currentTimeMillis());

        List<String> channelIds = new ArrayList<>();
        List<Future<ChannelTestResult>> futures = new ArrayList<>();

        try {
            // Create channels
            for (int i = 0; i < request.getChannelCount(); i++) {
                String channelName = "stress-test-channel-" + i;
                String channelPassword = "test-password-" + i;

                try {
                    String channelId = createChannel(channelName, channelPassword);
                    channelIds.add(channelId);
                    result.getCreatedChannels().add(channelId);
                    log.info("Created channel {}: {}", i, channelId);
                } catch (Exception e) {
                    log.error("Failed to create channel {}: {}", i, e.getMessage());
                    result.getErrors().add("Channel creation failed for " + channelName + ": " + e.getMessage());
                }
            }

            result.setChannelsCreated(channelIds.size());

            // Execute concurrent stress test
            for (int i = 0; i < request.getConcurrentConnections(); i++) {
                final int connectionIndex = i;
                Future<ChannelTestResult> future = executorService.submit(() -> {
                    return executeChannelTest(channelIds, request.getIterations(), connectionIndex);
                });
                futures.add(future);
            }

            // Collect results
            for (Future<ChannelTestResult> future : futures) {
                try {
                    ChannelTestResult testResult = future.get(5, TimeUnit.MINUTES);
                    result.getTotalConnections().addAndGet(testResult.getConnectionsSucceeded());
                    result.getTotalPulls().addAndGet(testResult.getPullsSucceeded());
                    result.getTotalDisconnections().addAndGet(testResult.getDisconnectionsSucceeded());
                    result.getTotalErrors().addAndGet(testResult.getErrorCount());
                    result.getTotalDuration().addAndGet(testResult.getDuration());
                } catch (Exception e) {
                    log.error("Test execution failed: {}", e.getMessage());
                    result.getErrors().add("Test execution error: " + e.getMessage());
                }
            }

            // Cleanup: delete channels if requested
            if (request.isDeleteAfter()) {
                for (String channelId : channelIds) {
                    try {
                        deleteChannel(channelId);
                        result.getDeletedChannels().add(channelId);
                        log.info("Deleted channel: {}", channelId);
                    } catch (Exception e) {
                        log.error("Failed to delete channel {}: {}", channelId, e.getMessage());
                        result.getErrors().add("Channel deletion failed for " + channelId + ": " + e.getMessage());
                    }
                }
                result.setChannelsDeleted(result.getDeletedChannels().size());
            }

        } catch (Exception e) {
            log.error("Stress test failed: {}", e.getMessage(), e);
            result.getErrors().add("Fatal error: " + e.getMessage());
        }

        result.setEndTime(System.currentTimeMillis());
        result.setTotalDurationMs(result.getEndTime() - result.getStartTime());
        result.setSuccess(result.getTotalErrors().get() == 0 && result.getErrors().isEmpty());

        log.info("Stress test completed: {} connections, {} pulls, {} errors in {}ms",
                result.getTotalConnections().get(),
                result.getTotalPulls().get(),
                result.getTotalErrors().get(),
                result.getTotalDurationMs());

        return JsonResponse.success(result);
    }

    /**
     * Execute connect/pull/disconnect cycle for all channels
     */
    private ChannelTestResult executeChannelTest(List<String> channelIds, int iterations, int connectionIndex) {
        ChannelTestResult result = new ChannelTestResult();
        long startTime = System.currentTimeMillis();

        for (int iter = 0; iter < iterations; iter++) {
            for (String channelId : channelIds) {
                String agentName = "stress-agent-" + connectionIndex + "-" + iter;
                String sessionId = null;

                try {
                    // Connect
                    sessionId = connectToChannel(channelId, agentName);
                    result.incrementConnectionsSucceeded();

                    // Pull
                    pullMessages(sessionId);
                    result.incrementPullsSucceeded();

                    // Disconnect
                    disconnectFromChannel(sessionId);
                    result.incrementDisconnectionsSucceeded();

                } catch (Exception e) {
                    log.warn("Test iteration failed for channel {} iteration {}: {}", channelId, iter, e.getMessage());
                    result.incrementErrorCount();
                } finally {
                    // Ensure cleanup even on error
                    if (sessionId != null) {
                        try {
                            disconnectFromChannel(sessionId);
                        } catch (Exception ignored) {
                        }
                    }
                }

                // Small delay between operations
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        result.setDuration(System.currentTimeMillis() - startTime);
        return result;
    }

    /**
     * Get current stress test status
     */
    @GetMapping(value = "/status", produces = MediaType.APPLICATION_JSON_VALUE)
    public JsonResponse getStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("activeThreads", Thread.activeCount());
        status.put("executorActive", !executorService.isShutdown());
        return JsonResponse.success(status);
    }

    @Data
    public static class StressTestRequest {
        private int channelCount = 10;
        private int iterations = 1;
        private int concurrentConnections = 5;
        private boolean deleteAfter = true;
    }

    @Data
    public static class StressTestResult {
        private long startTime;
        private long endTime;
        private long totalDurationMs;
        private int channelsCreated;
        private int channelsDeleted;
        private AtomicInteger totalConnections = new AtomicInteger(0);
        private AtomicInteger totalPulls = new AtomicInteger(0);
        private AtomicInteger totalDisconnections = new AtomicInteger(0);
        private AtomicInteger totalErrors = new AtomicInteger(0);
        private AtomicLong totalDuration = new AtomicLong(0);
        private List<String> createdChannels = new ArrayList<>();
        private List<String> deletedChannels = new ArrayList<>();
        private List<String> errors = new ArrayList<>();
        private boolean success;
    }

    @Data
    public static class ChannelTestResult {
        private int connectionsSucceeded = 0;
        private int pullsSucceeded = 0;
        private int disconnectionsSucceeded = 0;
        private int errorCount = 0;
        private long duration = 0;

        public void incrementConnectionsSucceeded() {
            connectionsSucceeded++;
        }

        public void incrementPullsSucceeded() {
            pullsSucceeded++;
        }

        public void incrementDisconnectionsSucceeded() {
            disconnectionsSucceeded++;
        }

        public void incrementErrorCount() {
            errorCount++;
        }
    }
}






