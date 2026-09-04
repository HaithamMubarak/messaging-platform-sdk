package com.hmdev.messaging.sdk.controller;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class LegalControllerTest {

    private final LegalController controller = new LegalController();

    @Test
    void privacyUsesTheStaticPolicyDocument() {
        assertEquals("forward:/privacy.html", controller.privacy());
    }

    @Test
    void termsUsesTheStaticTermsDocument() {
        assertEquals("forward:/terms.html", controller.terms());
    }
}
