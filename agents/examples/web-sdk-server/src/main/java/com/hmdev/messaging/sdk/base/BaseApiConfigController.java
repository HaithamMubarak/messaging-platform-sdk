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
    @PostMapping(value = "/config",
                 consumes = MediaType.APPLICATION_JSON_VALUE,
                 produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> getConfig(
            @RequestBody(required = false) ApiAccessRequest request) {
        try {
            Integer ttlSeconds = (request != null) ? request.getTtlSeconds() : null;
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
}

