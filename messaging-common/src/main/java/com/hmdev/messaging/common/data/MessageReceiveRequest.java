package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

@EqualsAndHashCode(callSuper = true)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageReceiveRequest extends SessionRequest {
    @JsonProperty("receiveConfig")
    @JsonAlias({"offsetRange"})
    private ReceiveConfig receiveConfig;
}
