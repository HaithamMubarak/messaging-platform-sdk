package com.hmdev.messaging.sdk.base;

import com.hmdev.messaging.sdk.dto.ApiAccessRequest;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import com.hmdev.messaging.sdk.dto.HostRoomResponse;
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

    /** A tenant's own key, or null when this server has none for it. The site's key is getApiKey(). */
    protected String getTenantApiKey(String tenant) {
        return null;
    }

    /**
     * The key to mint from: the tenant's when it is named and configured, else
     * the site's own. A missing tenant key falls back rather than failing, so
     * a game keeps working (on the demos' quota) until its key is set, and the
     * log says so.
     */
    protected String keyFor(String tenant) {
        if (tenant == null || tenant.isBlank()) return getApiKey();
        String key = getTenantApiKey(tenant.trim());
        if (key != null && !key.trim().isEmpty()) return key;
        log.warn("No key configured for tenant '{}'; minting from the site's own key", tenant);
        return getApiKey();
    }

    @Override
    public ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse) {
        return getApiAccessDetails(null, ttlSeconds, singleUse);
    }

    @Override
    public ApiConfigResponse getApiAccessDetails(String tenant, Integer ttlSeconds, Boolean singleUse) {
        return getApiAccessDetails(tenant, ttlSeconds, singleUse, false);
    }

    @Override
    public ApiConfigResponse getApiAccessDetails(String tenant, Integer ttlSeconds, Boolean singleUse, boolean joinOnly) {
        String apiKey = keyFor(tenant);
        if (apiKey == null || apiKey.trim().isEmpty()) {
            throw new IllegalStateException("API key not configured");
        }
        // createChannels is sent only to say false: left out, the service mints the keys it always has.
        ApiAccessRequest request = new ApiAccessRequest(ttlSeconds, singleUse, null, joinOnly ? Boolean.FALSE : null);
        try {
            log.debug("Requesting temporary key from messaging service: ttl={}s, singleUse={}, joinOnly={}",
                ttlSeconds, singleUse, joinOnly);
            ApiConfigResponse keyResponse = toConfigResponse(postWithKey("/channels/api-access", apiKey, request));
            // A service that ignored the field minted a key that creates rooms: refuse it rather than hand it on.
            if (joinOnly && !Boolean.FALSE.equals(keyResponse.getCreateChannels())) {
                throw new IllegalStateException("the messaging service did not mint a join-only key");
            }
            log.info("Successfully created temporary key: expires in {}s", keyResponse.getTtlSeconds());
            return keyResponse;
        } catch (Exception e) {
            LogUtils.logError(log, "Failed to create temporary key", e);
            throw new RuntimeException("Failed to create temporary key: " + e.getMessage(), e);
        }
    }

    /** The service's api-access answer as pages receive it, with this server's URLs. */
    private ApiConfigResponse toConfigResponse(Map<String, Object> data) {
        ApiConfigResponse.ApiConfigResponseBuilder builder = ApiConfigResponse.builder()
            .temporaryKey((String) data.get("temporaryKey"))
            .ttlSeconds((Integer) data.get("ttlSeconds"))
            .singleUse((Boolean) data.get("singleUse"))
            .createChannels((Boolean) data.get("createChannels"))
            .expiresAt(((Number) data.get("expiresAt")).longValue())
            .messagingServiceUrl(getMessagingServiceUrl());
        String fileServiceUrl = getFileServiceUrl();
        if (fileServiceUrl != null) {
            builder.fileServiceUrl(fileServiceUrl);
        }
        return builder.build();
    }

    /** How long a hosted room's host key admits its connects: a working day; open the room again after. */
    protected static final long HOST_KEY_TTL_SECONDS = 12 * 3600;
    private static final java.security.SecureRandom RANDOM = new java.security.SecureRandom();

    @Override
    public HostRoomResponse openHostedRoom(String tenant, String app, String hostAgent) {
        String apiKey = keyFor(tenant);
        if (apiKey == null || apiKey.trim().isEmpty()) {
            throw new IllegalStateException("API key not configured");
        }
        String channelName = app + "-" + randomToken(8).toLowerCase(java.util.Locale.ROOT).replace('_', 'x');
        String channelPassword = randomToken(18);
        String agentKey = randomToken(24);

        Map<String, Object> host = new java.util.LinkedHashMap<>();
        host.put("agentName", hostAgent);
        host.put("agentKey", agentKey);
        host.put("ttlSeconds", HOST_KEY_TTL_SECONDS);
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("channelName", channelName + "." + app);   // the room the app's pages join (wireRoom)
        body.put("channelPassword", channelPassword);
        body.put("host", host);

        Map<String, Object> data = postWithKey("/channels/managed/host", apiKey, body);
        log.info("Opened hosted room {} for app {} with host {}", channelName, app, hostAgent);
        return HostRoomResponse.builder()
            .channelName(channelName)
            .channelPassword(channelPassword)
            .channelId((String) data.get("channelId"))
            .hostAgent((String) data.get("hostAgent"))
            .agentKey(agentKey)
            .agentKeyTtlSeconds(HOST_KEY_TTL_SECONDS)
            .build();
    }

    /** Random URL-safe text: `bytes` random bytes, base64url without padding. */
    protected static String randomToken(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** POST to the messaging service with this key; the response's data, or an exception with its message. */
    @SuppressWarnings("unchecked")
    protected Map<String, Object> postWithKey(String path, String apiKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Api-Key", apiKey);
        ResponseEntity<Map> response = restTemplate.exchange(getMessagingServiceUrl() + path, HttpMethod.POST,
            new HttpEntity<>(body, headers), Map.class);
        Map<String, Object> responseBody = response.getBody();
        if (responseBody == null || !"success".equals(responseBody.get("status"))) {
            String why = responseBody == null ? "no answer" : String.valueOf(responseBody.get("statusMessage"));
            throw new IllegalStateException("The messaging service refused " + path + ": " + why);
        }
        return (Map<String, Object>) responseBody.get("data");
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