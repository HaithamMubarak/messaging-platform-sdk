package com.hmdev.messaging.common.security;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * The Java leg of tools/check-cross-language.js.
 *
 * Reads a JSON array of {channel, password, message, sealed} rows on stdin and
 * writes one result per row — {secret, passwordHash, decoded, sealed,
 * tampered} — in exactly the shape the Python probe in that script produces,
 * so the runner can compare every agent against the JavaScript reference and
 * against each other. Run it with the installed classpath:
 *
 *   java -cp 'agents/java-agent/build/install/java-agent/lib/*' \
 *        com.hmdev.messaging.common.security.SecurityVectors < rows.json
 */
public final class SecurityVectors {
    private static final String INVALID_HASH = "0".repeat(64);

    private SecurityVectors() { /* no instances */ }

    public static void main(String[] args) throws IOException {
        JSONArray rows = new JSONArray(readAll(System.in));
        JSONArray results = new JSONArray();
        for (int i = 0; i < rows.length(); i++) {
            results.put(probe(rows.getJSONObject(i)));
        }
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8.name());
        out.println(results.toString());
    }

    static JSONObject probe(JSONObject row) {
        String key = MySecurity.deriveChannelSecret(row.getString("channel"), row.getString("password"));
        JSONObject invalid = new JSONObject(row.getString("sealed"));
        invalid.put("hash", INVALID_HASH);
        JSONObject result = new JSONObject();
        result.put("secret", key);
        result.put("passwordHash", MySecurity.hash(row.getString("password"), key));
        // put(key, null) removes the key; JSONObject.NULL serialises as null.
        result.put("decoded", nullable(MySecurity.decryptAndVerify(row.getString("sealed"), key)));
        result.put("sealed", MySecurity.encryptAndSign(row.getString("message"), key));
        result.put("tampered", nullable(MySecurity.decryptAndVerify(invalid.toString(), key)));
        return result;
    }

    private static Object nullable(String value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        in.transferTo(buffer);
        return buffer.toString(StandardCharsets.UTF_8.name());
    }
}
