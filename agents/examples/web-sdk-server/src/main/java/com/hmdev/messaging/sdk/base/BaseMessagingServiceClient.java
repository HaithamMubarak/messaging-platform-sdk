package com.hmdev.messaging.sdk.base;

import com.hmdev.messaging.sdk.dto.ApiAccessRequest;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import com.hmdev.messaging.common.util.LogUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * Base implementation for MessagingServiceClient.
 * Provides common logic for creating temporary API keys and checking service health.
 *
 * Subclasses must implement:
 * - getApiKey() - Return the configured API key
 * - getMessagingServiceUrl() - Return the messaging service URL
 * - getFileServiceUrl() - Return the file service URL (optional)
 */
@Slf4j
public abstract class BaseMessagingServiceClient implements MessagingServiceClientInterface {

    protected final RestTemplate restTemplate;

    protected BaseMessagingServiceClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * Get the configured API key
     */
    protected abstract String getApiKey();

    /**
     * Get the messaging service URL
     */
    protected abstract String getMessagingServiceUrl();

    /**
     * Get the file service URL (optional, can return null)
     */
    protected String getFileServiceUrl() {
        return null;
    }

    @Override
    public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
        String apiKey = getApiKey();
        if (apiKey == null || apiKey.trim().isEmpty()) {
            throw new IllegalStateException("API key not configured");
        }

        String url = getMessagingServiceUrl() + "/channels/api-access";

        // Create request body
        ApiAccessRequest request = new ApiAccessRequest(ttlSeconds, singleUse);

        // Create headers
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Api-Key", apiKey);

        HttpEntity<ApiAccessRequest> entity = new HttpEntity<>(request, headers);

        try {
            log.debug("Requesting temporary key from messaging service: ttl={}s, singleUse={}", ttlSeconds, singleUse);

            ResponseEntity<Map> response = restTemplate.exchange(
                url,
                HttpMethod.POST,
                entity,
                Map.class
            );

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                Map<String, Object> responseBody = response.getBody();
                String status = (String) responseBody.get("status");

                if ("success".equals(status)) {
                    Map<String, Object> data = (Map<String, Object>) responseBody.get("data");

                    ApiConfigResponse.ApiConfigResponseBuilder builder = ApiConfigResponse.builder()
                        .temporaryKey((String) data.get("temporaryKey"))
                        .ttlSeconds((Integer) data.get("ttlSeconds"))
                        .singleUse((Boolean) data.get("singleUse"))
                        .expiresAt(((Number) data.get("expiresAt")).longValue())
                        .messagingServiceUrl(getMessagingServiceUrl());

                    String fileServiceUrl = getFileServiceUrl();
                    if (fileServiceUrl != null) {
                        builder.fileServiceUrl(fileServiceUrl);
                    }

                    ApiConfigResponse keyResponse = builder.build();

                    log.info("Successfully created temporary key: expires in {}s", keyResponse.getTtlSeconds());
                    return keyResponse;
                } else {
                    String errorMsg = (String) responseBody.get("statusMessage");
                    throw new RuntimeException(errorMsg);
                }
            } else {
                throw new RuntimeException("Unexpected response from messaging service: " + response.getStatusCode());
            }

        } catch (Exception e) {
            LogUtils.logError(log, "Failed to create temporary key", e);
            throw new RuntimeException("Failed to create temporary key: " + e.getMessage(), e);
        }
    }

    @Override
    public boolean isMessagingServiceAvailable() {
        try {
            String healthUrl = getMessagingServiceUrl() + "/health";
            ResponseEntity<String> response = restTemplate.getForEntity(healthUrl, String.class);
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            log.warn("Messaging service health check failed: {}", e.getMessage());
            return false;
        }
    }
}