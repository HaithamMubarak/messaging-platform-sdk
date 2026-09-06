package com.hmdev.messaging.common.security;

import org.json.JSONObject;
import org.testng.Assert;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

/**
 * MySecurity is what every encrypted message on the wire goes through, and
 * until this file it had no test in the Java agent at all: the AES-CTR port
 * and its HMAC check were covered only by the other SDKs' tests of their own
 * copies. The vectors here are the ones tools/check-cross-language.js sends to
 * every agent, so a regression shows up here first and there second.
 */
public class MySecurityTest {
    private static final String KEY = MySecurity.deriveChannelSecret("compat-חדר", "test-كلمة");

    @DataProvider
    public Object[][] messages() {
        return new Object[][] {
                {""},
                {"ASCII message"},
                {"שלום / مرحبا / 🕹️"},
                {"before\0after"},
                {"multi-block ".repeat(100)},
        };
    }

    @Test(dataProvider = "messages")
    public void roundTripPreservesEveryByte(String message) {
        String sealed = MySecurity.encryptAndSign(message, KEY);
        Assert.assertEquals(MySecurity.decryptAndVerify(sealed, KEY), message);
    }

    @Test
    public void nulBytesSurviveInTheMiddleOfAMessage() {
        String decoded = MySecurity.decryptAndVerify(MySecurity.encryptAndSign("a\0b\0\0c", KEY), KEY);
        Assert.assertEquals(decoded, "a\0b\0\0c");
        Assert.assertEquals(decoded.length(), 6);
    }

    @Test
    public void wrongKeyYieldsNullNotGarbage() {
        String sealed = MySecurity.encryptAndSign("secret text", KEY);
        Assert.assertNull(MySecurity.decryptAndVerify(sealed, KEY + "x"));
    }

    @Test
    public void tamperedHashIsRejected() {
        JSONObject sealed = new JSONObject(MySecurity.encryptAndSign("secret text", KEY));
        sealed.put("hash", "0".repeat(64));
        Assert.assertNull(MySecurity.decryptAndVerify(sealed.toString(), KEY));
    }

    @Test
    public void tamperedCipherIsRejected() {
        JSONObject sealed = new JSONObject(MySecurity.encryptAndSign("secret text", KEY));
        sealed.put("cipher", MySecurity.encrypt("another text", KEY));
        Assert.assertNull(MySecurity.decryptAndVerify(sealed.toString(), KEY));
    }

    @Test
    public void malformedEnvelopeIsNull() {
        Assert.assertNull(MySecurity.decryptAndVerify("not json", KEY));
        Assert.assertNull(MySecurity.decryptAndVerify("{}", KEY));
    }

    @Test
    public void secretAndHashMatchTheOtherAgents() {
        // Computed with the JavaScript agent; see agents/cpp-agent/tests/security_vectors_test.cpp.
        Assert.assertEquals(KEY, "channel_Ck3KugJN7TGNR7R5wy5fhW7cB0K6b90sGaJJdonFK6A");
        Assert.assertEquals(MySecurity.hash("test-كلمة", KEY),
                "156a1b19aa554627919df13dd6a26d52f857bc8dcb758c404c540ea21ee1d1f3");
    }
}
