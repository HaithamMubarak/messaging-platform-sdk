package com.hmdev.messaging.sdk.service;

import com.hmdev.messaging.sdk.config.WebDemosProperties;
import com.hmdev.messaging.sdk.base.BaseMessagingServiceClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Mini Games Server implementation of MessagingServiceClient.
 * Extends BaseMessagingServiceClient from web-agent for shared logic.
 */
@Service
@Slf4j
public class MessagingServiceClient extends BaseMessagingServiceClient {

    private final WebDemosProperties properties;

    public MessagingServiceClient(WebDemosProperties properties, RestTemplate restTemplate) {
        super(restTemplate);
        this.properties = properties;
    }

    @Override
    protected String getApiKey() {
        return properties.getApiKey();
    }

    @Override
    protected String getMessagingServiceUrl() {
        return properties.getMessagingServiceUrl();
    }
}

