package com.hmdev.messaging.sdk.base;

import com.hmdev.messaging.sdk.dto.ApiAccessRequest;
import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import com.hmdev.messaging.sdk.dto.JsonResponse;
import com.hmdev.messaging.common.util.LogUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import javax.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Base controller providing common API configuration endpoint.
 *
 * This abstract class implements the /config endpoint logic that is shared
 * between web-agent and mini-games-server (and potentially other web-based services).
 *
 * Subclasses should:
 * - Add @RestController annotation
 * - Add @RequestMapping("/app/api") annotation
 * - Provide MessagingServiceClientInterface implementation
 * - Optionally override getServiceName() for logging
 *
 * Example:
 * <pre>
 * @RestController
 * @RequestMapping("/app/api")
 * public class MyController extends BaseApiConfigController {
 *     public MyController(MessagingServiceClientInterface client) {
 *         super(client);
 *     }
 * }
 * </pre>
 */
@Slf4j
public abstract class BaseApiConfigController {

    protected final MessagingServiceClientInterface messagingServiceClient;

    protected BaseApiConfigController(MessagingServiceClientInterface messagingServiceClient) {
        this.messagingServiceClient = messagingServiceClient;
    }

    /**
     * Get application configuration with temporary API key.
     *
     * This endpoint is called by frontend clients to obtain:
     * - Messaging service URL
     * - Temporary API key (secure, time-limited)
     *
     * The temporary key approach ensures the real developer API key
     * is never exposed to client browsers.
     *
     * @param request Optional request body with ttlSeconds and singleUse parameters
     * @return API configuration response with temporary key
     */
    /**
     * Hard ceiling on the lifetime of a key handed to a browser.
     *
     * This endpoint is unauthenticated by design — the demos need a key before
     * anyone has signed in — so the caller must not be able to choose how long
     * the key it mints stays valid. The bundled apps ask for 60s or 300s; a
     * caller asking for a day gets 300s.
     */
    protected static final int MAX_TTL_SECONDS = 300;
    protected static final int MIN_TTL_SECONDS = 10;
    protected static final int DEFAULT_TTL_SECONDS = 60;

    /** Requests per client address per minute for this endpoint. */
    protected static final int RATE_LIMIT_PER_MINUTE = 30;

    private final Map<String, int[]> rateBuckets = new ConcurrentHashMap<>();

    @PostMapping(value = "/config",
                 consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> getConfig(
            @RequestBody(required = false) ApiAccessRequest request,
            HttpServletRequest httpRequest) {
        if (!allowRequest(clientKey(httpRequest))) {
            log.warn("[{}] Rate limit hit for temporary key requests from {}",
                    getServiceName(), clientKey(httpRequest));
            return ResponseEntity.status(429)
                    .body(JsonResponse.error("Too many key requests. Try again in a minute."));
        }

        try {
            Integer ttlSeconds = clampTtl((request != null) ? request.getTtlSeconds() : null);
            Boolean singleUse = (request != null && request.getSingleUse() != null)
                    ? request.getSingleUse() : false;

            ApiConfigResponse apiConfigResponse = messagingServiceClient.getApiAccessDetails(
                    ttlSeconds, singleUse);

            log.info("[{}] Created temporary key with ttl: {}s, singleUse: {}",
                    getServiceName(), apiConfigResponse.getTtlSeconds(), apiConfigResponse.getSingleUse());

            return ResponseEntity.ok(JsonResponse.success(apiConfigResponse));

        } catch (Exception e) {
            LogUtils.logError(log, "[" + getServiceName() + "] Failed to create temporary key", e);
            return ResponseEntity.status(500)
                    .body(JsonResponse.error(e.getMessage()));
        }
    }

    /**
     * Override this to provide service-specific name for logging.
     * Default returns the simple class name.
     */
    protected String getServiceName() {
        return this.getClass().getSimpleName();
    }

    /** Clamp a caller-supplied TTL into the range this server is willing to issue. */
    protected static Integer clampTtl(Integer requested) {
        if (requested == null) return DEFAULT_TTL_SECONDS;
        return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, requested));
    }

    /**
     * Client identity for rate limiting. Honours X-Forwarded-For because this
     * service always runs behind the gateway.
     */
    private static String clientKey(HttpServletRequest request) {
        if (request == null) return "unknown";
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma > 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        String remote = request.getRemoteAddr();
        return remote != null ? remote : "unknown";
    }

    /**
     * Fixed-window counter, one window per minute. Deliberately simple: the
     * point is to stop a script harvesting keys in a loop, not to be exact.
     */
    private boolean allowRequest(String key) {
        int window = (int) (System.currentTimeMillis() / 60_000L);
        int[] bucket = rateBuckets.compute(key, (k, current) -> {
            if (current == null || current[0] != window) return new int[] { window, 0 };
            return current;
        });
        synchronized (bucket) {
            if (bucket[1] >= RATE_LIMIT_PER_MINUTE) return false;
            bucket[1]++;
        }
        if (rateBuckets.size() > 10_000) {
            rateBuckets.entrySet().removeIf(e -> e.getValue()[0] != window);
        }
        return true;
    }
}
