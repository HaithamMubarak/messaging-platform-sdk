package com.hmdev.messaging.agent.webrtc;

import com.hmdev.messaging.common.data.EventMessage;

public interface ISignalingMessageHandler {
    void handleSignalingMessage(EventMessage event);
}
