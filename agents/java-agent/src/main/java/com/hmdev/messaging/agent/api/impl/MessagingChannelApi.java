package com.hmdev.messaging.agent.api.impl;


import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hmdev.messaging.common.HttpClientResult;
import com.hmdev.messaging.common.HttpClient;
import com.hmdev.messaging.common.data.*;
import com.hmdev.messaging.common.security.MySecurity;
import com.hmdev.messaging.common.security.PemIO;
import lombok.Setter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


import java.io.ByteArrayInputStream;
import java.security.PublicKey;
import javax.crypto.Cipher;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.hmdev.messaging.agent.api.ConnectionChannelApi;

import java.net.URL;


public class MessagingChannelApi implements ConnectionChannelApi {
    private static final Logger logger = LoggerFactory.getLogger(MessagingChannelApi.class);

    private final static String PUBLIC_KEY = "public_key.php";

    // polling timeout in seconds
    private static final int POLLING_TIMEOUT = 40;
    private static final int DEFAULT_UDP_PORT = 9999;

    // Keep this set to false. A public key may be needed in the future, but HTTPS is sufficient for now.
    @Setter
    private boolean usePublicKey = false;

    private final HttpClient client;
    private final ObjectMapper objectMapper;

    // UDP helper
    private final UdpClient udpClient;

    public MessagingChannelApi(String remoteUrl, String developerApiKey) {
        this.client = new HttpClient(remoteUrl);
        this.objectMapper = new ObjectMapper();

        // If a developer API key was provided by the caller, attach it as a default header so all requests include X-Api-Key
        if (developerApiKey != null && !developerApiKey.isBlank()) {
            this.client.setDefaultHeader("X-Api-Key", developerApiKey);
        }

        // Load default developer API key from environment or system property if provided and set as default header
        // NOTE: Developer API key is no longer loaded from environment inside this class.
        // Agents or factories should call `setDeveloperApiKeyId(...)` when creating this API instance
        // if they want to attach an X-Api-Key header to requests.

        String host = "localhost";
        int udpPort = DEFAULT_UDP_PORT;
        try {
            URL url = new URL(remoteUrl);
            if (url.getHost() != null && !url.getHost().isEmpty()) {
                host = url.getHost();
            }
            if (url.getPort() > 0) {
                // If remoteUrl explicitly contains a udpPort, use it as the UDP udpPort (convenience)
                udpPort = url.getPort();
            }
        } catch (Exception e) {
            logger.warn("Unable to parse remoteUrl host/udpPort ({}}), defaulting to localhost:{}", remoteUrl, udpPort);
        }

        // Allow overriding UDP udpPort via system property or environment variable
        // -Dmessaging.udp.udpPort=XXXX or env MESSAGING_UDP_PORT
        try {
            String sysProp = System.getProperty("messaging.udp.udpPort");
            String envVal = System.getenv("MESSAGING_UDP_PORT");
            String chosen = (sysProp != null && !sysProp.isBlank()) ? sysProp : envVal;
            if (chosen != null && !chosen.isBlank()) {
                int overridePort = Integer.parseInt(chosen.trim());
                if (overridePort > 0 && overridePort <= 65535) {
                    udpPort = overridePort;
                    logger.info("Using UDP udpPort override: {}", udpPort);
                } else {
                    logger.warn("Ignoring invalid UDP udpPort override: {}", chosen);
                }
            }
        } catch (NumberFormatException nfe) {
            logger.warn("Invalid UDP udpPort override value; must be an integer: {}", nfe.getMessage());
        }

        this.udpClient = new UdpClient(host, udpPort, this.objectMapper);
    }

    @Override
    public ConnectResponse connect(String channelName, String channelPassword, String agentName)  {
        return connect(channelName, channelPassword, agentName, null, null);
    }

    @Override
    public ConnectResponse connect(String channelName, String channelPassword, String agentName, String sessionId)
    {
        return connect(channelName, channelPassword, agentName, sessionId, null);
    }

    @Override
    public ConnectResponse connect(String channelName, String channelPassword, String agentName, String sessionId,
                                   String channelId)  {
        return connect(channelName, channelPassword, agentName, sessionId, channelId, false);
    }

    @Override
    public ConnectResponse connect(String channelName, String channelPassword, String agentName, String sessionId,
                                   String channelId, boolean enableWebrtcRelay)  {
        return connect(channelName, channelPassword, agentName, sessionId, channelId, enableWebrtcRelay, "private");
    }

    @Override
    public ConnectResponse connect(String channelName, String channelPassword, String agentName, String sessionId,
                                   String channelId, boolean enableWebrtcRelay, String apiKeyScope)  {
        try {
            if (usePublicKey) {
                HttpClientResult publicKeyResponse = this.getPublicKey();

                if (publicKeyResponse.isHttpOk()) {
                    throw new Exception("Unable to get the public key");
                }
                PublicKey publicKey = PemIO.readPublicKey(new ByteArrayInputStream(publicKeyResponse.getData().getBytes()));
                Cipher pubKeyEncryptor = Cipher.getInstance("RSA");
                pubKeyEncryptor.init(Cipher.ENCRYPT_MODE, publicKey);
                client.setPublicKeyEncryptor(pubKeyEncryptor);
            }

            boolean hasChannelLogin = (channelName != null && channelPassword != null);
            String passwordHash = null;
            if (hasChannelLogin) {
                passwordHash = MySecurity.hash(channelPassword,
                        MySecurity.deriveChannelSecret(channelName, channelPassword));
            }

            if (channelId == null) {
                if (hasChannelLogin) {
                    // Create channel on server using channelName and passwordHash (protected password)
                    channelId = createChannel(channelName, passwordHash);
                }
                else
                {
                    throw new RuntimeException("Missing channelId or channelName+channelPassword for connect operation");
                }
            }

            // Build connect request: prefer channelId if known, but include name/password fields for compatibility
            ConnectRequest connectRequest = ConnectRequest.builder()
                    .channelId(channelId)
                    .channelName(channelName)
                    .channelPassword(passwordHash)
                    .agentName(agentName)
                    .agentContext(createAgentMetadata())
                    .build();
            connectRequest.setSessionId(sessionId);
            connectRequest.setEnableWebrtcRelay(enableWebrtcRelay);
            connectRequest.setApiKeyScope(apiKeyScope != null ? apiKeyScope : "private");

            HttpClientResult httpClientResult = this.client.request(HttpClient.RequestMethod.POST, getActionUrl("connect"), connectRequest);

            if (httpClientResult != null && httpClientResult.isHttpOk()) {
                // Controller wraps connect response in { status: 'success', data: { ... } }
                return objectMapper.readValue(
                        httpClientResult.dataAsJsonObject().optJSONObject("data").toString(), ConnectResponse.class);
            }
        } catch (Exception e) {
            logger.error("Exception caught in connect operation {}", e.getLocalizedMessage());
        }
        logger.debug("Unable to connect to the channel");
        return new ConnectResponse();
    }

    @Override
    public ConnectResponse connect(Map<String, Object> config) {
        String channelName = (String) config.get("channelName");
        String channelPassword = (String) config.get("channelPassword");
        String agentName = (String) config.get("agentName");
        String sessionId = (String) config.get("sessionId");
        String channelId = (String) config.get("channelId");
        boolean enableWebrtcRelay = config.getOrDefault("enableWebrtcRelay", false) instanceof Boolean ?
                (Boolean) config.get("enableWebrtcRelay") : false;
        String apiKeyScope = (String) config.getOrDefault("apiKeyScope", "private");

        return connect(channelName, channelPassword, agentName, sessionId, channelId, enableWebrtcRelay, apiKeyScope);
    }

    @Override
    public ConnectResponse connectWithChannelId(String agentName, String channelId, String sessionId) {
        return this.connect(null, null, agentName, sessionId, channelId, false);
    }

    @Override
    public ConnectResponse connectWithChannelId(String agentName, String channelId, String sessionId, boolean enableWebrtcRelay) {
        return this.connect(null, null, agentName, sessionId, channelId, enableWebrtcRelay);
    }

    // New helper: create channel on the server and return channelId if available
    private String createChannel(String name, String password) {
        try {
            HttpClientResult res = this.client.request(HttpClient.RequestMethod.POST,
                    getActionUrl("create-channel"), new CreateChannelRequest(name, password));

            if (res != null && res.isHttpOk()) {
                // todo: use dto instead of manual parsing
                return res.dataAsJsonObject().optJSONObject("data").optString("channelId", null);
            }
        } catch (Exception e) {
            logger.warn("create-channel failed: {}", e.getMessage());
        }
        return null;
    }


    @Override
    public EventMessageResult receive(String sessionId, ReceiveConfig receiveConfig) {
        EventMessageResult eventMessageResult = new EventMessageResult(new ArrayList<>(), null, null);
        try {
            MessageReceiveRequest messageReceiveRequest = new MessageReceiveRequest();
            messageReceiveRequest.setSessionId(sessionId);
            // Ensure we send JSON with fields globalOffset, localOffset, limit in correct order
            messageReceiveRequest.setReceiveConfig(new ReceiveConfig(receiveConfig.getGlobalOffset(),
                    receiveConfig.getLocalOffset(), receiveConfig.getLimit()));

            HttpClientResult httpClientResult = this.client.request(HttpClient.RequestMethod.POST, getActionUrl("pull"),
                    messageReceiveRequest, POLLING_TIMEOUT * 1000);


            if (httpClientResult.isHttpOk())
            {
                return objectMapper.readValue(httpClientResult.dataAsJsonObject().optJSONObject("data").toString(),
                        EventMessageResult.class);
            }
        } catch (Exception e) {
            logger.error("Exception caught in receive operation {}", e.getLocalizedMessage());
        }
        logger.debug("Unable to receive messages");
        return eventMessageResult;
    }

    @Override
    public List<AgentInfo> getActiveAgents(String sessionId) {
        try {
            SessionRequest sessionRequest = new SessionRequest(sessionId);

            HttpClientResult httpClientResult = this.client.request(HttpClient.RequestMethod.POST, getActionUrl("list-agents"),
                    sessionRequest);

            if (httpClientResult.isHttpOk()) {
                return objectMapper.readValue(httpClientResult.dataAsJsonObject().optJSONArray("data").toString(),
                        new TypeReference<>() {
                        });
            }

        } catch (Exception e) {
            logger.error("Exception for getActiveAgents operation: {}", e.getMessage());
        }
        return new ArrayList<>();
    }

    @Override
    public boolean send(EventMessage.EventType eventType, String msg, String destination, String sessionId, boolean encrypted) {

        try {
            EventMessageRequest eventMessageRequest = new EventMessageRequest();

            eventMessageRequest.setSessionId(sessionId);
            eventMessageRequest.setType(eventType);
            eventMessageRequest.setTo(destination);
            eventMessageRequest.setEncrypted(encrypted);
            eventMessageRequest.setContent(msg);

            return this.client.request(HttpClient.RequestMethod.POST,
                    getActionUrl("push"), eventMessageRequest).isHttpOk();
        }
        catch (Exception e) {
            logger.error("Exception for send operation: {}", e.getMessage());
        }

        return false;
    }

    @Override
    public boolean disconnect(String sessionId) {

        try {
            this.udpClient.close();
        } catch (Exception exception) {
            logger.debug("Error while closing udpClient: {}", exception.getMessage());
        }

        try {
            SessionRequest sessionRequest = new SessionRequest(sessionId);

            HttpClientResult response = this.client.request(HttpClient.RequestMethod.POST, getActionUrl("disconnect"),
                    sessionRequest);

            this.client.closeAll();

            return response.isHttpOk();
        }
        catch (Exception exception)
        {
            logger.error("Exception for disconnect operation: {}", exception.getMessage());
        }

        return false;
    }

    @Override
    public boolean udpPush(String msg, String destination, String sessionId) {
        try {
            EventMessageRequest eventMessageRequest = new EventMessageRequest();
            eventMessageRequest.setSessionId(sessionId);
            eventMessageRequest.setType(EventMessage.EventType.CHAT_TEXT);
            eventMessageRequest.setTo(destination);
            eventMessageRequest.setEncrypted(false);
            eventMessageRequest.setContent(msg);

            // Build UDP envelope using UdpEnvelope model
            UdpEnvelope envelope = new UdpEnvelope("push", objectMapper.valueToTree(eventMessageRequest));

            return this.udpClient.send(envelope);

        } catch (Exception e) {
            logger.error("Exception for udpPush operation: {}", e.getLocalizedMessage());
            return false;
        }
    }

    @Override
    public EventMessageResult udpPull(String sessionId, ReceiveConfig receiveConfig) {
        EventMessageResult eventMessageResult = new EventMessageResult(new ArrayList<>(), null, null);
        try {
            MessageReceiveRequest messageReceiveRequest = new MessageReceiveRequest();
            messageReceiveRequest.setSessionId(sessionId);
            messageReceiveRequest.setReceiveConfig(new ReceiveConfig(receiveConfig.getGlobalOffset(),
                    receiveConfig.getLocalOffset(), receiveConfig.getLimit()));

            // Build UDP envelope using UdpEnvelope model
            UdpEnvelope envelope = new UdpEnvelope("pull", objectMapper.valueToTree(messageReceiveRequest));

            // Send via UDP and wait for response (3 second timeout)
            JsonNode response = this.udpClient.sendAndWait(envelope, 3000);

            if (response != null) {
                // UDP response format: { status: "ok", result: { status: "success", data: {...} } }
                if (response.has("status") && "ok".equals(response.get("status").asText())) {
                    JsonNode result = response.get("result");
                    if (result != null && result.has("status") && "success".equals(result.get("status").asText())) {
                        JsonNode data = result.get("data");
                        if (data != null) {
                            return objectMapper.treeToValue(data, EventMessageResult.class);
                        }
                    }
                }
            }
        } catch (Exception e) {
            logger.error("Exception caught in udpPull operation {}", e.getLocalizedMessage());
        }
        return eventMessageResult;
    }

    public List<AgentInfo> getSystemAgents(String sessionId) {
        List<AgentInfo> agents = new ArrayList<>();
        try {
            SessionRequest sessionRequest = new SessionRequest(sessionId);
            HttpClientResult httpClientResult = this.client.request(HttpClient.RequestMethod.POST, getActionUrl("list-system-agents"), sessionRequest);
            if (httpClientResult.isHttpOk() && httpClientResult.dataAsJsonObject().optJSONArray("data") != null) {
                return objectMapper.readValue(httpClientResult.dataAsJsonObject().optJSONArray("data").toString(), new TypeReference<>() {});
            }
        } catch (Exception e) {
            logger.error("Exception for getSystemAgents operation: {}", e.getMessage());
        }
        return agents;
    }

    private HttpClientResult getPublicKey() {
        return this.client.request(HttpClient.RequestMethod.GET, PUBLIC_KEY, null);
    }

    private String getActionUrl(String action) {
        // Align exactly with kafka-service controller URLs
        return String.format("/%s", action);
    }

    /**
     * Create agent metadata map for connect requests
     * @return Map with agentType and descriptor
     */
    private Map<String, String> createAgentMetadata() {
        Map<String, String> metadata = new HashMap<>();
        metadata.put("agentType", "JAVA-AGENT");
        metadata.put("descriptor", MessagingChannelApi.class.getName());
        return metadata;
    }

}
